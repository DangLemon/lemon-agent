import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'
import { AppInfo } from 'app-builder-lib/out/appInfo.js'
import { validateConfiguration } from 'app-builder-lib/out/util/config/config.js'

import {
  buildElectronBuilderArgs,
  createElectronBuilderConfig,
  isDirectRun,
  writeElectronBuilderConfig
} from './run-electron-builder.mjs'

const validHarnessResource = {
  schemaVersion: 1,
  profile: 'internal',
  sourceRepository: 'DangLemon/hermes-agent',
  ui: {
    agents: false,
    cron: true,
    messaging: false,
    terminal: true,
    webhooks: false
  }
}

function withTempHarness(resource, fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-builder-identity-'))
  try {
    const configPath = path.join(tempRoot, 'internal.json')
    fs.writeFileSync(configPath, JSON.stringify(resource), 'utf8')
    return fn(configPath, tempRoot)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function assertPhysicalIdentity(
  config,
  {
    expectedProductName = 'Lemon AI',
    expectedAppId = 'com.lemondigital.lemonai',
    expectedExecutableName = 'Lemon AI',
    expectedProtocolName = 'Lemon AI Protocol'
  } = {}
) {
  assert.equal(config.appId, expectedAppId)
  assert.equal(config.productName, expectedProductName)
  assert.equal(config.executableName, expectedExecutableName)
  assert.deepEqual(config.protocols, [
    {
      name: expectedProtocolName,
      schemes: ['hermes']
    }
  ])
}

function productFilenameFor(config, platformSpecificOptions = null) {
  return new AppInfo(
    {
      metadata: {
        name: 'lemon-ai',
        productName: 'Lemon AI',
        version: '0.17.0',
        description: ''
      },
      config
    },
    null,
    platformSpecificOptions
  ).productFilename
}

test('electron-builder uses a schema-valid static harness resource without indexed CLI overrides', async () => {
  const withHarness = buildElectronBuilderArgs({
    dist: null,
    argv: ['--dir']
  })
  assert.equal(
    withHarness.some(arg => String(arg).includes('extraResources')),
    false
  )

  const ordinary = buildElectronBuilderArgs({ dist: null, argv: ['--dir'] })
  assert.equal(
    ordinary.some(arg => String(arg).includes('lemon-ai-harness.json')),
    false
  )

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.deepEqual(pkg.build.extraResources.at(-1), {
    from: 'build',
    to: '.',
    filter: ['lemon-ai-harness.json', 'lemon-ai-harness-seed.py']
  })
  await validateConfiguration(structuredClone(pkg.build))
})

test('package build script generates harness resource before Vite reads harness flags', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  assert.match(
    pkg.scripts.build,
    /write-build-stamp\.mjs && cross-env LEMON_AI_DESKTOP_HARNESS_CONFIG=\.\/lemon-ai-desktop\.config\.json node scripts\/internal-desktop-harness\.mjs && cross-env LEMON_AI_DESKTOP_HARNESS_CONFIG=\.\/lemon-ai-desktop\.config\.json vite build/
  )
})

test('ordinary package config uses Lemon installer metadata and assets in this fork', async () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const config = createElectronBuilderConfig(pkg.build, {
    env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    harnessResource: null
  })

  assertPhysicalIdentity(config)
  assert.equal(config.mac.identity, undefined)
  assert.equal(config.artifactName, 'Lemon-AI-${version}-${os}-${arch}.${ext}')
  assert.equal(config.icon, 'assets/lemon-icon')
  assert.equal(config.mac.extendInfo.CFBundleDisplayName, 'Lemon AI')
  assert.equal(config.mac.extendInfo.CFBundleExecutable, 'Lemon AI')
  assert.equal(config.mac.extendInfo.CFBundleName, 'Lemon AI')
  assert.equal(
    config.mac.extendInfo.NSMicrophoneUsageDescription,
    'Lemon AI uses the microphone for voice input and voice conversations.'
  )
  assert.equal(
    config.mac.extendInfo.NSCalendarsUsageDescription,
    'Lemon AI needs access to Calendar to provide requested meeting and scheduling support.'
  )
  assert.equal(
    config.mac.extendInfo.NSRemindersUsageDescription,
    'Lemon AI needs access to Reminders to provide requested personal-assistant and scheduling support.'
  )
  assert.equal(config.dmg.title, 'Install Lemon AI')
  assert.equal(config.win.legalTrademarks, 'Lemon AI')
  assert.equal(config.linux.maintainer, 'Lemon Digital')
  assert.equal(config.linux.synopsis, 'Native desktop shell for Lemon AI.')
  assert.equal(config.nsis.shortcutName, 'Lemon AI')
  assert.equal(config.nsis.uninstallDisplayName, 'Lemon AI')
  assert.deepEqual(config.extraResources[1], {
    from: 'assets/lemon-icon.ico',
    to: 'icon.ico'
  })
  await validateConfiguration(structuredClone(config))
})

