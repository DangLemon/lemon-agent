/**
 * mcp-oauth-callback-ipc.ts
 *
 * Client-side loopback callback listener for MCP OAuth against a REMOTE
 * backend. The gateway's own `mcp.servers.oauth.start` flow binds its
 * callback listener on the BACKEND machine's 127.0.0.1 — unreachable from
 * the user's browser when Desktop connects over SSH/Tailscale, so the
 * provider redirect dies on the user's machine and the flow times out.
 *
 * This module gives the renderer the same primitive the native gateway
 * login uses (native-oauth-login.ts): bind an ephemeral one-shot listener
 * on the USER'S loopback, hand its URL to the gateway as the OAuth
 * redirect_uri (`client_redirect_uri` on oauth.start), and resolve with the
 * redirect's `code`/`state` so the renderer can relay them via
 * `mcp.servers.oauth.callback`.
 *
 * Security posture:
 *   - binds 127.0.0.1 on an ephemeral port; closes on first callback,
 *     cancel, or timeout — no long-lived listener;
 *   - the listener only ever RECEIVES `code`/`state` query params and
 *     forwards them to the renderer; no tokens are exchanged here — the
 *     gateway verifies `state` (constant-time) before redeeming anything;
 *   - the browser sees only a minimal "return to Lemon AI" page.
 */

import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { ipcMain } from 'electron'

const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_PENDING_LISTENERS = 8

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      "'": '&#39;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;'
    }

    return entities[character] || character
  })
}

export function mcpOauthDoneHtml(appName = 'Lemon AI'): string {
  const safeAppName = escapeHtml(appName.trim() || 'Lemon AI')

  return (
    '<!doctype html><meta charset="utf-8"><title>Authorization received</title>' +
    '<body style="font:15px system-ui;margin:3rem;text-align:center">' +
    '<h2>&#10003; Authorization received</h2>' +
    `<p>You can close this window and return to ${safeAppName}.</p>` +
    '<script>setTimeout(()=>window.close(),800)</script>'
  )
}

interface CallbackResult {
  code: null | string
  error: null | string
  state: null | string
}

interface ListenOptions {
  expectedState?: null | string
  redirectUri?: null | string
  timeoutMs?: null | number
}

interface PendingListener {
  lifetimeTimer: ReturnType<typeof setTimeout> | null
  result: CallbackResult | null
  server: http.Server
  settled: boolean
  waiters: Array<(result: CallbackResult) => void>
}

function parseListenOptions(options?: ListenOptions): {
  host: string
  path: string
  port: number
  redirectUri: string
} {
  const raw = typeof options?.redirectUri === 'string' ? options.redirectUri.trim() : ''

  if (!raw) {
    return { host: '127.0.0.1', path: '/callback', port: 0, redirectUri: '' }
  }

  let parsed: URL

  try {
    parsed = new URL(raw)
  } catch (error) {
    throw new Error('Invalid MCP OAuth redirect URI')
  }

  if (parsed.protocol !== 'http:') {
    throw new Error('MCP OAuth loopback redirect URI must use http')
  }

  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error('MCP OAuth loopback redirect URI must not include userinfo or fragments')
  }

  if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) {
    throw new Error('MCP OAuth loopback redirect URI must use localhost or 127.0.0.1')
  }

  if (!parsed.port) {
    throw new Error('MCP OAuth loopback redirect URI must include a port')
  }

  if (!parsed.pathname || parsed.pathname === '/') {
    throw new Error('MCP OAuth loopback redirect URI must include a callback path')
  }

  return {
    host: parsed.hostname === '[::1]' ? '::1' : parsed.hostname,
    path: parsed.pathname,
    port: Number(parsed.port),
    redirectUri: raw
  }
}

const pending = new Map<string, PendingListener>()
let nextId = 1

function settle(id: string, result: CallbackResult) {
  const entry = pending.get(id)

  if (!entry || entry.settled) {
    return
  }

  entry.settled = true
  entry.result = result

  try {
    entry.server.close()
  } catch {
    // already closed
  }

  for (const waiter of entry.waiters.splice(0)) {
    waiter(result)
  }
}

