import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  buildDesktopRuntimeEnv,
  LEMON_AI_IDENTITY,
  LEMON_IDENTITY,
  resolveDefaultDesktopHome,
  resolveDesktopHomeOverride,
  resolveDesktopHomeOverrideFromWindowsRegistry,
  resolveDesktopHomeRegistryEnvVarName,
  resolveDesktopRuntimeDirNameOverride,
  resolveDesktopRuntimeDirNameOverrideFromWindowsRegistry,
  resolveDesktopRuntimeDirNameRegistryEnvVarName,
  resolveDesktopRuntimeIdentity,
  resolveDesktopRuntimeRoot,
  runtimeDisplayCopy
} from './desktop-runtime-identity'

test('all desktop selectors resolve the single Lemon AI identity', () => {
  assert.equal(resolveDesktopRuntimeIdentity(), LEMON_IDENTITY)
  assert.equal(resolveDesktopRuntimeIdentity({ internalHarnessRequested: true }), LEMON_IDENTITY)
  assert.equal(LEMON_AI_IDENTITY, LEMON_IDENTITY)
  assert.equal(LEMON_IDENTITY.appId, 'com.lemondigital.lemonai')
  assert.equal(LEMON_IDENTITY.appName, 'Lemon AI')
  assert.equal(LEMON_IDENTITY.posixHomeDirName, '.lemon-ai')
  assert.equal(LEMON_IDENTITY.windowsLocalAppDataDirName, 'Lemon AI')
  assert.equal(LEMON_IDENTITY.runtimeRootDirName, 'lemon-agent')
  assert.deepEqual(LEMON_IDENTITY.legacyPosixHomeDirNames, ['.hermes'])
  assert.deepEqual(LEMON_IDENTITY.legacyWindowsLocalAppDataDirNames, ['hermes'])
  assert.deepEqual(LEMON_IDENTITY.legacyRuntimeRootDirNames, ['hermes-agent'])
})

test('desktop runtime child env emits only Lemon runtime contracts', () => {
  assert.deepEqual(
    buildDesktopRuntimeEnv({
      activeRuntimeRoot: '/Users/test/.lemon-ai/lemon-agent',
      harnessResourcePath: '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness.json',
      lemonHome: '/Users/test/.lemon-ai',
      identity: LEMON_IDENTITY,
      internalBuild: true,
      updateRepository: 'DangLemon/lemon-agent'
    }),
    {
      LEMON_BOOTSTRAP_MARKER_NAME: '.lemon-ai-bootstrap-complete',
      LEMON_DESKTOP_HARNESS_CONFIG: '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness.json',
      LEMON_DESKTOP_HOME_OVERRIDE: '/Users/test/.lemon-ai',
      LEMON_DESKTOP_INTERNAL: '1',
      LEMON_DESKTOP_RUNTIME_DIR_NAME: 'lemon-agent',
      LEMON_HOME: '/Users/test/.lemon-ai',
      LEMON_INSTALL_RUNTIME_DIR_NAME: 'lemon-agent',
      LEMON_UPDATE_HANDOFF_LOG_NAME: 'lemon-ai-desktop-update-handoff.log',
      LEMON_UPDATE_MARKER_NAME: '.lemon-ai-update-in-progress',
      LEMON_UPDATE_PRODUCT_NAME: 'Lemon AI',
      LEMON_UPDATE_REPOSITORY: 'DangLemon/lemon-agent',
      LEMON_UPDATE_RESULT_NAME: '.lemon-ai-update-result.json',
      LEMON_UPDATE_TEMP_PREFIX: 'lemon-ai-update'
    }
  )
})

test('runtime display copy rewrites legacy Hermes branding', () => {
  const copy = runtimeDisplayCopy(LEMON_IDENTITY)
  assert.equal(copy.rewriteUserText('Hermes backend reads ~/.hermes/config.yaml.'), 'Lemon AI backend reads ~/.lemon-ai/config.yaml.')
  assert.equal(copy.backendName, 'Lemon AI backend')
  assert.equal(copy.gatewayName, 'Lemon AI gateway')
  assert.equal(copy.envPath, '~/.lemon-ai/.env')
})

test('desktop defaults and overrides use Lemon paths', () => {
  assert.equal(resolveDefaultDesktopHome({ homeDir: '/Users/test', identity: LEMON_IDENTITY }), '/Users/test/.lemon-ai')
  assert.equal(
    resolveDefaultDesktopHome({
      homeDir: 'C:\\Users\\test',
      identity: LEMON_IDENTITY,
      isWindows: true,
      localAppData: 'C:\\Users\\test\\AppData\\Local'
    }),
    'C:\\Users\\test\\AppData\\Local/Lemon AI'
  )
  assert.equal(resolveDesktopRuntimeRoot('/Users/test/.lemon-ai', LEMON_IDENTITY), '/Users/test/.lemon-ai/lemon-agent')
  assert.equal(resolveDesktopHomeRegistryEnvVarName(LEMON_IDENTITY), 'LEMON_HOME')
  assert.equal(resolveDesktopRuntimeDirNameRegistryEnvVarName(LEMON_IDENTITY), 'LEMON_INSTALL_RUNTIME_DIR_NAME')
  assert.equal(resolveDesktopHomeOverride({ LEMON_HOME: '/tmp/lemon' }, LEMON_IDENTITY), '/tmp/lemon')
  assert.equal(
    resolveDesktopRuntimeDirNameOverride({ LEMON_INSTALL_RUNTIME_DIR_NAME: 'custom-runtime' }, LEMON_IDENTITY),
    'custom-runtime'
  )
})

test('explicit desktop overrides bypass Windows registry reads', () => {
  const reads: string[] = []
  const env = {
    LEMON_DESKTOP_HOME_OVERRIDE: 'E:\\sandbox-home',
    LEMON_DESKTOP_RUNTIME_DIR_NAME: 'sandbox-runtime'
  }
  assert.equal(
    resolveDesktopHomeOverrideFromWindowsRegistry({
      env,
      identity: LEMON_IDENTITY,
      isWindows: true,
      readRegistry: name => {
        reads.push(name)
        return 'registry-value'
      }
    }),
    'E:\\sandbox-home'
  )
  assert.equal(
    resolveDesktopRuntimeDirNameOverrideFromWindowsRegistry({
      env,
      identity: LEMON_IDENTITY,
      isWindows: true,
      readRegistry: name => {
        reads.push(name)
        return 'registry-value'
      }
    }),
    'sandbox-runtime'
  )
  assert.deepEqual(reads, [])
})
