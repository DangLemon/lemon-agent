/**
 * Tests for electron/desktop-uninstall.ts.
 *
 * Run with: node --test electron/desktop-uninstall.test.ts
 * (Wired into npm test:desktop:platforms in package.json.)
 *
 * These are the pure helpers behind the desktop Chat GUI uninstaller: the
 * mode → CLI-flag mapping, the running-app-bundle resolution per OS, and the
 * cleanup-script builders (POSIX + Windows).
 */

import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  buildPosixCleanupScript,
  buildWindowsCleanupScript,
  modeRemovesAgent,
  modeRemovesUserData,
  resolveRemovableAppPath,
  safeRuntimeEnvEntries,
  shouldRemoveAppBundle,
  UNINSTALL_MODES,
  uninstallArgsForMode
} from './desktop-uninstall'

// --- uninstallArgsForMode ---

test('uninstallArgsForMode maps each mode to the module-runner argv', () => {
  assert.deepEqual(uninstallArgsForMode('gui'), ['-m', 'lemon_cli.uninstall', '--mode', 'gui'])
  assert.deepEqual(uninstallArgsForMode('lite'), ['-m', 'lemon_cli.uninstall', '--mode', 'lite'])
  assert.deepEqual(uninstallArgsForMode('full'), ['-m', 'lemon_cli.uninstall', '--mode', 'full'])
})

test('uninstallArgsForMode throws on an unknown mode (no silent full wipe)', () => {
  assert.throws(() => uninstallArgsForMode('nuke'), /Unknown uninstall mode/)
  assert.throws(() => uninstallArgsForMode(''), /Unknown uninstall mode/)
})

test('UNINSTALL_MODES lists exactly the three supported modes', () => {
  assert.deepEqual([...UNINSTALL_MODES].sort(), ['full', 'gui', 'lite'])
})

// --- modeRemovesAgent / modeRemovesUserData ---

test('mode predicates classify what each mode removes', () => {
  assert.equal(modeRemovesAgent('gui'), false)
  assert.equal(modeRemovesAgent('lite'), true)
  assert.equal(modeRemovesAgent('full'), true)

  assert.equal(modeRemovesUserData('gui'), false)
  assert.equal(modeRemovesUserData('lite'), false)
  assert.equal(modeRemovesUserData('full'), true)
})

// --- resolveRemovableAppPath ---

test('resolveRemovableAppPath finds the .app bundle on macOS', () => {
  assert.equal(
    resolveRemovableAppPath('/Applications/Lemon AI.app/Contents/MacOS/Lemon AI', 'darwin'),
    '/Applications/Lemon AI.app'
  )
  assert.equal(
    resolveRemovableAppPath('/Users/x/Applications/Lemon AI.app/Contents/MacOS/Lemon AI', 'darwin'),
    '/Users/x/Applications/Lemon AI.app'
  )
})

test('resolveRemovableAppPath: dev-run .app resolves (safety is shouldRemoveAppBundle, not null)', () => {
  // A dev run from node_modules' Electron DOES resolve to a .app — the real
  // dev-run safety gate is shouldRemoveAppBundle(isPackaged=false,...), not a
  // null return here. This test documents that contract.
  assert.equal(
    resolveRemovableAppPath('/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', 'darwin'),
    '/repo/node_modules/electron/dist/Electron.app'
  )
  assert.equal(shouldRemoveAppBundle(false, '/repo/node_modules/electron/dist/Electron.app'), false)
  // A bare path with no .app ancestor → null.
  assert.equal(resolveRemovableAppPath('/usr/bin/electron', 'darwin'), null)
})

