import assert from 'node:assert/strict'
import path from 'node:path'

import { test } from 'vitest'

import { resolvePackagedAppIdentity } from './packaged-app-identity'

const releaseRoot = path.join('/tmp', 'desktop-release')

test('packaged resolver selects the Lemon AI macOS bundle', () => {
  const lemon = path.join(releaseRoot, 'mac-arm64', 'Lemon AI.app', 'Contents', 'MacOS', 'Lemon AI')
  const resolved = resolvePackagedAppIdentity({
    arch: 'arm64',
    exists: candidate => candidate === lemon,
    platform: 'darwin',
    releaseRoot
  })
  assert.deepEqual(resolved, { binaryPath: lemon, productName: 'Lemon AI' })
})

test('packaged resolver selects Lemon AI on Windows', () => {
  const lemon = path.join(releaseRoot, 'win-unpacked', 'Lemon AI.exe')
  assert.deepEqual(
    resolvePackagedAppIdentity({
      exists: candidate => candidate === lemon,
      platform: 'win32',
      releaseRoot
    }),
    { binaryPath: lemon, productName: 'Lemon AI' }
  )
})

test('packaged resolver selects the Lemon AI Linux executable', () => {
  const lemon = path.join(releaseRoot, 'linux-unpacked', 'lemon-ai')
  assert.deepEqual(
    resolvePackagedAppIdentity({
      exists: candidate => candidate === lemon,
      platform: 'linux',
      releaseRoot
    }),
    { binaryPath: lemon, productName: 'Lemon AI' }
  )
})
