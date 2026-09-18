import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  RENDERER_HARNESS_MARKER_FILENAME,
  harnessViteDefines,
  rendererHarnessMarkerFromDefines,
  rendererHarnessMarkerPlugin
} from '../vite.config'

function harnessResource(agents: boolean) {
  return {
    schemaVersion: 1,
    profile: 'internal',
    ui: { agents, cron: true, messaging: false, terminal: true, webhooks: false }
  }
}

function withHarnessConfig(run: (lemonPath: string) => void) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vite-config-harness-'))
  try {
    const lemonPath = path.join(tempRoot, 'lemon.json')
    fs.writeFileSync(lemonPath, JSON.stringify(harnessResource(false)), 'utf8')
    run(lemonPath)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function emittedRendererHarnessMarker(define: Record<string, string>) {
  const emitted: Array<{ fileName: string; source: string; type: 'asset' }> = []
  rendererHarnessMarkerPlugin(define).generateBundle.call({ emitFile: asset => emitted.push(asset) })
  return emitted
}

test('Vite compiles internal harness defines from the Lemon selector', () => {
  withHarnessConfig(lemonPath => {
    const define = harnessViteDefines({ LEMON_DESKTOP_HARNESS_CONFIG: lemonPath })
    assert.equal(define.__LEMON_DESKTOP_HARNESS__, JSON.stringify('internal'))
    assert.equal(define.__LEMON_HARNESS_SHOW_AGENTS__, JSON.stringify('false'))
  })
})

test('Vite emits the renderer harness marker from resolved internal defines', () => {
  withHarnessConfig(lemonPath => {
    const define = harnessViteDefines({ LEMON_DESKTOP_HARNESS_CONFIG: lemonPath })
    const marker = rendererHarnessMarkerFromDefines(define)
    assert.deepEqual(marker, harnessResource(false))
    const emitted = emittedRendererHarnessMarker(define)
    assert.equal(emitted.length, 1)
    assert.equal(emitted[0].fileName, RENDERER_HARNESS_MARKER_FILENAME)
    assert.deepEqual(JSON.parse(emitted[0].source), marker)
  })
})

test('Vite leaves harness features disabled when no selector is set', () => {
  const define = harnessViteDefines({})
  assert.equal(define.__LEMON_DESKTOP_HARNESS__, JSON.stringify(''))
  assert.equal(define.__LEMON_HARNESS_SHOW_AGENTS__, JSON.stringify('false'))
  assert.equal(define.__LEMON_HARNESS_SHOW_CRON__, JSON.stringify('true'))
  assert.equal(rendererHarnessMarkerFromDefines(define), null)
  assert.deepEqual(emittedRendererHarnessMarker(define), [])
})

test('Vite fails closed when the selected Lemon config is invalid', () => {
  const define = harnessViteDefines({ LEMON_DESKTOP_HARNESS_CONFIG: '/missing/lemon.json' })
  assert.equal(define.__LEMON_DESKTOP_HARNESS__, JSON.stringify(''))
  assert.equal(define.__LEMON_HARNESS_SHOW_AGENTS__, JSON.stringify('false'))
})