test('resolveRemovableAppPath finds the install dir on Windows', () => {
  assert.equal(
    resolveRemovableAppPath('C:\\Users\\x\\AppData\\Local\\Programs\\Lemon AI\\Lemon AI.exe', 'win32'),
    'C:\\Users\\x\\AppData\\Local\\Programs\\Lemon AI'
  )
  assert.equal(
    resolveRemovableAppPath('C:\\Users\\x\\AppData\\Local\\Programs\\Lemon AI\\Lemon AI.exe', 'win32'),
    'C:\\Users\\x\\AppData\\Local\\Programs\\Lemon AI'
  )
  assert.equal(
    resolveRemovableAppPath('C:\\Users\\x\\AppData\\Local\\lemon-desktop\\Lemon AI.exe', 'win32'),
    'C:\\Users\\x\\AppData\\Local\\lemon-desktop'
  )
})

test('resolveRemovableAppPath returns null for an unrecognized Windows dir', () => {
  assert.equal(resolveRemovableAppPath('C:\\Temp\\foo\\Lemon AI.exe', 'win32'), null)
})

test('resolveRemovableAppPath uses APPIMAGE on Linux when set', () => {
  assert.equal(
    resolveRemovableAppPath('/tmp/.mount_LemonXXXX/lemon', 'linux', { APPIMAGE: '/home/x/Apps/Lemon AI.AppImage' }),
    '/home/x/Apps/Lemon AI.AppImage'
  )
})

test('resolveRemovableAppPath finds the unpacked dir on Linux', () => {
  assert.equal(resolveRemovableAppPath('/opt/lemon/linux-unpacked/lemon', 'linux', {}), '/opt/lemon/linux-unpacked')
  // A system-package install (/usr/bin) → null, left to apt/dnf.
  assert.equal(resolveRemovableAppPath('/usr/bin/lemon', 'linux', {}), null)
})

test('resolveRemovableAppPath returns null for an empty exe path', () => {
  assert.equal(resolveRemovableAppPath('', 'darwin'), null)
  assert.equal(resolveRemovableAppPath(null, 'win32'), null)
})

// --- shouldRemoveAppBundle ---

test('shouldRemoveAppBundle requires packaged AND a resolved path', () => {
  assert.equal(shouldRemoveAppBundle(true, '/Applications/Lemon AI.app'), true)
  assert.equal(shouldRemoveAppBundle(false, '/Applications/Lemon AI.app'), false)
  assert.equal(shouldRemoveAppBundle(true, null), false)
  assert.equal(shouldRemoveAppBundle(false, null), false)
})

// --- buildPosixCleanupScript ---

