import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'

import {
  assertCanonicalSeedHelperBytes,
  readMachOArchitectures,
  readPEMachine,
  readWindowsVersionInfo,
  validateGeneratedConfig,
  validateHarnessManifest,
  validateMacCodeSignature,
  validateWindowsIdentity,
  validateNativePayload,
  validateStamp,
  verifyInternalInstaller
} from './verify-internal-installer.mjs'
import PACKAGE_JSON from '../package.json' with { type: 'json' }

const require = createRequire(import.meta.url)
const VALID_SHA = '18ae041373f413f4270057de1120e54f61ea2970'
const VALID_REF = 'codex/internal-installer-ci'
const VERSION = PACKAGE_JSON.version
const RENDERER_HARNESS_MARKER_FILENAME = 'lemon-ai-renderer-harness.json'
const WINDOWS_VERSION_INFO = {
  ProductName: 'Lemon AI',
  FileDescription: 'Lemon AI',
  CompanyName: 'Lemon Digital',
  LegalCopyright: 'Copyright (c) 2026 Lemon Digital'
}
const WINDOWS_NATIVE_VERSION_INFO_TIMEOUT_MS = 30_000

function withTempDir(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-installer-verify-'))
  const cleanup = () => fs.rmSync(tempRoot, { recursive: true, force: true })
  try {
    const result = fn(tempRoot)
    if (result && typeof result.then === 'function') {
      return result.finally(cleanup)
    }
    cleanup()
    return result
  } catch (error) {
    cleanup()
    throw error
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function validManifest() {
  return {
    schemaVersion: 1,
    profile: 'internal',
    sourceRepository: 'DangLemon/lemon-agent',
    ui: {
      agents: false,
      cron: true,
      messaging: false,
      terminal: true,
      webhooks: false
    },
    managedConfig: {
      mcp_servers: {
        'tiktok-ads': {
          url: 'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-layer',
          auth: 'oauth'
        },
        algolia: {
          url: 'https://mcp.algolia.com/mcp',
          auth: 'oauth',
          enabled: false
        },
        'amazon-ads': {
          url: 'https://advertising-ai.amazon.com/mcp',
          auth: 'oauth',
          oauth: {
            client_id: '${AMAZON_ADS_CLIENT_ID}',
            client_secret: '${AMAZON_ADS_CLIENT_SECRET}',
            redirect_uri: 'http://localhost:8000/auth/callback',
            redirect_port: 8000
          }
        }
      }
    },
    initialProvider: {
      id: 'lemon-ai-company',
      name: 'AI công ty',
      base_url: 'http://127.0.0.1:5173/v1',
      model: 'openai-codex-gpt-5-5',
      key_env: 'LEMON_AI_COMPANY_API_KEY'
    },
    credentialRequirements: {
      provider: {
        requiredEnv: ['LEMON_AI_COMPANY_API_KEY'],
        label: 'Company provider API key'
      },
      mcpServers: {
        'amazon-ads': {
          requiredEnv: ['AMAZON_ADS_CLIENT_ID', 'AMAZON_ADS_CLIENT_SECRET'],
          labels: {
            AMAZON_ADS_CLIENT_ID: 'Amazon Ads OAuth client ID',
            AMAZON_ADS_CLIENT_SECRET: 'Amazon Ads OAuth client secret'
          }
        }
      }
    }
  }
}

function validStamp() {
  return {
    schemaVersion: 1,
    commit: VALID_SHA,
    branch: VALID_REF,
    builtAt: '2026-09-09T04:00:00.000Z',
    dirty: false,
    source: 'ci'
  }
}

function validGeneratedConfig() {
  return {
    appId: 'com.lemondigital.lemonai',
    productName: 'Lemon AI',
    executableName: 'Lemon AI',
    artifactName: 'Lemon-AI-${version}-${os}-${arch}.${ext}',
    icon: 'assets/lemon-icon',
    extraMetadata: {
      name: 'lemon-ai',
      productName: 'Lemon AI',
      author: {
        name: 'Lemon Digital'
      },
      description: 'Native desktop shell for Lemon AI.',
      homepage: 'https://github.com/DangLemon/lemon-agent',
      bugs: {
        url: 'https://github.com/DangLemon/lemon-agent/issues'
      },
      repository: {
        type: 'git',
        url: 'git+https://github.com/DangLemon/lemon-agent.git'
      }
    },
    copyright: 'Copyright © 2026 Lemon Digital',
    mac: {
      executableName: 'Lemon AI',
      extendInfo: {
        CFBundleExecutable: 'Lemon AI',
        NSHumanReadableCopyright: 'Copyright © 2026 Lemon Digital'
      }
    },
    dmg: {
      title: 'Install Lemon AI'
    }
  }
}

function rendererHarnessMarker(manifest = validManifest()) {
  return {
    schemaVersion: 1,
    profile: 'internal',
    ui: manifest.ui
  }
}

function makeMachO(filePath, arch = 'arm64') {
  const cpu = arch === 'arm64' ? 0x0100000c : 0x01000007
  const buffer = Buffer.alloc(32)
  buffer.writeUInt32LE(0xfeedfacf, 0)
  buffer.writeUInt32LE(cpu, 4)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
}

function makeFatMachO(filePath) {
  const buffer = Buffer.alloc(48)
  buffer.writeUInt32BE(0xcafebabe, 0)
  buffer.writeUInt32BE(2, 4)
  buffer.writeUInt32BE(0x0100000c, 8)
  buffer.writeUInt32BE(0, 12)
  buffer.writeUInt32BE(0, 16)
  buffer.writeUInt32BE(0, 20)
  buffer.writeUInt32BE(0, 24)
  buffer.writeUInt32BE(0x01000007, 28)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
}

function makePE(filePath, { machine = 0x8664, versionInfo = true } = {}) {
  const strings = versionInfo
    ? Object.entries(WINDOWS_VERSION_INFO)
        .map(([key, value]) => `${key}\u0000${value}\u0000`)
        .join('\u0000')
    : ''
  const stringBuffer = Buffer.from(strings, 'utf16le')
  const buffer = Buffer.alloc(0x90 + stringBuffer.length)
  buffer.write('MZ', 0, 'ascii')
  buffer.writeUInt32LE(0x80, 0x3c)
  buffer.write('PE\u0000\u0000', 0x80, 'ascii')
  buffer.writeUInt16LE(machine, 0x84)
  stringBuffer.copy(buffer, 0x90)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, buffer)
}

function makePlist(filePath, values = {}) {
  const merged = {
    CFBundleDisplayName: 'Lemon AI',
    CFBundleName: 'Lemon AI',
    CFBundleExecutable: 'Lemon AI',
    NSHumanReadableCopyright: 'Copyright © 2026 Lemon Digital',
    ...values
  }
  const body = Object.entries(merged)
    .map(([key, value]) => `  <key>${key}</key>\n  <string>${value}</string>`)
    .join('\n')
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(
    filePath,
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`,
    'utf8'
  )
}

function makeMacCodeSignature(appPath) {
  fs.mkdirSync(path.join(appPath, 'Contents', '_CodeSignature'), { recursive: true })
  fs.writeFileSync(path.join(appPath, 'Contents', '_CodeSignature', 'CodeResources'), 'codesign-resources')
}

function makeMacFixture(root) {
  const appPath = path.join(root, 'release', 'mac-arm64', 'Lemon AI.app')
  const resources = path.join(appPath, 'Contents', 'Resources')
  const nodePty = path.join(resources, 'app.asar.unpacked', 'dist', 'node_modules', 'node-pty')
  fs.mkdirSync(path.join(appPath, 'Contents', 'MacOS'), { recursive: true })
  makeMachO(path.join(appPath, 'Contents', 'MacOS', 'Lemon AI'))
  makePlist(path.join(appPath, 'Contents', 'Info.plist'))
  makeMacCodeSignature(appPath)
  fs.mkdirSync(path.join(resources, 'app.asar.unpacked', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(resources, 'app.asar.unpacked', 'dist', 'index.html'), '<div></div>')
  writeJson(
    path.join(resources, 'app.asar.unpacked', 'dist', RENDERER_HARNESS_MARKER_FILENAME),
    rendererHarnessMarker()
  )
  writeJson(path.join(nodePty, 'package.json'), { name: 'node-pty' })
  fs.mkdirSync(path.join(nodePty, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(nodePty, 'lib', 'index.js'), 'module.exports = {}')
  makeMachO(path.join(nodePty, 'prebuilds', 'darwin-arm64', 'pty.node'))
  makeMachO(path.join(nodePty, 'prebuilds', 'darwin-arm64', 'spawn-helper'))
  fs.chmodSync(path.join(nodePty, 'prebuilds', 'darwin-arm64', 'spawn-helper'), 0o755)
  makeMachO(path.join(nodePty, 'prebuilds', 'darwin-x64', 'pty.node'), 'x64')

  const manifest = validManifest()
  writeJson(path.join(resources, 'lemon-ai-harness.json'), manifest)
  fs.writeFileSync(path.join(resources, 'lemon-ai-harness-seed.py'), '# seed helper\n', 'utf8')
  writeJson(path.join(resources, 'install-stamp.json'), validStamp())
  writeJson(path.join(root, 'apps', 'desktop', 'lemon-ai-desktop.config.json'), manifest)
  fs.mkdirSync(path.join(root, 'apps', 'desktop', 'electron'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'apps', 'desktop', 'electron', 'lemon-ai-harness-seed.py'),
    '# seed helper\n',
    'utf8'
  )
  writeJson(path.join(root, 'apps', 'desktop', 'build', 'electron-builder.generated.json'), validGeneratedConfig())
  fs.writeFileSync(path.join(root, 'release', `Lemon-AI-${VERSION}-mac-arm64.dmg`), 'dmg-bytes')

  return {
    platform: 'darwin',
    arch: 'arm64',
    appPath,
    installerPath: path.join(root, 'release', `Lemon-AI-${VERSION}-mac-arm64.dmg`),
    canonicalManifestPath: path.join(root, 'apps', 'desktop', 'lemon-ai-desktop.config.json'),
    generatedConfigPath: path.join(root, 'apps', 'desktop', 'build', 'electron-builder.generated.json'),
    outputDir: path.join(root, 'verified'),
    repoRoot: root,
    sourceSeedHelperPath: path.join(root, 'apps', 'desktop', 'electron', 'lemon-ai-harness-seed.py')
  }
}

function makeWindowsFixture(root) {
  const appPath = path.join(root, 'release', 'win-unpacked')
  const resources = path.join(appPath, 'resources')
  const nodePty = path.join(resources, 'app.asar.unpacked', 'dist', 'node_modules', 'node-pty')
  const getWindows = path.join(resources, 'app.asar.unpacked', 'dist', 'node_modules', 'get-windows')
  makePE(path.join(appPath, 'Lemon AI.exe'))
  fs.mkdirSync(path.join(resources, 'app.asar.unpacked', 'dist'), { recursive: true })
  fs.writeFileSync(path.join(resources, 'app.asar.unpacked', 'dist', 'index.html'), '<div></div>')
  writeJson(
    path.join(resources, 'app.asar.unpacked', 'dist', RENDERER_HARNESS_MARKER_FILENAME),
    rendererHarnessMarker()
  )
  writeJson(path.join(nodePty, 'package.json'), { name: 'node-pty' })
  fs.mkdirSync(path.join(nodePty, 'lib'), { recursive: true })
  fs.writeFileSync(path.join(nodePty, 'lib', 'index.js'), 'module.exports = {}')
  makePE(path.join(nodePty, 'prebuilds', 'win32-x64', 'pty.node'), { versionInfo: false })
  makePE(path.join(nodePty, 'prebuilds', 'darwin-x64', 'pty.node'), { machine: 0x014c, versionInfo: false })
  makePE(path.join(getWindows, 'lib', 'binding', 'napi-9-win32-unknown-x64', 'node-get-windows.node'), {
    versionInfo: false
  })

  const manifest = validManifest()
  writeJson(path.join(resources, 'lemon-ai-harness.json'), manifest)
  fs.writeFileSync(path.join(resources, 'lemon-ai-harness-seed.py'), '# seed helper\n', 'utf8')
  writeJson(path.join(resources, 'install-stamp.json'), validStamp())
  writeJson(path.join(root, 'apps', 'desktop', 'lemon-ai-desktop.config.json'), manifest)
  fs.mkdirSync(path.join(root, 'apps', 'desktop', 'electron'), { recursive: true })
  fs.writeFileSync(
    path.join(root, 'apps', 'desktop', 'electron', 'lemon-ai-harness-seed.py'),
    '# seed helper\n',
    'utf8'
  )
  writeJson(path.join(root, 'apps', 'desktop', 'build', 'electron-builder.generated.json'), validGeneratedConfig())
  fs.writeFileSync(path.join(root, 'release', `Lemon-AI-${VERSION}-win-x64.exe`), 'exe-installer-bytes')

  return {
    platform: 'win32',
    arch: 'x64',
    appPath,
    installerPath: path.join(root, 'release', `Lemon-AI-${VERSION}-win-x64.exe`),
    canonicalManifestPath: path.join(root, 'apps', 'desktop', 'lemon-ai-desktop.config.json'),
    generatedConfigPath: path.join(root, 'apps', 'desktop', 'build', 'electron-builder.generated.json'),
    outputDir: path.join(root, 'verified'),
    repoRoot: root,
    sourceSeedHelperPath: path.join(root, 'apps', 'desktop', 'electron', 'lemon-ai-harness-seed.py')
  }
}

function makeHostSuccessfulFixture(root) {
  const options = process.platform === 'win32' ? makeWindowsFixture(root) : makeMacFixture(root)
  return {
    ...options,
    ...(process.platform === 'win32' ? { readWindowsVersionInfo: windowsVersionInfoReader() } : {})
  }
}

function fixturePackagedManifestPath(options) {
  const resourcesPath =
    options.platform === 'darwin'
      ? path.join(options.appPath, 'Contents', 'Resources')
      : path.join(options.appPath, 'resources')
  return path.join(resourcesPath, 'lemon-ai-harness.json')
}

function fixtureRendererHarnessMarkerPath(options) {
  const resourcesPath =
    options.platform === 'darwin'
      ? path.join(options.appPath, 'Contents', 'Resources')
      : path.join(options.appPath, 'resources')
  return path.join(resourcesPath, 'app.asar.unpacked', 'dist', RENDERER_HARNESS_MARKER_FILENAME)
}

function gitSpawn(expectedSha = VALID_SHA) {
  return (command, args) => {
    assert.equal(command, 'git')
    assert.deepEqual(args, ['rev-parse', 'HEAD'])
    return { status: 0, stdout: `${expectedSha}\n`, stderr: '' }
  }
}

function codeSignSpawn({
  verifyStatus = 0,
  detailStatus = 0,
  policyStatus = 0,
  policyError,
  signatureOutput = 'Signature=adhoc\n'
} = {}) {
  const calls = []
  const spawn = (command, args) => {
    calls.push({ command, args })
    assert.equal(command, 'codesign')
    if (args.includes('--test-requirement')) {
      return {
        status: policyStatus,
        stdout: '',
        stderr: policyStatus === 0 || policyError ? '' : 'code failed to satisfy specified code requirement',
        error: policyError
      }
    }
    if (args.includes('--verify')) {
      return { status: verifyStatus, stdout: '', stderr: verifyStatus === 0 ? '' : 'bundle format is ambiguous' }
    }
    assert.deepEqual(args.slice(0, 2), ['-dv', '--verbose=4'])
    return { status: detailStatus, stdout: '', stderr: signatureOutput }
  }
  spawn.calls = calls
  return spawn
}

function windowsVersionInfoReader(info = WINDOWS_VERSION_INFO) {
  return () => info
}

function changedCanonicalManifest() {
  return {
    ...validManifest(),
    ui: {
      agents: true,
      cron: false,
      messaging: true,
      terminal: true,
      webhooks: true
    },
    managedConfig: {
      mcp_servers: {
        company_search: {
          url: 'https://mcp.lemon.example/sse',
          headers: {
            Authorization: 'Bearer ${LEMON_MCP_TOKEN}'
          }
        }
      }
    },
    initialProvider: {
      id: 'lemon-ai-company',
      name: 'Lemon AI',
      base_url: 'https://models.lemon.example/v1',
      model: 'company-approved-gpt-5.6',
      key_env: 'LEMON_MODEL_API_KEY'
    },
    credentialRequirements: {
      provider: {
        requiredEnv: ['LEMON_MODEL_API_KEY'],
        label: 'Lemon model API key'
      },
      mcpServers: {
        company_search: {
          requiredEnv: ['LEMON_MCP_TOKEN'],
          label: 'Lemon MCP token'
        }
      }
    }
  }
}

function electronExePath() {
  // Electron 42 no longer runs its binary download as an npm lifecycle
  // script. Requiring the package uses its supported resolver, which invokes
  // install.js when npm ci left the platform binary absent.
  return require('electron')
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('validateStamp requires exact CI source SHA and ref', () => {
  assert.throws(
    () =>
      validateStamp(
        { ...validStamp(), commit: VALID_SHA.slice(0, 12) },
        { expectedSha: VALID_SHA, expectedRef: VALID_REF }
      ),
    /install stamp commit/
  )
  assert.throws(
    () => validateStamp({ ...validStamp(), source: 'local' }, { expectedSha: VALID_SHA, expectedRef: VALID_REF }),
    /install stamp source/
  )
})

test('validateHarnessManifest requires the approved fork and canonical harness resource contract', () => {
  validateHarnessManifest(validManifest())
  assert.throws(
    () => validateHarnessManifest({ ...validManifest(), sourceRepository: 'NousResearch/hermes-agent' }),
    /sourceRepository/
  )
  const literalSecret = validManifest()
  literalSecret.initialProvider.api_key = 'sk-live-secret'
  assert.throws(() => validateHarnessManifest(literalSecret), /initialProvider\.api_key/)
})

test('verification accepts valid canonical model, UI, and MCP changes when packaged bytes match', () => {
  withTempDir(root => {
    const options = makeHostSuccessfulFixture(root)
    const manifest = changedCanonicalManifest()
    writeJson(fixturePackagedManifestPath(options), manifest)
    writeJson(fixtureRendererHarnessMarkerPath(options), rendererHarnessMarker(manifest))
    writeJson(options.canonicalManifestPath, manifest)

    const result = verifyInternalInstaller({
      ...options,
      expectedSha: VALID_SHA,
      expectedRef: VALID_REF,
      spawn: gitSpawn(),
      codeSignSpawn: codeSignSpawn()
    })

    assert.equal(result.manifest.initialProvider.model, 'company-approved-gpt-5.6')
    assert.deepEqual(Object.keys(result.manifest.managedConfig.mcp_servers), ['company_search'])
  })
})

test('binary readers detect Mach-O and PE CPU values', () => {
  withTempDir(root => {
    const macho = path.join(root, 'Lemon AI')
    const pe = path.join(root, 'Lemon AI.exe')
    makeMachO(macho)
    makePE(pe)
    assert.deepEqual(readMachOArchitectures(macho), [0x0100000c])
    assert.equal(readPEMachine(pe), 0x8664)
  })
})

test('macOS verification rejects universal or x64 Mach-O payloads', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    makeFatMachO(path.join(options.appPath, 'Contents', 'MacOS', 'Lemon AI'))
    assert.throws(
      () =>
        verifyInternalInstaller({
          ...options,
          expectedSha: VALID_SHA,
          expectedRef: VALID_REF,
          spawn: gitSpawn(),
          codeSignSpawn: codeSignSpawn()
        }),
      /must contain only arm64/
    )
  })
})

test('macOS verification fails when Lemon plist metadata is missing', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    makePlist(path.join(options.appPath, 'Contents', 'Info.plist'), { CFBundleDisplayName: 'Hermes Agent' })
    assert.throws(
      () =>
        verifyInternalInstaller({
          ...options,
          expectedSha: VALID_SHA,
          expectedRef: VALID_REF,
          spawn: gitSpawn(),
          codeSignSpawn: codeSignSpawn()
        }),
      /CFBundleDisplayName/
    )
  })
})

test('macOS verification requires CodeResources before accepting a signed app bundle', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    fs.rmSync(path.join(options.appPath, 'Contents', '_CodeSignature'), { recursive: true, force: true })
    assert.throws(() => validateMacCodeSignature(options.appPath, { spawn: codeSignSpawn() }), /CodeResources/)
  })
})

test('macOS verification rejects apps that fail strict codesign verification', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    assert.throws(
      () => validateMacCodeSignature(options.appPath, { spawn: codeSignSpawn({ verifyStatus: 1 }) }),
      /codesign verification failed/
    )
  })
})

test('macOS code signature verification reports ad-hoc after strict codesign passes', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    const result = validateMacCodeSignature(options.appPath, { spawn: codeSignSpawn() })

    assert.equal(result.signature, 'adhoc')
  })
})

const nonWindowsTest = process.platform === 'win32' ? test.skip : test

nonWindowsTest('macOS verification writes an ad-hoc signature receipt after strict codesign passes', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    const result = verifyInternalInstaller({
      ...options,
      expectedSha: VALID_SHA,
      expectedRef: VALID_REF,
      spawn: gitSpawn(),
      codeSignSpawn: codeSignSpawn()
    })

    assert.equal(result.receipt.signature, 'adhoc')
    assert.equal(result.receipt.checks.codeSignature, true)
  })
})

test('macOS verification requires Apple Developer ID code requirement before developer-id receipt', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    const spawn = codeSignSpawn({
      signatureOutput: 'Authority=Developer ID Application: Lookalike Corp\n'
    })
    const result = validateMacCodeSignature(options.appPath, { spawn })

    assert.equal(result.signature, 'developer-id')
    assert.equal(
      spawn.calls.some(call => call.args.includes('--test-requirement')),
      true
    )
    assert.equal(
      spawn.calls
        .find(call => call.args.includes('--test-requirement'))
        .args.includes('=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists'),
      true
    )
  })
})

test('macOS verification rejects Developer ID lookalike names when Apple code requirement fails', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    assert.throws(
      () =>
        validateMacCodeSignature(options.appPath, {
          spawn: codeSignSpawn({
            policyStatus: 1,
            signatureOutput: 'Authority=Developer ID Application: Lookalike Corp\n'
          })
        }),
      /Developer ID code requirement failed/
    )
  })
})

test('macOS verification rejects Developer ID policy command timeouts', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    assert.throws(
      () =>
        validateMacCodeSignature(options.appPath, {
          spawn: codeSignSpawn({
            policyStatus: null,
            policyError: new Error('spawnSync codesign ETIMEDOUT'),
            signatureOutput: 'Authority=Developer ID Application: Lemon Digital\n'
          })
        }),
      /ETIMEDOUT/
    )
  })
})

test('Windows verification catches rcedit failures through executable VersionInfo', () => {
  withTempDir(root => {
    const options = makeWindowsFixture(root)
    assert.throws(
      () =>
        validateWindowsIdentity(path.join(options.appPath, 'Lemon AI.exe'), {
          readWindowsVersionInfo: windowsVersionInfoReader({})
        }),
      /VersionInfo ProductName/
    )
  })
})

test(
  'Windows VersionInfo reader does not accept synthetic UTF-16 strings as native resources',
  () => {
    withTempDir(root => {
      const exePath = path.join(root, 'Lemon AI.exe')
      makePE(exePath, { versionInfo: true })
      const expectedError =
        process.platform === 'win32'
          ? /PowerShell VersionInfo query failed|VersionInfo ProductName: missing native VersionInfo value/
          : /Windows VersionInfo requires Windows/
      assert.throws(() => readWindowsVersionInfo(exePath), expectedError)
    })
  },
  WINDOWS_NATIVE_VERSION_INFO_TIMEOUT_MS
)

const windowsOnlyTest = process.platform === 'win32' ? test : test.skip

windowsOnlyTest(
  'Windows VersionInfo reader reads real Electron executable resources',
  async () => {
    const { rcedit } = await import('rcedit')
    await withTempDir(async root => {
      const exePath = path.join(root, 'Lemon AI.exe')
      fs.copyFileSync(electronExePath(), exePath)
      await rcedit(exePath, {
        'version-string': WINDOWS_VERSION_INFO
      })

      assert.deepEqual(readWindowsVersionInfo(exePath), WINDOWS_VERSION_INFO)
    })
  },
  WINDOWS_NATIVE_VERSION_INFO_TIMEOUT_MS
)

test('Windows verification requires PE x64 for exe, node-pty, and get-windows selected payloads', () => {
  withTempDir(root => {
    const options = makeWindowsFixture(root)
    makePE(
      path.join(
        options.appPath,
        'resources',
        'app.asar.unpacked',
        'dist',
        'node_modules',
        'get-windows',
        'lib',
        'binding',
        'napi-9-win32-unknown-x64',
        'node-get-windows.node'
      ),
      { machine: 0x014c, versionInfo: false }
    )
    assert.throws(
      () =>
        verifyInternalInstaller({
          ...options,
          expectedSha: VALID_SHA,
          expectedRef: VALID_REF,
          spawn: gitSpawn(),
          readWindowsVersionInfo: windowsVersionInfoReader()
        }),
      /must be x64 PE machine/
    )
  })
})

test('verification ignores unused foreign native prebuilds and writes installer checksum receipt', () => {
  withTempDir(root => {
    const options = makeWindowsFixture(root)
    const result = verifyInternalInstaller({
      ...options,
      expectedSha: VALID_SHA,
      expectedRef: VALID_REF,
      spawn: gitSpawn(),
      readWindowsVersionInfo: windowsVersionInfoReader()
    })
    const installerName = `Lemon-AI-${VERSION}-win-x64.exe`
    assert.equal(fs.existsSync(path.join(options.outputDir, installerName)), true)
    assert.match(
      fs.readFileSync(path.join(options.outputDir, `${installerName}.sha256`), 'utf8'),
      new RegExp(`^[0-9a-f]{64} {2}${escapeRegex(installerName)}\\n$`)
    )
    const receipt = JSON.parse(fs.readFileSync(path.join(options.outputDir, 'installer-receipt.json'), 'utf8'))
    assert.equal(receipt.commit, VALID_SHA)
    assert.equal(receipt.ref, VALID_REF)
    assert.equal(receipt.platform, 'win32')
    assert.equal(receipt.arch, 'x64')
    assert.equal(receipt.sourceRepository, 'DangLemon/lemon-agent')
    assert.equal(receipt.checksumFile, `${installerName}.sha256`)
    assert.equal(result.nativePayload.nodePtyBinaries.length, 1)
  })
})

test('assertCanonicalSeedHelperBytes rejects packaged seed helper drift', () => {
  withTempDir(root => {
    const source = path.join(root, 'source.py')
    const packaged = path.join(root, 'packaged.py')
    fs.writeFileSync(source, '# seed helper\n', 'utf8')
    fs.writeFileSync(packaged, '# changed seed helper\n', 'utf8')

    assert.throws(
      () => assertCanonicalSeedHelperBytes({ sourceSeedHelperPath: source, packagedSeedHelperPath: packaged }),
      /seed helper bytes differ/
    )
  })
})

test('verification rejects missing packaged seed helper', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    fs.rmSync(path.join(options.appPath, 'Contents', 'Resources', 'lemon-ai-harness-seed.py'))

    assert.throws(
      () =>
        verifyInternalInstaller({
          ...options,
          expectedSha: VALID_SHA,
          expectedRef: VALID_REF,
          spawn: gitSpawn(),
          codeSignSpawn: codeSignSpawn()
        }),
      /missing packaged seed helper/
    )
  })
})

test('verification compares packaged manifest to generated canonical bytes, not source formatting', () => {
  withTempDir(root => {
    const options = makeHostSuccessfulFixture(root)
    fs.writeFileSync(options.canonicalManifestPath, JSON.stringify(validManifest()), 'utf8')
    const result = verifyInternalInstaller({
      ...options,
      expectedSha: VALID_SHA,
      expectedRef: VALID_REF,
      spawn: gitSpawn(),
      codeSignSpawn: codeSignSpawn()
    })
    assert.equal(result.manifest.sourceRepository, 'DangLemon/lemon-agent')
  })
})

test('verification rejects packaged manifest byte drift from canonical input', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    fs.appendFileSync(path.join(options.appPath, 'Contents', 'Resources', 'lemon-ai-harness.json'), '\n')
    assert.throws(
      () =>
        verifyInternalInstaller({
          ...options,
          expectedSha: VALID_SHA,
          expectedRef: VALID_REF,
          spawn: gitSpawn(),
          codeSignSpawn: codeSignSpawn()
        }),
      /manifest bytes differ/
    )
  })
})

test('verification rejects Lemon packages whose renderer was not compiled for the internal harness', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    fs.rmSync(
      path.join(options.appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'dist', RENDERER_HARNESS_MARKER_FILENAME)
    )

    assert.throws(
      () =>
        verifyInternalInstaller({
          ...options,
          expectedSha: VALID_SHA,
          expectedRef: VALID_REF,
          spawn: gitSpawn(),
          codeSignSpawn: codeSignSpawn()
        }),
      /renderer harness/i
    )
  })
})

test('verification rejects Lemon packages whose renderer marker is upstream', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    writeJson(
      path.join(
        options.appPath,
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'dist',
        RENDERER_HARNESS_MARKER_FILENAME
      ),
      { schemaVersion: 1, profile: 'upstream', ui: validManifest().ui }
    )

    assert.throws(
      () =>
        verifyInternalInstaller({
          ...options,
          expectedSha: VALID_SHA,
          expectedRef: VALID_REF,
          spawn: gitSpawn(),
          codeSignSpawn: codeSignSpawn()
        }),
      /renderer harness profile/
    )
  })
})

test('validateNativePayload rejects missing target node-pty binary', () => {
  withTempDir(root => {
    const options = makeMacFixture(root)
    fs.rmSync(
      path.join(
        options.appPath,
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'dist',
        'node_modules',
        'node-pty',
        'prebuilds',
        'darwin-arm64',
        'pty.node'
      ),
      { force: true }
    )
    assert.throws(
      () =>
        validateNativePayload({
          layout: {
            unpackedDistIndex: path.join(
              options.appPath,
              'Contents',
              'Resources',
              'app.asar.unpacked',
              'dist',
              'index.html'
            ),
            nodePtyRoot: path.join(
              options.appPath,
              'Contents',
              'Resources',
              'app.asar.unpacked',
              'dist',
              'node_modules',
              'node-pty'
            ),
            getWindowsRoot: ''
          },
          platform: 'darwin',
          arch: 'arm64'
        }),
      /missing node-pty native/
    )
  })
})

test('validateGeneratedConfig requires Lemon product and executable identity', () => {
  validateGeneratedConfig(validGeneratedConfig())
  assert.throws(
    () => validateGeneratedConfig({ ...validGeneratedConfig(), executableName: 'Hermes' }),
    /executableName/
  )
  assert.throws(
    () =>
      validateGeneratedConfig({
        ...validGeneratedConfig(),
        mac: {
          ...validGeneratedConfig().mac,
          extendInfo: {
            CFBundleExecutable: 'Hermes'
          }
        }
      }),
    /CFBundleExecutable/
  )
  assert.throws(() => validateGeneratedConfig({ ...validGeneratedConfig(), appId: 'com.nousresearch.lemon-ai' }), /appId/)
  assert.throws(
    () =>
      validateGeneratedConfig({
        ...validGeneratedConfig(),
        publish: [{ provider: 'github', owner: 'DangLemon', repo: 'lemon-agent' }]
      }),
    /publish/
  )
  assert.throws(
    () =>
      validateGeneratedConfig({
        ...validGeneratedConfig(),
        extraMetadata: { name: 'lemon', productName: 'Lemon AI' }
      }),
    /extraMetadata/
  )
})
