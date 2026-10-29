import assert from 'node:assert/strict'

import { test } from 'vitest'

import { createBootstrapRunOwner } from './bootstrap-run-owner'

function deferred<T>() {
  let resolve!: (value: T) => void

  const promise = new Promise<T>(next => {
    resolve = next
  })

  return { promise, resolve }
}

test('concurrent bootstrap callers join the owned run until it settles', async () => {
  const owner = createBootstrapRunOwner<string>()
  const run = deferred<string>()
  let starts = 0

  const start = () => {
    starts += 1

    return run.promise
  }

  const first = owner.run(start)
  const second = owner.run(start)

  assert.equal(owner.active, true)
  assert.equal(first, second)
  await Promise.resolve()
  assert.equal(starts, 1)

  run.resolve('installed')
  assert.equal(await first, 'installed')
  assert.equal(owner.active, false)

  const next = await owner.run(async () => 'repaired')
  assert.equal(next, 'repaired')
})

test('a rejected bootstrap releases ownership for a later retry', async () => {
  const owner = createBootstrapRunOwner<string>()

  await assert.rejects(
    owner.run(async () => {
      throw new Error('install failed')
    }),
    /install failed/
  )
  assert.equal(owner.active, false)
  assert.equal(await owner.run(async () => 'installed'), 'installed')
})

test('reset refuses while the installer is active and queues new runs during reset', async () => {
  const owner = createBootstrapRunOwner<string>()
  const installation = deferred<string>()
  const reset = deferred<boolean>()
  const start = () => installation.promise
  const first = owner.run(start)

  assert.equal(await owner.reset(async () => true), false)
  assert.equal(owner.active, true)

  installation.resolve('done')
  await first

  const resetting = owner.reset(() => reset.promise)
  const next = owner.run(async () => 'next')
  assert.equal(owner.isResetting, true)
  assert.equal(owner.active, false)

  reset.resolve(true)
  assert.equal(await resetting, true)
  assert.equal(await next, 'next')
  assert.equal(owner.isResetting, false)
})

test('concurrent resets share the same reset operation', async () => {
  const owner = createBootstrapRunOwner<string>()
  const reset = deferred<boolean>()
  let resets = 0
  const startReset = () => {
    resets += 1

    return reset.promise
  }

  const first = owner.reset(startReset)
  const second = owner.reset(startReset)

  assert.equal(first, second)
  assert.equal(resets, 0)
  await Promise.resolve()
  assert.equal(resets, 1)

  reset.resolve(true)
  assert.equal(await first, true)
})

test('a failed reset releases reset ownership', async () => {
  const owner = createBootstrapRunOwner<string>()

  await assert.rejects(
    owner.reset(async () => {
      throw new Error('reset failed')
    }),
    /reset failed/
  )
  assert.equal(owner.isResetting, false)
  assert.equal(await owner.reset(async () => true), true)
})
