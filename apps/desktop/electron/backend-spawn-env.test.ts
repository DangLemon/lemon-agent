import assert from 'node:assert/strict'

import { test } from 'vitest'

import { buildLemonBackendSpawnEnv } from './backend-spawn-env'

for (const label of ['primary', 'pooled'] as const) {
  test(`${label} backend spawn env carries managed dir from the selected local runtime descriptor`, () => {
    const env = buildLemonBackendSpawnEnv({
      processEnv: { PATH: '/usr/bin', LEMON_MANAGED_DIR: '/stale' },
      lemonHome: '/tmp/lemon-home',
      backendEnv: { PYTHONPATH: '/repo', LEMON_MANAGED_DIR: `/tmp/${label}-managed` },
      terminalCwd: '/tmp/lemon-home',
      sessionToken: 'session-token',
      parentIdentityEnv: { LEMON_DESKTOP_PARENT_PID: '123' },
      webDist: '/app/dist',
      readyFile: label === 'primary' ? '/tmp/ready.json' : null
    })

    assert.equal(env.LEMON_MANAGED_DIR, `/tmp/${label}-managed`)
    assert.equal(env.LEMON_HOME, '/tmp/lemon-home')
    assert.equal(env.LEMON_DESKTOP, '1')
    assert.equal(env.TERMINAL_CWD, '/tmp/lemon-home')
    assert.equal(env.LEMON_WEB_DIST, '/app/dist')
  })
}


test('resolver-provided PATH lemon CLI backend env reaches spawn env before config load', () => {
  const resolverOutput = { env: { LEMON_MANAGED_DIR: '/tmp/path-cli-managed', PYTHONUTF8: '1' } }

  const env = buildLemonBackendSpawnEnv({
    processEnv: { LEMON_MANAGED_DIR: '/stale' },
    lemonHome: '/tmp/lemon-home',
    backendEnv: resolverOutput.env,
    terminalCwd: '/tmp/lemon-home',
    sessionToken: 'token',
    webDist: '/dist'
  })

  assert.equal(env.LEMON_MANAGED_DIR, '/tmp/path-cli-managed')
})

test('resolver-provided system Python backend env reaches spawn env before config load', () => {
  const resolverOutput = { env: { LEMON_MANAGED_DIR: '/tmp/system-python-managed', PYTHONUTF8: '1' } }

  const env = buildLemonBackendSpawnEnv({
    processEnv: {},
    lemonHome: '/tmp/lemon-home',
    backendEnv: resolverOutput.env,
    terminalCwd: '/tmp/lemon-home',
    sessionToken: 'token',
    webDist: '/dist'
  })

  assert.equal(env.LEMON_MANAGED_DIR, '/tmp/system-python-managed')
})

test('Lemon desktop runtime identity reaches backend child env', () => {
  const env = buildLemonBackendSpawnEnv({
    processEnv: { LEMON_UPDATE_PRODUCT_NAME: 'stale' },
    runtimeEnv: {
      LEMON_DESKTOP_INTERNAL: '1',
      LEMON_HOME: '/tmp/.lemon-ai',
      LEMON_INSTALL_RUNTIME_DIR_NAME: 'lemon-agent',
      LEMON_UPDATE_MARKER_NAME: '.lemon-ai-update-in-progress',
      LEMON_UPDATE_PRODUCT_NAME: 'Lemon AI'
    },
    backendEnv: { LEMON_UPDATE_PRODUCT_NAME: 'resolver-stale' },
    lemonHome: '/tmp/.lemon-ai',
    terminalCwd: '/tmp/.lemon-ai',
    sessionToken: 'token',
    webDist: '/dist'
  })

  assert.equal(env.LEMON_DESKTOP_INTERNAL, '1')
  assert.equal(env.LEMON_HOME, '/tmp/.lemon-ai')
  assert.equal(env.LEMON_INSTALL_RUNTIME_DIR_NAME, 'lemon-agent')
  assert.equal(env.LEMON_UPDATE_MARKER_NAME, '.lemon-ai-update-in-progress')
  assert.equal(env.LEMON_UPDATE_PRODUCT_NAME, 'Lemon AI')
})
