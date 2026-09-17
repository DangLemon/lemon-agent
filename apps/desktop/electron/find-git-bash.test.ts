import assert from 'node:assert/strict'

import { test } from 'vitest'

import { findGitBash } from './find-git-bash'

const yes = () => true
const no = () => false

test('LEMON_GIT_BASH_PATH override takes precedence', () => {
  const result = findGitBash({
    isWindows: true,
    env: { LEMON_GIT_BASH_PATH: 'D:\\CustomGit\\bin\\bash.exe' },
    fileExists: yes,
    findOnPath: () => null
  })

  assert.equal(result, 'D:\\CustomGit\\bin\\bash.exe')
})

test('LEMON_GIT_BASH_PATH invalid path falls through to candidates', () => {
  const env = {
    LEMON_GIT_BASH_PATH: 'X:\\Missing\\bash.exe',
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)'
  }

  const fileExists = (p: string) => p !== 'X:\\Missing\\bash.exe' && p.includes('Program Files\\Git\\bin\\bash.exe')
  const result = findGitBash({ isWindows: true, env, fileExists, findOnPath: () => null })
  assert.equal(result, 'C:\\Program Files\\Git\\bin\\bash.exe')
})

test('LEMON_GIT_BASH_PATH empty string is ignored', () => {
  const result = findGitBash({
    isWindows: true,
    env: { LEMON_GIT_BASH_PATH: '', LOCALAPPDATA: '' },
    fileExists: no,
    findOnPath: () => 'C:\\msys64\\usr\\bin\\bash.exe'
  })

  assert.equal(result, 'C:\\msys64\\usr\\bin\\bash.exe')
})

test('selected Lemon AI home and legacy Hermes product dirs precede system Git', () => {
  const env = {
    LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
    ProgramFiles: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)'
  }

  const lemon = 'C:\\Users\\test\\AppData\\Local\\Lemon AI\\git\\bin\\bash.exe'
  const legacy = 'C:\\Users\\test\\AppData\\Local\\hermes\\git\\bin\\bash.exe'

  assert.equal(
    findGitBash({
      isWindows: true,
      env,
      fileExists: p => p === lemon || p.includes('Program Files\\Git\\bin\\bash.exe'),
      findOnPath: () => null,
      lemonHome: 'C:\\Users\\test\\AppData\\Local\\Lemon AI',
      localAppDataProductDirs: ['Lemon AI', 'hermes']
    }),
    lemon
  )

  assert.equal(
    findGitBash({
      isWindows: true,
      env,
      fileExists: p => p === legacy || p.includes('Program Files\\Git\\bin\\bash.exe'),
      findOnPath: () => null,
      localAppDataProductDirs: ['Lemon AI', 'hermes']
    }),
    legacy
  )
})

test('non-Windows uses findOnPath', () => {
  const result = findGitBash({
    isWindows: false,
    env: {},
    fileExists: no,
    findOnPath: () => '/usr/bin/bash'
  })

  assert.equal(result, '/usr/bin/bash')
})