test('Hermes installer brand keeps the package config on the Hermes identity', async () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const config = createElectronBuilderConfig(pkg.build, {
    env: {
      HERMES_INSTALLER_BRAND: 'hermes',
      LEMON_AI_DESKTOP_HARNESS_CONFIG: path.resolve('lemon-ai-desktop.config.json'),
      CSC_IDENTITY_AUTO_DISCOVERY: 'false'
    }
  })

  assertPhysicalIdentity(config, {
    expectedProductName: 'Hermes',
    expectedAppId: 'com.nousresearch.hermes',
    expectedExecutableName: 'Hermes',
    expectedProtocolName: 'Hermes Protocol'
  })
  assert.equal(config.artifactName, 'Hermes-${version}-${os}-${arch}.${ext}')
  assert.equal(config.dmg.title, 'Install Hermes')
  assert.deepEqual(config.extraResources[1], {
    from: 'assets/icon.ico',
    to: 'icon.ico'
  })
  assert.equal(config.copyright, 'Copyright © 2026 Nous Research')
  assert.equal(config.mac.extendInfo.NSHumanReadableCopyright, 'Copyright © 2026 Nous Research')
  await validateConfiguration(structuredClone(config))
})

test('validated internal package config applies Lemon physical identity while preserving protocol compatibility', async () => {
  await withTempHarness(validHarnessResource, async configPath => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const config = createElectronBuilderConfig(pkg.build, {
      env: {
        HERMES_DESKTOP_HARNESS_CONFIG: configPath,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false'
      }
    })

    assertPhysicalIdentity(config, {
      expectedProductName: 'Lemon AI',
      expectedAppId: 'com.lemondigital.lemonai',
      expectedExecutableName: 'Lemon AI',
      expectedProtocolName: 'Lemon AI Protocol'
    })
    assert.equal(config.mac.identity, '-')
    assert.equal(productFilenameFor(config, config.mac), 'Lemon AI')
    assert.equal(productFilenameFor(config, config.win), 'Lemon AI')
    assert.equal(config.artifactName, 'Lemon-AI-${version}-${os}-${arch}.${ext}')
    assert.equal(config.icon, 'assets/lemon-icon')
    assert.equal(config.mac.extendInfo.CFBundleDisplayName, 'Lemon AI')
    assert.equal(config.mac.extendInfo.CFBundleExecutable, 'Lemon AI')
    assert.equal(config.mac.extendInfo.CFBundleName, 'Lemon AI')
    assert.equal(
      config.mac.extendInfo.NSMicrophoneUsageDescription,
      'Lemon AI uses the microphone for voice input and voice conversations.'
    )
    assert.equal(
      config.mac.extendInfo.NSCalendarsUsageDescription,
      'Lemon AI needs access to Calendar to provide requested meeting and scheduling support.'
    )
    assert.equal(
      config.mac.extendInfo.NSRemindersUsageDescription,
      'Lemon AI needs access to Reminders to provide requested personal-assistant and scheduling support.'
    )
    assert.equal(config.dmg.title, 'Install Lemon AI')
    assert.equal(config.win.legalTrademarks, 'Lemon AI')
    assert.equal(config.linux.maintainer, 'Lemon Digital')
    assert.equal(config.linux.synopsis, 'Native desktop shell for Lemon AI.')
    assert.equal(config.nsis.shortcutName, 'Lemon AI')
    assert.equal(config.nsis.uninstallDisplayName, 'Lemon AI')
    assert.equal(config.copyright, 'Copyright © 2026 Lemon Digital')
    assert.equal(config.mac.extendInfo.NSHumanReadableCopyright, 'Copyright © 2026 Lemon Digital')
    assert.deepEqual(config.extraMetadata, {
      name: 'lemon-ai',
      productName: 'Lemon AI',
      author: {
        name: 'Lemon Digital'
      },
      description: 'Native desktop shell for Lemon AI.',
      homepage: 'https://github.com/DangLemon/hermes-agent',
      bugs: {
        url: 'https://github.com/DangLemon/hermes-agent/issues'
      },
      repository: {
        type: 'git',
        url: 'git+https://github.com/DangLemon/hermes-agent.git'
      }
    })
    assert.deepEqual(config.extraResources[1], {
      from: 'assets/lemon-icon.ico',
      to: 'icon.ico'
    })
    assert.deepEqual(config.extraResources.at(-1), {
      from: 'build',
      to: '.',
      filter: ['lemon-ai-harness.json', 'lemon-ai-harness-seed.py']
    })
    const serializedConfig = JSON.stringify(config)
    assert.equal(serializedConfig.includes('NousResearch/hermes-agent'), false)
    assert.equal(serializedConfig.includes('hermes-updater'), false)
    assert.equal(serializedConfig.includes('"publish"'), false)
    await validateConfiguration(structuredClone(config))
  })
})

