import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { newestValidMacAppPath } from './mac-app-bundle.mjs'

function withTempDir(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-mac-app-bundle-'))
  try {
    return fn(root)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

function makeBundle(root, directory, { appMtime, executableMtime = 50, executable = true } = {}) {
  const appPath = path.join(root, directory, 'Lemon AI.app')
  const requiredFile = path.join(appPath, 'Contents', 'MacOS', 'Lemon AI')
  fs.mkdirSync(path.dirname(requiredFile), { recursive: true })
  fs.writeFileSync(requiredFile, '')
  fs.chmodSync(requiredFile, executable ? 0o755 : 0o644)
  fs.utimesSync(requiredFile, executableMtime, executableMtime)
  fs.utimesSync(appPath, appMtime, appMtime)
  return { appPath, requiredFile }
}

test('selects the Lemon AI bundle with the newest outer app', () => {
  withTempDir(root => {
    const older = makeBundle(root, 'mac', { appMtime: 100 })
    const newer = makeBundle(root, 'mac-arm64', { appMtime: 200 })
    assert.equal(newestValidMacAppPath([older, newer], newer.appPath), newer.appPath)
  })
})

const posixTest = process.platform === 'win32' ? test.skip : test

posixTest('requires the inner Lemon AI binary to be executable', () => {
  withTempDir(root => {
    const invalid = makeBundle(root, 'mac', { appMtime: 300, executable: false })
    const valid = makeBundle(root, 'mac-arm64', { appMtime: 200 })
    assert.equal(newestValidMacAppPath([invalid, valid], valid.appPath), valid.appPath)
  })
})
