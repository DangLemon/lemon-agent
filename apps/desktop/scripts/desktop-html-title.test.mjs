import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { desktopHtmlTitleForEnv, desktopHtmlTitlePlugin } from './desktop-html-title.mjs'

const source = `
  <html>
    <head>
      <link rel="icon" href="/%LEMON_DESKTOP_APP_ICON%" />
      <link rel="apple-touch-icon" href="/%LEMON_DESKTOP_APP_ICON%" />
      <link rel="shortcut icon" href="/%LEMON_DESKTOP_APP_ICON%" />
      <title>%LEMON_DESKTOP_APP_TITLE%</title>
    </head>
  </html>
`

function transformHtml(plugin, html) {
  return typeof plugin.transformIndexHtml === 'function'
    ? plugin.transformIndexHtml(html)
    : plugin.transformIndexHtml.handler(html)
}

test('ordinary desktop HTML keeps the Lemon AI title by default', () => {
  assert.equal(desktopHtmlTitleForEnv({}), 'Lemon AI')
  const plugin = desktopHtmlTitlePlugin({})
  const html = transformHtml(plugin, source)

  assert.equal(plugin.transformIndexHtml.order, 'pre')
  assert.match(html, /<title>Lemon AI<\/title>/)
  assert.equal(html.match(/\/lemon-apple-touch-icon\.png/g)?.length, 3)
})

test('internal desktop HTML uses the Lemon AI title', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-html-title-'))

  try {
    const config = path.join(root, 'internal.json')
    fs.writeFileSync(
      config,
      JSON.stringify({
        schemaVersion: 1,
        profile: 'internal',
        sourceRepository: 'DangLemon/lemon-agent',
        ui: { agents: false, cron: true, messaging: false, terminal: true, webhooks: false }
      })
    )
    const env = { LEMON_DESKTOP_HARNESS_CONFIG: config }

    assert.equal(desktopHtmlTitleForEnv(env), 'Lemon AI')
    const html = transformHtml(desktopHtmlTitlePlugin(env), source)

    assert.match(html, /<title>Lemon AI<\/title>/)
    assert.equal(html.match(/\/lemon-apple-touch-icon\.png/g)?.length, 3)
  } finally {
    fs.rmSync(root, { force: true, recursive: true })
  }
})

test('invalid internal harness input fails closed to the Lemon AI title', () => {
  const env = { LEMON_DESKTOP_HARNESS_CONFIG: '/missing/internal.json' }

  assert.equal(desktopHtmlTitleForEnv(env), 'Lemon AI')
  assert.match(transformHtml(desktopHtmlTitlePlugin(env), source), /<title>Lemon AI<\/title>/)
})
