import assert from 'node:assert/strict'

import { test } from 'vitest'

import { hasWindowsPathPrefix, isLemonOwnedVenvDaemon } from './venv-holder-select'

const SCRIPTS = 'C:\\Lemon AI\\venv\\Scripts'

test('matches the hindsight daemon shim (exe under venv Scripts + hindsight cmdline)', () => {
  assert.equal(
    isLemonOwnedVenvDaemon(
      'C:\\Lemon AI\\venv\\Scripts\\pythonw.exe',
      'C:\\Lemon AI\\venv\\Scripts\\pythonw.exe -m hindsight_api.main --daemon --idle-timeout 300 --port 9177',
      SCRIPTS
    ),
    true
  )
})

test('Windows path prefix match is ordinal case-insensitive', () => {
  assert.equal(
    isLemonOwnedVenvDaemon(
      'c:\\lemon\\venv\\scripts\\python.exe',
      'python.exe -m hindsight_api.main --daemon',
      'C:\\Lemon AI\\venv\\Scripts'
    ),
    true
  )
})

test('excludes external venv holders that are not the hindsight daemon', () => {
  // a user terminal running the lemon CLI from the venv — must NOT be killed
  assert.equal(isLemonOwnedVenvDaemon('C:\\Lemon AI\\venv\\Scripts\\lemon.exe', 'lemon chat -q "hi"', SCRIPTS), false)
  // an unrelated python script using the venv interpreter
  assert.equal(
    isLemonOwnedVenvDaemon('C:\\Lemon AI\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
})

test('excludes exes outside the venv even when the cmdline mentions hindsight', () => {
  assert.equal(
    isLemonOwnedVenvDaemon('C:\\Other\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('prefix boundary: sibling dirs (ScriptsX) do not match', () => {
  assert.equal(hasWindowsPathPrefix('C:\\Lemon AI\\venv\\ScriptsX\\python.exe', SCRIPTS), false)
  assert.equal(hasWindowsPathPrefix('C:\\Lemon AI\\venv\\Scripts\\python.exe', SCRIPTS), true)
})

test('null/undefined fields never match', () => {
  assert.equal(isLemonOwnedVenvDaemon(null, 'x', SCRIPTS), false)
  assert.equal(isLemonOwnedVenvDaemon('C:\\Lemon AI\\venv\\Scripts\\pythonw.exe', null, SCRIPTS), false)
  assert.equal(isLemonOwnedVenvDaemon(undefined, undefined, SCRIPTS), false)
})
