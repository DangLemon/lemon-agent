import assert from 'node:assert/strict'

import { test } from 'vitest'

import { resolveGitBinaryPath } from './git-binary'

const no = () => false

test('Windows prefers PortableGit under selected Lemon LEMON_HOME before legacy Lemon AI and system Git', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\dang\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)'
  }

  const lemonCmd = 'C:\\Users\\dang\\AppData\\Local\\Lemon AI\\git\\cmd\\git.exe'
  const legacyLemonCmd = 'C:\\Users\\dang\\AppData\\Local\\lemon\\git\\cmd\\git.exe'

  const result = resolveGitBinaryPath({
    isWindows: true,
    env,
    fileExists: candidate => candidate === lemonCmd || candidate === legacyLemonCmd || candidate.includes('Program Files\\Git\\cmd\\git.exe'),
    findOnPath: () => 'C:\\PathGit\\git.exe',
    lemonHome: 'C:\\Users\\dang\\AppData\\Local\\Lemon AI',
    localAppDataProductDirs: ['Lemon AI', 'lemon']
  })

  assert.equal(result, lemonCmd)
})

test('Windows probes LEMON_HOME git cmd before bin', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\dang\\AppData\\Local' }
  const lemonCmd = 'C:\\Users\\dang\\AppData\\Local\\Lemon AI\\git\\cmd\\git.exe'
  const lemonBin = 'C:\\Users\\dang\\AppData\\Local\\Lemon AI\\git\\bin\\git.exe'

  assert.equal(
    resolveGitBinaryPath({
      isWindows: true,
      env,
      fileExists: candidate => candidate === lemonCmd || candidate === lemonBin,
      findOnPath: () => null,
      lemonHome: 'C:\\Users\\dang\\AppData\\Local\\Lemon AI',
      localAppDataProductDirs: ['lemon']
    }),
    lemonCmd
  )
})

test('Windows preserves legacy Lemon AI PortableGit fallback before system Git and PATH', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\dang\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files'
  }

  const legacyBin = 'C:\\Users\\dang\\AppData\\Local\\lemon\\git\\bin\\git.exe'

  assert.equal(
    resolveGitBinaryPath({
      isWindows: true,
      env,
      fileExists: candidate => candidate === legacyBin || candidate.includes('Program Files\\Git\\cmd\\git.exe'),
      findOnPath: () => 'C:\\PathGit\\git.exe',
      localAppDataProductDirs: ['lemon']
    }),
    legacyBin
  )
})

test('non-Windows uses git from PATH or bare git fallback', () => {
  assert.equal(
    resolveGitBinaryPath({ isWindows: false, env: {}, fileExists: no, findOnPath: command => command === 'git' ? '/usr/bin/git' : null }),
    '/usr/bin/git'
  )
  assert.equal(resolveGitBinaryPath({ isWindows: false, env: {}, fileExists: no, findOnPath: () => null }), 'git')
})
