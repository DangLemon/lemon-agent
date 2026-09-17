import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { prepareElectronBundleDefines, resolveElectronBundleDefines } from './electron-bundle-identity.mjs'

const packagedKey = ['process', 'env', 'LEMON_DESKTOP_IS_PACKAGED'].join('.')
const internalPackageKey = ['process', 'env', 'LEMON_DESKTOP_INTERNAL_PACKAGE'].join('.')

const validResource = {
  schemaVersion: 1,
  profile: 'internal',
  ui: {
    agents: false,
    cron: true,
    messaging: false,
    terminal: true,
    webhooks: false
  }
}

function withHarnessConfig(run) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-bundle-identity-'))

  try {
    const configPath = path.join(tempRoot, 'lemon-ai-desktop.config.json')
    fs.writeFileSync(configPath, JSON.stringify(validResource), 'utf8')
    run(configPath)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

test('production bundle bakes immutable internal-package identity from the Lemon selector', () => {
  withHarnessConfig(configPath => {
    assert.deepEqual(
      resolveElectronBundleDefines({
        env: { LEMON_DESKTOP_HARNESS_CONFIG: configPath },
        isDev: false
      }),
      {
        [packagedKey]: 'true',
        [internalPackageKey]: JSON.stringify('1')
      }
    )
  })
})

test('production bundle remains compatible with the legacy Lemon AI selector', () => {
  withHarnessConfig(configPath => {
    assert.equal(
      resolveElectronBundleDefines({
        env: { LEMON_DESKTOP_HARNESS_CONFIG: configPath },
        isDev: false
      })[internalPackageKey],
      JSON.stringify('1')
    )
  })
})

test('ordinary production bundle bakes an empty internal-package identity by default', () => {
  assert.deepEqual(resolveElectronBundleDefines({ env: {}, isDev: false }), {
    [packagedKey]: 'true',
    [internalPackageKey]: JSON.stringify('')
  })
})

test('ordinary development bundle leaves package identity to the runtime environment', () => {
  assert.deepEqual(resolveElectronBundleDefines({ env: {}, isDev: true }), {})
})

test('Lemon AI installer brand keeps inherited Lemon selectors out of the bundle', () => {
  withHarnessConfig(configPath => {
    assert.deepEqual(resolveElectronBundleDefines({
      env: { LEMON_INSTALLER_BRAND: 'lemon', LEMON_DESKTOP_HARNESS_CONFIG: configPath },
      isDev: false
    }), {
      [packagedKey]: 'true',
      [internalPackageKey]: JSON.stringify('')
    })
  })
})

test('internal development bundle bakes Lemon identity before Electron reads userData', () => {
  withHarnessConfig(configPath => {
    assert.deepEqual(resolveElectronBundleDefines({ env: { LEMON_DESKTOP_HARNESS_CONFIG: configPath }, isDev: true }), {
      [internalPackageKey]: JSON.stringify('1')
    })
  })
})

test('clean development bundle materializes the Lemon harness for the Electron runtime', () => {
  withHarnessConfig(configPath => {
    const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-bundle-build-'))

    try {
      assert.deepEqual(
        prepareElectronBundleDefines({
          env: { LEMON_DESKTOP_HARNESS_CONFIG: configPath },
          isDev: true,
          buildDir
        }),
        { [internalPackageKey]: JSON.stringify('1') }
      )
      assert.deepEqual(
        JSON.parse(fs.readFileSync(path.join(buildDir, 'lemon-ai-harness.json'), 'utf8')),
        validResource
      )
      assert.equal(fs.existsSync(path.join(buildDir, 'lemon-ai-harness-seed.py')), true)
    } finally {
      fs.rmSync(buildDir, { recursive: true, force: true })
    }
  })
})

test('fresh desktop launch pins the sandbox home ahead of live Windows registry aliases', () => {
  const source = fs.readFileSync(new URL('./test-desktop.mjs', import.meta.url), 'utf8')

  assert.match(source, /env\.LEMON_DESKTOP_HOME_OVERRIDE = lemonHome/)
  assert.match(source, /env\.LEMON_DESKTOP_RUNTIME_DIR_NAME = PRIMARY_IDENTITY\.runtimeRootDirName/)
})