test('buildPosixCleanupScript waits for the PID, runs the uninstall module, removes bundle', () => {
  const script = buildPosixCleanupScript({
    desktopPid: 4321,
    pythonExe: '/home/x/.lemon-ai/lemon-agent/venv/bin/python',
    pythonPath: null,
    agentRoot: '/home/x/.lemon-ai/lemon-agent',
    uninstallArgs: ['-m', 'lemon_cli.uninstall', '--mode', 'gui'],
    appPath: '/opt/lemon/linux-unpacked',
    lemonHome: '/home/x/.lemon-ai'
  })

  assert.match(script, /^#!\/bin\/bash/)
  assert.match(script, /pid=4321/)
  assert.match(script, /kill -0 "\$pid"/)
  // bounded wait (~30s), not unbounded
  assert.match(script, /seq 1 60/)
  assert.match(script, /'-m' 'lemon_cli\.uninstall' '--mode' 'gui'/)
  assert.match(script, /rm -rf '\/opt\/lemon\/linux-unpacked'/)
  assert.match(script, /export LEMON_HOME='\/home\/x\/\.lemon-ai'/)
})

test('buildPosixCleanupScript exports PYTHONPATH when pythonPath is set (lite/full)', () => {
  const script = buildPosixCleanupScript({
    desktopPid: 1,
    pythonExe: '/usr/bin/python3',
    pythonPath: '/home/x/.lemon-ai/lemon-agent',
    agentRoot: '/home/x/.lemon-ai/lemon-agent',
    uninstallArgs: ['-m', 'lemon_cli.uninstall', '--mode', 'full'],
    appPath: null,
    lemonHome: '/home/x/.lemon-ai'
  })

  // System python + source on PYTHONPATH so import lemon_cli works while the
  // venv is torn down.
  assert.match(script, /export PYTHONPATH='\/home\/x\/\.lemon-ai\/lemon-agent'/)
  assert.match(script, /'\/usr\/bin\/python3' '-m' 'lemon_cli\.uninstall' '--mode' 'full'/)
})

test('buildPosixCleanupScript carries validated Lemon identity into detached cleanup', () => {
  const script = buildPosixCleanupScript({
    desktopPid: 1,
    pythonExe: '/usr/bin/python3',
    pythonPath: '/home/x/.lemon-ai/lemon-agent',
    agentRoot: '/home/x/.lemon-ai/lemon-agent',
    uninstallArgs: ['-m', 'lemon_cli.uninstall', '--mode', 'full'],
    appPath: '/Applications/Lemon AI.app',
    lemonHome: '/home/x/.lemon-ai',
    runtimeEnv: {
      LEMON_DESKTOP_INTERNAL: '1',
      LEMON_UPDATE_PRODUCT_NAME: 'Lemon AI',
      LEMON_UPDATE_REPOSITORY: 'DangLemon/lemon-agent',
      LEMON_HOME: '/should/not/override',
      'BAD-NAME': 'ignored'
    }
  })

  assert.match(script, /export LEMON_DESKTOP_INTERNAL='1'/)
  assert.match(script, /export LEMON_UPDATE_PRODUCT_NAME='Lemon AI'/)
  assert.match(script, /export LEMON_UPDATE_REPOSITORY='DangLemon\/lemon-agent'/)
  assert.doesNotMatch(script, /should\/not\/override/)
  assert.doesNotMatch(script, /BAD-NAME/)
})

test('safeRuntimeEnvEntries preserves Lemon home and runtime overrides', () => {
  const entries = safeRuntimeEnvEntries({
    LEMON_DESKTOP_HOME_OVERRIDE: '/Users/dang/.lemon-ai',
    LEMON_DESKTOP_RUNTIME_DIR_NAME: 'lemon-agent',
    LEMON_UPDATE_REPOSITORY: 'DangLemon/lemon-agent',
    LEMON_HOME: '/should/not/be duplicated'
  })

  assert.deepEqual(entries, [
    ['LEMON_DESKTOP_HOME_OVERRIDE', '/Users/dang/.lemon-ai'],
    ['LEMON_DESKTOP_RUNTIME_DIR_NAME', 'lemon-agent'],
    ['LEMON_UPDATE_REPOSITORY', 'DangLemon/lemon-agent']
  ])
})

test('buildPosixCleanupScript omits PYTHONPATH when pythonPath is null (gui)', () => {
  const script = buildPosixCleanupScript({
    desktopPid: 1,
    pythonExe: '/p/python',
    pythonPath: null,
    agentRoot: '/a',
    uninstallArgs: ['-m', 'lemon_cli.uninstall', '--mode', 'gui'],
    appPath: null,
    lemonHome: '/h'
  })

  assert.doesNotMatch(script, /export PYTHONPATH/)
})

test('buildPosixCleanupScript omits the bundle rm when appPath is null', () => {
  const script = buildPosixCleanupScript({
    desktopPid: 1,
    pythonExe: '/p/python',
    pythonPath: null,
    agentRoot: '/a',
    uninstallArgs: ['-m', 'lemon_cli.uninstall', '--mode', 'lite'],
    appPath: null,
    lemonHome: '/h'
  })

  assert.doesNotMatch(script, /rm -rf '\//)
  // Still runs the uninstall.
  assert.match(script, /'-m' 'lemon_cli\.uninstall' '--mode' 'lite'/)
})

test('buildPosixCleanupScript single-quote-escapes paths with apostrophes', () => {
  const script = buildPosixCleanupScript({
    desktopPid: 1,
    pythonExe: "/home/o'brien/python",
    pythonPath: null,
    agentRoot: '/a',
    uninstallArgs: ['-m', 'lemon_cli.uninstall', '--mode', 'gui'],
    appPath: null,
    lemonHome: '/h'
  })

  // The apostrophe is closed-escaped-reopened so the shell sees the literal.
  assert.match(script, /'\/home\/o'\\''brien\/python'/)
})

// --- buildWindowsCleanupScript ---

test('buildWindowsCleanupScript waits (bounded) for PID, runs uninstall, rmdir bundle', () => {
  const script = buildWindowsCleanupScript({
    desktopPid: 9988,
    pythonExe: 'C:\\Python313\\python.exe',
    pythonPath: 'C:\\lemon',
    agentRoot: 'C:\\lemon',
    uninstallArgs: ['-m', 'lemon_cli.uninstall', '--mode', 'full'],
    appPath: 'C:\\Users\\x\\AppData\\Local\\Programs\\Lemon AI',
    lemonHome: 'C:\\Users\\x\\AppData\\Local\\lemon'
  })

  assert.match(script, /@echo off/)
  assert.match(script, /set "PID=9988"/)
  // PYTHONPATH set so a system python can import lemon_cli from source.
  assert.match(script, /set "PYTHONPATH=C:\\lemon;%PYTHONPATH%"/)
  assert.match(script, /"C:\\Python313\\python.exe" "-m" "lemon_cli\.uninstall" "--mode" "full"/)
  // Bounded wait-loop (no infinite loop), whole-token PID match (no substring).
  assert.match(script, /if %waited% geq 60 goto waited_done/)
  assert.match(script, /findstr \/r \/c:" %PID% "/)
  assert.doesNotMatch(script, /find "%PID%"/) // the old substring-prone form is gone
  // Removal is a retry loop (Windows releases dir handles lazily).
  assert.match(script, /:rmloop/)
  assert.match(script, /rmdir \/s \/q "C:\\Users\\x\\AppData\\Local\\Programs\\Lemon AI" >nul 2>&1/)
  assert.match(script, /if %tries% geq 10 goto rmdone/)
  assert.match(script, /del "%~f0"/)
})

test('buildWindowsCleanupScript omits PYTHONPATH + rmdir when not needed (gui, no bundle)', () => {
  const script = buildWindowsCleanupScript({
    desktopPid: 2,
    pythonExe: 'C:\\h\\venv\\Scripts\\python.exe',
    pythonPath: null,
    agentRoot: 'C:\\h',
    uninstallArgs: ['-m', 'lemon_cli.uninstall', '--mode', 'gui'],
    appPath: null,
    lemonHome: 'C:\\h'
  })

  assert.doesNotMatch(script, /rmdir/)
  assert.doesNotMatch(script, /set "PYTHONPATH=/)
})

test('buildWindowsCleanupScript carries validated Lemon identity into detached cleanup', () => {
  const script = buildWindowsCleanupScript({
    desktopPid: 2,
    pythonExe: 'C:\\Python313\\python.exe',
    pythonPath: null,
    agentRoot: 'C:\\Lemon AI\\lemon-agent',
    uninstallArgs: ['-m', 'lemon_cli.uninstall', '--mode', 'gui'],
    appPath: null,
    lemonHome: 'C:\\Lemon AI',
    runtimeEnv: {
      LEMON_DESKTOP_INTERNAL: '1',
      LEMON_UPDATE_PRODUCT_NAME: 'Lemon AI',
      LEMON_UPDATE_REPOSITORY: 'DangLemon/lemon-agent',
      PYTHONPATH: 'ignored',
      'BAD-NAME': 'ignored'
    }
  })

  assert.match(script, /set "LEMON_DESKTOP_INTERNAL=1"/)
  assert.match(script, /set "LEMON_UPDATE_PRODUCT_NAME=Lemon AI"/)
  assert.match(script, /set "LEMON_UPDATE_REPOSITORY=DangLemon\/lemon-agent"/)
  assert.doesNotMatch(script, /PYTHONPATH=ignored/)
  assert.doesNotMatch(script, /BAD-NAME/)
})
