import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  buildPinArgs,
  buildPosixPinArgs,
  cachedScriptPath,
  hasExistingGitCheckout,
  installerRuntimeEnv,
  installRefForStamp,
  isPinnedCommit,
  resolveBootstrapSourceRepository,
  resolveInstallScript,
  resolveMarkerPinnedCommit,
  runBootstrap
} from './bootstrap-runner'

const SCRIPT_NAME = process.platform === 'win32' ? 'install.ps1' : 'install.sh'
const ZERO_COMMIT = '0000000000000000000000000000000000000000'

function mkTmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-bootstrap-test-'))
}

test('runBootstrap bails immediately when the signal is already aborted', async () => {
  const controller = new AbortController()
  controller.abort()

  const events = []

  const result = await runBootstrap({
    installStamp: null,
    activeRoot: '/tmp/lemon-runner-test',
    sourceRepoRoot: null,
    lemonHome: '/tmp/lemon-runner-test',
    logRoot: '/tmp/lemon-runner-test',
    onEvent: ev => events.push(ev),
    abortSignal: controller.signal
  })

  assert.deepEqual(result, { ok: false, cancelled: true })
  assert.ok(
    events.some(ev => ev.type === 'failed' && /cancelled/i.test(ev.error)),
    'should emit a cancelled failure event'
  )
})