test('internal package config preserves explicit macOS signing identity', async () => {
  await withTempHarness(validHarnessResource, async configPath => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const config = createElectronBuilderConfig(pkg.build, {
      env: {
        HERMES_DESKTOP_HARNESS_CONFIG: configPath,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        CSC_NAME: 'Developer ID Application: Lemon Digital'
      }
    })

    assert.equal(config.mac.identity, undefined)

    const configWithIdentity = createElectronBuilderConfig(
      {
        ...pkg.build,
        mac: {
          ...pkg.build.mac,
          identity: 'Developer ID Application: Lemon Digital'
        }
      },
      {
        env: {
          HERMES_DESKTOP_HARNESS_CONFIG: configPath,
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        }
      }
    )
    assert.equal(configWithIdentity.mac.identity, 'Developer ID Application: Lemon Digital')

    const configWithNullIdentity = createElectronBuilderConfig(
      {
        ...pkg.build,
        mac: {
          ...pkg.build.mac,
          identity: null
        }
      },
      {
        env: {
          HERMES_DESKTOP_HARNESS_CONFIG: configPath,
          CSC_IDENTITY_AUTO_DISCOVERY: 'false'
        }
      }
    )
    assert.equal(Object.hasOwn(configWithNullIdentity.mac, 'identity'), true)
    assert.equal(configWithNullIdentity.mac.identity, null)
  })
})

test('internal package config maps Apple signing env without overriding CSC_NAME', async () => {
  await withTempHarness(validHarnessResource, async configPath => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const config = createElectronBuilderConfig(pkg.build, {
      env: {
        HERMES_DESKTOP_HARNESS_CONFIG: configPath,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        APPLE_SIGNING_IDENTITY: ' Developer ID Application: Lemon Digital '
      }
    })
    assert.equal(config.mac.identity, 'Developer ID Application: Lemon Digital')

    const cscNameConfig = createElectronBuilderConfig(pkg.build, {
      env: {
        HERMES_DESKTOP_HARNESS_CONFIG: configPath,
        CSC_IDENTITY_AUTO_DISCOVERY: 'false',
        APPLE_SIGNING_IDENTITY: 'Developer ID Application: Lemon Digital',
        CSC_NAME: 'Developer ID Application: Certificate From Electron Builder'
      }
    })
    assert.equal(Object.hasOwn(cscNameConfig.mac, 'identity'), false)
  })
})

test('invalid internal selector fails before package config can partially brand', () => {
  withTempHarness({ ...validHarnessResource, schemaVersion: 2 }, configPath => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    assert.throws(
      () =>
        createElectronBuilderConfig(pkg.build, {
          env: { HERMES_DESKTOP_HARNESS_CONFIG: configPath }
        }),
      /schemaVersion/
    )
  })
})

test('builder writes a fresh ordinary config after an internal config', () => {
  withTempHarness(validHarnessResource, configPath => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    const internalPath = writeElectronBuilderConfig(pkg.build, {
      env: { HERMES_DESKTOP_HARNESS_CONFIG: configPath },
      configPath: path.join(path.dirname(configPath), 'electron-builder.json')
    })
    assert.equal(
      JSON.parse(fs.readFileSync(internalPath, 'utf8')).artifactName,
      'Lemon-AI-${version}-${os}-${arch}.${ext}'
    )

    const ordinaryPath = writeElectronBuilderConfig(pkg.build, {
      env: {},
      harnessResource: null,
      configPath: internalPath
    })
    assert.equal(
      JSON.parse(fs.readFileSync(ordinaryPath, 'utf8')).artifactName,
      'Lemon-AI-${version}-${os}-${arch}.${ext}'
    )
  })
})

test('cross-platform builds let electron-builder resolve the requested Electron distribution', () => {
  const args = buildElectronBuilderArgs({
    dist: '/host/electron/dist',
    fsExists: () => true,
    argv: ['--win', 'nsis', '--x64']
  })

  assert.equal(
    args.some(arg => String(arg).includes('electronDist')),
    false
  )
})

test('isDirectRun uses platform-correct file URL comparison for Windows paths', () => {
  const href = 'file:///C:/repo/apps/desktop/scripts/run-electron-builder.mjs'
  assert.equal(
    isDirectRun(href, String.raw`C:\repo\apps\desktop\scripts\run-electron-builder.mjs`, {
      resolve: value => value.replace(/\\/g, '/').replace(/^C:/, '/C:'),
      pathToFileURLHref: value => `file://${value}`
    }),
    true
  )
})