function dispose(id: string) {
  const entry = pending.get(id)

  if (!entry) {
    return
  }

  if (!entry.settled) {
    settle(id, { code: null, error: 'cancelled', state: null })
  }

  if (entry.lifetimeTimer) {
    clearTimeout(entry.lifetimeTimer)
    entry.lifetimeTimer = null
  }

  pending.delete(id)
}

export function registerMcpOauthCallbackIpc({ appName = 'Lemon AI' }: { appName?: string } = {}) {
  const doneHtml = mcpOauthDoneHtml(appName)

  // Bind a one-shot loopback listener; resolves { id, redirectUri }.
  ipcMain.handle('lemon:mcp-oauth:listen', async (_event, options?: ListenOptions) => {
    if (pending.size >= MAX_PENDING_LISTENERS) {
      throw new Error('Too many MCP OAuth listeners are already pending')
    }

    const id = String(nextId++)
    const parsedOptions = parseListenOptions(options)

    const expectedState =
      typeof options?.expectedState === 'string' && options.expectedState ? options.expectedState : null

    const server = http.createServer((req, res) => {
      const url = req.url || '/'
      const baseHost = parsedOptions.host.includes(':') ? `[${parsedOptions.host}]` : parsedOptions.host
      let parsed: URL

      try {
        parsed = new URL(url, `http://${baseHost}`)
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Invalid OAuth callback URL')

        return
      }

      if (parsed.pathname !== parsedOptions.path) {
        res.writeHead(parsedOptions.redirectUri ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(parsedOptions.redirectUri ? '<h1>OAuth callback not found</h1>' : doneHtml)

        return
      }

      // Ignore right-path noise — wait for the ?code= / ?error= hit.
      if (!parsed.searchParams.has('code') && !parsed.searchParams.has('error')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(doneHtml)

        return
      }

      const code = parsed.searchParams.get('code')
      const state = parsed.searchParams.get('state')
      const error = parsed.searchParams.get('error')

      if (expectedState && state !== expectedState) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<h1>OAuth callback rejected</h1><p>State mismatch.</p>')

        return
      }

      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(doneHtml)
      settle(id, { code, error, state })
    })

    const lifetime = Math.min(Math.max(Number(options?.timeoutMs) || DEFAULT_WAIT_TIMEOUT_MS, 1000), 15 * 60 * 1000)
    const lifetimeTimer = setTimeout(() => dispose(id), lifetime)

    pending.set(id, { lifetimeTimer, result: null, server, settled: false, waiters: [] })

    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(parsedOptions.port, parsedOptions.host, () => resolve())
      })
    } catch (error) {
      if (lifetimeTimer) {
        clearTimeout(lifetimeTimer)
      }

      pending.delete(id)

      try {
        server.close()
      } catch {
        // already closed
      }

      throw error
    }

    const port = (server.address() as AddressInfo).port
    const redirectUri = parsedOptions.redirectUri || `http://127.0.0.1:${port}/callback`

    return { id, redirectUri }
  })

  // Resolve when the redirect arrives (or timeout). Safe to call once per id.
  ipcMain.handle('lemon:mcp-oauth:wait', async (_event, id, timeoutMs) => {
    const entry = pending.get(String(id || ''))

    if (!entry) {
      return { code: null, error: 'listener not found', state: null }
    }

    if (entry.result) {
      const result = entry.result

      dispose(String(id))

      return result
    }

    const timeout = Math.min(Math.max(Number(timeoutMs) || DEFAULT_WAIT_TIMEOUT_MS, 1000), 15 * 60 * 1000)

    const result = await new Promise<CallbackResult>(resolve => {
      const timer = setTimeout(() => {
        settle(String(id), { code: null, error: 'timeout waiting for OAuth callback', state: null })
      }, timeout)

      entry.waiters.push(value => {
        clearTimeout(timer)
        resolve(value)
      })
    })

    dispose(String(id))

    return result
  })

  // Tear a listener down without waiting (user cancelled, flow errored).
  ipcMain.handle('lemon:mcp-oauth:cancel', (_event, id) => {
    dispose(String(id || ''))

    return true
  })
}