test('existing checkout detection requires git metadata', () => {
  const home = mkTmpHome()

  try {
    const activeRoot = path.join(home, 'lemon-agent')
    assert.equal(hasExistingGitCheckout(activeRoot), false)

    fs.mkdirSync(path.join(activeRoot, '.git'), { recursive: true })
    assert.equal(hasExistingGitCheckout(activeRoot), true)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('fresh bootstrap args include the packaged commit pin', () => {
  const installStamp = { commit: 'a'.repeat(40), branch: 'main' }

  assert.deepEqual(buildPinArgs(installStamp), ['-Commit', installStamp.commit, '-Branch', 'main'])
  assert.deepEqual(
    buildPosixPinArgs({
      installStamp,
      activeRoot: '/tmp/lemon-agent',
      lemonHome: '/tmp/lemon'
    }),
    ['--dir', '/tmp/lemon-agent', '--lemon-home', '/tmp/lemon', '--branch', 'main', '--commit', installStamp.commit]
  )
})

test('non-default bootstrap args include a validated source repository', () => {
  const installStamp = { commit: 'a'.repeat(40), branch: 'main' }

  assert.deepEqual(buildPinArgs(installStamp, { sourceRepository: 'ExampleOrg/internal-agent' }), [
    '-Repository',
    'ExampleOrg/internal-agent',
    '-Commit',
    installStamp.commit,
    '-Branch',
    'main'
  ])
  assert.deepEqual(
    buildPosixPinArgs({
      installStamp,
      activeRoot: '/tmp/lemon-agent',
      lemonHome: '/tmp/lemon',
      sourceRepository: 'ExampleOrg/internal-agent'
    }),
    [
      '--dir',
      '/tmp/lemon-agent',
      '--lemon-home',
      '/tmp/lemon',
      '--repo',
      'ExampleOrg/internal-agent',
      '--branch',
      'main',
      '--commit',
      installStamp.commit
    ]
  )
})

test('existing-checkout bootstrap args keep branch but skip the packaged commit pin', () => {
  const installStamp = { commit: 'a'.repeat(40), branch: 'main' }

  assert.deepEqual(buildPinArgs(installStamp, { pinCommit: false }), ['-Branch', 'main'])
  assert.deepEqual(
    buildPosixPinArgs({
      installStamp,
      activeRoot: '/tmp/lemon-agent',
      lemonHome: '/tmp/lemon',
      pinCommit: false
    }),
    ['--dir', '/tmp/lemon-agent', '--lemon-home', '/tmp/lemon', '--branch', 'main']
  )
})

test('fallback install stamps use an unpinned branch ref', () => {
  const stamp = { commit: ZERO_COMMIT, branch: 'main' }

  assert.equal(isPinnedCommit(ZERO_COMMIT), false)
  assert.deepEqual(installRefForStamp(stamp), {
    ref: 'main',
    cacheKey: 'branch-main',
    pinned: false
  })
  // Must NOT pass -Commit / --commit for the all-zero placeholder.
  assert.deepEqual(buildPinArgs(stamp), ['-Branch', 'main'])
  assert.deepEqual(
    buildPosixPinArgs({
      installStamp: stamp,
      activeRoot: '/tmp/lemon',
      lemonHome: '/tmp/home'
    }),
    ['--dir', '/tmp/lemon', '--lemon-home', '/tmp/home', '--branch', 'main']
  )
})

test('existing checkout installer ref follows the branch instead of the packaged commit', () => {
  const stamp = { commit: 'a'.repeat(40), branch: 'main' }

  assert.deepEqual(installRefForStamp(stamp, { pinCommit: false }), {
    ref: 'main',
    cacheKey: 'branch-main',
    pinned: false
  })
  assert.deepEqual(installRefForStamp(stamp), {
    ref: stamp.commit,
    cacheKey: stamp.commit,
    pinned: true
  })
})

test('resolveMarkerPinnedCommit prefers real HEAD over fallback stamp zeros', () => {
  const realHead = 'c'.repeat(40)
  assert.equal(
    resolveMarkerPinnedCommit({ commit: ZERO_COMMIT, branch: 'main' }, '/tmp/checkout', {
      resolveHead: () => realHead
    }),
    realHead
  )
  assert.equal(
    resolveMarkerPinnedCommit({ commit: 'd'.repeat(40), branch: 'main' }, '/tmp/checkout', {
      resolveHead: () => realHead
    }),
    'd'.repeat(40),
    'packaged real pin wins over checkout HEAD'
  )
  assert.equal(
    resolveMarkerPinnedCommit({ commit: ZERO_COMMIT, branch: 'main' }, '/tmp/missing', {
      resolveHead: () => null
    }),
    null
  )
})

test('resolveInstallScript downloads fallback stamps by branch instead of zero commit', async () => {
  const home = mkTmpHome()

  try {
    const logs = []
    const refs = []

    const result = await resolveInstallScript({
      installStamp: { commit: ZERO_COMMIT, branch: 'main' },
      sourceRepoRoot: null,
      lemonHome: home,
      emit: ev => logs.push(ev),
      _download: async (ref, destPath) => {
        refs.push(ref)
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.writeFileSync(destPath, '#!/bin/sh\necho fallback branch\n')

        return destPath
      }
    })

    assert.deepEqual(refs, ['main'])
    assert.equal(result.source, 'download')
    assert.equal(result.commit, null)
    assert.equal(result.path, cachedScriptPath(home, 'branch-main'))
    assert.ok(
      logs.some(ev => /unpinned branch/.test(ev.line || '')),
      'emits an unpinned branch log line'
    )
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveInstallScript downloads internal scripts from the harness repository and isolates cache entries', async () => {
  const home = mkTmpHome()

  try {
    const commit = 'b'.repeat(40)
    const calls = []

    const result = await resolveInstallScript({
      installStamp: { commit, branch: 'main' },
      sourceRepoRoot: null,
      lemonHome: home,
      sourceRepository: 'ExampleOrg/internal-agent',
      emit: () => {},
      _download: async (ref, destPath, sourceRepository) => {
        calls.push({ ref, destPath, sourceRepository })
        fs.mkdirSync(path.dirname(destPath), { recursive: true })
        fs.writeFileSync(destPath, '#!/bin/sh\necho internal\n')

        return destPath
      }
    })

    assert.deepEqual(calls.map(call => ({ ref: call.ref, sourceRepository: call.sourceRepository })), [
      { ref: commit, sourceRepository: 'ExampleOrg/internal-agent' }
    ])
    assert.equal(result.source, 'download')
    assert.equal(result.path, cachedScriptPath(home, commit, 'ExampleOrg/internal-agent'))
    assert.ok(result.path.includes('ExampleOrg__internal-agent'))
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveBootstrapSourceRepository reads packaged harness sourceRepository and rejects unsafe identities', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-source-repo-'))

  try {
    const resourcesPath = path.join(tempRoot, 'resources')
    fs.mkdirSync(resourcesPath, { recursive: true })
    fs.writeFileSync(
      path.join(resourcesPath, 'lemon-ai-harness.json'),
      JSON.stringify({ schemaVersion: 1, profile: 'internal', sourceRepository: 'DangLemon/lemon-agent', ui: { agents: false, cron: true, messaging: false, terminal: true, webhooks: false } }),
      'utf8'
    )

    assert.equal(resolveBootstrapSourceRepository({ resourcesPath, env: {} }), 'DangLemon/lemon-agent')

    fs.writeFileSync(
      path.join(resourcesPath, 'lemon-ai-harness.json'),
      JSON.stringify({ schemaVersion: 1, profile: 'internal', sourceRepository: 'https://github.com/DangLemon/lemon-agent', ui: { agents: false, cron: true, messaging: false, terminal: true, webhooks: false } }),
      'utf8'
    )
    assert.throws(() => resolveBootstrapSourceRepository({ resourcesPath, env: {} }), /sourceRepository/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('resolveBootstrapSourceRepository honors explicit update repository without packaged harness', () => {
  assert.equal(
    resolveBootstrapSourceRepository({
      resourcesPath: null,
      env: { LEMON_UPDATE_REPOSITORY: 'ExampleOrg/runtime-agent' }
    }),
    'ExampleOrg/runtime-agent'
  )
  assert.equal(
    resolveBootstrapSourceRepository({
      resourcesPath: null,
      env: { LEMON_INSTALL_REPOSITORY: 'InstallOrg/install-agent' }
    }),
    'InstallOrg/install-agent'
  )
  assert.equal(
    resolveBootstrapSourceRepository({
      resourcesPath: null,
      env: {
        LEMON_UPDATE_REPOSITORY: 'UpdateOrg/update-agent',
        LEMON_INSTALL_REPOSITORY: 'InstallOrg/install-agent'
      }
    }),
    'UpdateOrg/update-agent'
  )
  assert.throws(
    () =>
      resolveBootstrapSourceRepository({
        resourcesPath: null,
        env: { LEMON_UPDATE_REPOSITORY: 'https://github.com/DangLemon/lemon-agent' }
      }),
    /sourceRepository/
  )
})

test('resolveBootstrapSourceRepository lets packaged harness beat explicit environment repository', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-source-repo-packaged-precedence-'))

  try {
    const resourcesPath = path.join(tempRoot, 'resources')
    fs.mkdirSync(resourcesPath, { recursive: true })
    fs.writeFileSync(
      path.join(resourcesPath, 'lemon-ai-harness.json'),
      JSON.stringify({ schemaVersion: 1, profile: 'internal', sourceRepository: 'DangLemon/lemon-agent', ui: { agents: false, cron: true, messaging: false, terminal: true, webhooks: false } }),
      'utf8'
    )

    assert.equal(
      resolveBootstrapSourceRepository({
        resourcesPath,
        env: { LEMON_UPDATE_REPOSITORY: 'ExampleOrg/runtime-agent' }
      }),
      'DangLemon/lemon-agent'
    )
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('resolveBootstrapSourceRepository defaults an internal harness to the Lemon repository', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-source-repo-'))

  try {
    const resourcesPath = path.join(tempRoot, 'resources')
    fs.mkdirSync(resourcesPath, { recursive: true })
    fs.writeFileSync(
      path.join(resourcesPath, 'lemon-ai-harness.json'),
      JSON.stringify({
        schemaVersion: 1,
        profile: 'internal',
        ui: { agents: false, cron: true, messaging: false, terminal: true, webhooks: false }
      }),
      'utf8'
    )

    assert.equal(resolveBootstrapSourceRepository({ resourcesPath, env: {} }), 'DangLemon/lemon-agent')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('resolveBootstrapSourceRepository keeps an internal package on Lemon when its manifest is missing', () => {
  assert.equal(
    resolveBootstrapSourceRepository({
      resourcesPath: null,
      env: { LEMON_DESKTOP_INTERNAL_PACKAGE: '1' }
    }),
    'DangLemon/lemon-agent'
  )
  assert.equal(
    resolveBootstrapSourceRepository({
      resourcesPath: null,
      env: { LEMON_DESKTOP_INTERNAL: '1' }
    }),
    'DangLemon/lemon-agent'
  )
  assert.equal(
    resolveBootstrapSourceRepository({
      resourcesPath: null,
      env: { HERMES_DESKTOP_INTERNAL: '1' }
    }),
    'DangLemon/lemon-agent'
  )
  assert.equal(
    resolveBootstrapSourceRepository({ resourcesPath: null, env: {} }),
    'DangLemon/lemon-agent'
  )
})


test('resolveInstallScript refreshes the live branch for an existing checkout', async () => {
  const home = mkTmpHome()

  try {
    const commit = 'a'.repeat(40)
    const cached = cachedScriptPath(home, 'branch-main')
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, 'stale installer\n')

    const refs = []

    const result = await resolveInstallScript({
      installStamp: { commit, branch: 'main' },
      sourceRepoRoot: null,
      lemonHome: home,
      emit: () => {},
      pinCommit: false,
      _download: async (ref, destPath) => {
        refs.push(ref)
        fs.writeFileSync(destPath, 'fresh branch installer\n')

        return destPath
      }
    })

    assert.deepEqual(refs, ['main'])
    assert.equal(result.source, 'download')
    assert.equal(result.commit, null)
    assert.equal(result.path, cached)
    assert.equal(fs.readFileSync(cached, 'utf8'), 'fresh branch installer\n')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveInstallScript refreshes an immutable-pin cache on a fresh install', async () => {
  const home = mkTmpHome()

  try {
    const commit = 'a'.repeat(40)
    const cached = cachedScriptPath(home, commit)
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    fs.writeFileSync(cached, 'stale installer\n')

    const refs = []

    const result = await resolveInstallScript({
      installStamp: { commit, branch: 'main' },
      sourceRepoRoot: null,
      lemonHome: home,
      emit: () => {},
      _download: async (ref, destPath) => {
        refs.push(ref)
        fs.writeFileSync(destPath, 'fresh pinned installer\n')

        return destPath
      }
    })

    assert.deepEqual(refs, [commit])
    assert.equal(result.source, 'download')
    assert.equal(result.commit, commit)
    assert.equal(result.path, cached)
    assert.equal(fs.readFileSync(cached, 'utf8'), 'fresh pinned installer\n')
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('resolveInstallScript fails closed instead of executing an installed stale script', async () => {
  const home = mkTmpHome()

  try {
    const commit = 'a'.repeat(40)
    const scriptsDir = path.join(home, 'lemon-agent', 'scripts')
    fs.mkdirSync(scriptsDir, { recursive: true })
    fs.writeFileSync(path.join(scriptsDir, SCRIPT_NAME), 'stale installed script\n')

    await assert.rejects(
      resolveInstallScript({
        installStamp: { commit, branch: 'main' },
        sourceRepoRoot: null,
        lemonHome: home,
        emit: () => {},
        _download: async () => {
          throw new Error('Failed to download install script: HTTP 404')
        }
      }),
      /HTTP 404/
    )
    assert.equal(fs.existsSync(cachedScriptPath(home, commit)), false)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('installerRuntimeEnv carries Lemon home and runtime overrides to child scripts', () => {
  const env = installerRuntimeEnv({
    lemonHome: '/Users/dang/.lemon-ai',
    desktopHarnessConfigPath: '/app/resources/internal-desktop-harness.json',
    bootstrapMarkerName: '.lemon-ai-bootstrap-complete',
    desktopInternal: true,
    runtimeDirName: 'lemon-agent'
  })

  assert.equal(env.LEMON_HOME, '/Users/dang/.lemon-ai')
  assert.equal(env.LEMON_DESKTOP_HOME_OVERRIDE, '/Users/dang/.lemon-ai')
  assert.equal(env.LEMON_DESKTOP_RUNTIME_DIR_NAME, 'lemon-agent')
  assert.equal(env.LEMON_DESKTOP_INTERNAL, '1')
  assert.equal(env.LEMON_DESKTOP_HARNESS_CONFIG, '/app/resources/internal-desktop-harness.json')
})
