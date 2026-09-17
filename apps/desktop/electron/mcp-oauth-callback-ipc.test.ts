/**
 * Tests for electron/mcp-oauth-callback-ipc.ts — the client-side one-shot
 * loopback listener MCP OAuth uses against remote backends. Uses a REAL
 * ephemeral http listener (it binds 127.0.0.1:0, no fixed ports) with the
 * electron ipcMain mocked, and drives synthetic browser hits with fetch.
 *
 * Run with: vitest run --project electron mcp-oauth-callback-ipc
 */

import assert from 'node:assert/strict'
import http from 'node:http'

import { test, vi } from 'vitest'

const handlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  }
}))

const { mcpOauthDoneHtml, registerMcpOauthCallbackIpc } = await import('./mcp-oauth-callback-ipc')

registerMcpOauthCallbackIpc()

test('callback page can use the internal desktop product name', () => {
  const html = mcpOauthDoneHtml('Lemon AI')

  assert.match(html, /return to Lemon AI/)
  assert.doesNotMatch(html, /return to Lemon AI/)
})

async function freePort(host = '127.0.0.1'): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = http.createServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

const invoke = (channel: string, ...args: unknown[]) => {
  const fn = handlers.get(channel)

  assert.ok(fn, `handler registered for ${channel}`)

  return fn!({}, ...args)
}

test('listen binds a loopback listener and wait resolves with the redirect params', async () => {
  const { id, redirectUri } = (await invoke('lemon:mcp-oauth:listen')) as { id: string; redirectUri: string }

  assert.match(redirectUri, /^http:\/\/127\.0\.0\.1:\d+\/callback$/)

  const waitPromise = invoke('lemon:mcp-oauth:wait', id, 5000) as Promise<{
    code: null | string
    error: null | string
    state: null | string
  }>

  const res = await fetch(`${redirectUri}?code=abc123&state=st-1`)

  assert.equal(res.status, 200)
  assert.match(await res.text(), /return to Lemon AI/)

  const result = await waitPromise

  assert.equal(result.code, 'abc123')
  assert.equal(result.state, 'st-1')
  assert.equal(result.error, null)

  // Listener is one-shot: the port must be closed after the callback.
  await assert.rejects(fetch(`${redirectUri}?code=again&state=st-1`))
})

test('non-callback noise (favicon) does not settle the listener', async () => {
  const { id, redirectUri } = (await invoke('lemon:mcp-oauth:listen')) as { id: string; redirectUri: string }
  const origin = redirectUri.replace(/\/callback$/, '')

  const res = await fetch(`${origin}/favicon.ico`)

  assert.equal(res.status, 200)

  const waitPromise = invoke('lemon:mcp-oauth:wait', id, 5000) as Promise<{ code: null | string }>

  await fetch(`${redirectUri}?code=late-code&state=s`)

  const result = await waitPromise

  assert.equal(result.code, 'late-code')
})

test('provider error param is forwarded', async () => {
  const { id, redirectUri } = (await invoke('lemon:mcp-oauth:listen')) as { id: string; redirectUri: string }

  const waitPromise = invoke('lemon:mcp-oauth:wait', id, 5000) as Promise<{
    code: null | string
    error: null | string
  }>

  await fetch(`${redirectUri}?error=access_denied&state=s`)

  const result = await waitPromise

  assert.equal(result.code, null)
  assert.equal(result.error, 'access_denied')
})

test('cancel tears the listener down and wait reports listener not found afterwards', async () => {
  const { id, redirectUri } = (await invoke('lemon:mcp-oauth:listen')) as { id: string; redirectUri: string }

  assert.equal(await invoke('lemon:mcp-oauth:cancel', id), true)

  await assert.rejects(fetch(`${redirectUri}?code=x&state=s`))

  const result = (await invoke('lemon:mcp-oauth:wait', id, 100)) as { error: null | string }

  assert.equal(result.error, 'listener not found')
})

test('wait times out when no callback arrives', async () => {
  const { id } = (await invoke('lemon:mcp-oauth:listen')) as { id: string }

  const result = (await invoke('lemon:mcp-oauth:wait', id, 1000)) as { code: null | string; error: null | string }

  assert.equal(result.code, null)
  assert.match(String(result.error), /timeout/)
})

test('listen can bind an exact loopback redirect URI and ignores wrong path/state', async () => {
  const port = await freePort()
  const expectedRedirectUri = `http://localhost:${port}/auth/callback`

  const { id, redirectUri } = (await invoke('lemon:mcp-oauth:listen', {
    redirectUri: expectedRedirectUri,
    expectedState: 'expected-state'
  })) as { id: string; redirectUri: string }

  assert.equal(redirectUri, expectedRedirectUri)

  const wrongPath = await fetch(`http://localhost:${port}/callback?code=nope&state=expected-state`)
  assert.equal(wrongPath.status, 404)

  const wrongState = await fetch(`${redirectUri}?code=nope&state=wrong-state`)
  assert.equal(wrongState.status, 400)

  const waitPromise = invoke('lemon:mcp-oauth:wait', id, 5000) as Promise<{
    code: null | string
    error: null | string
    state: null | string
  }>

  const ok = await fetch(`${redirectUri}?code=abc123&state=expected-state`)
  assert.equal(ok.status, 200)

  const result = await waitPromise
  assert.equal(result.code, 'abc123')
  assert.equal(result.state, 'expected-state')
  assert.equal(result.error, null)

  await assert.rejects(fetch(`${redirectUri}?code=again&state=expected-state`))
})

test('concurrent listener starts cannot exceed the pending listener cap', async () => {
  const listeners = await Promise.allSettled(
    Array.from({ length: 9 }, () => invoke('lemon:mcp-oauth:listen') as Promise<{ id: string; redirectUri: string }>)
  )

  const fulfilled = listeners.filter(
    (result): result is PromiseFulfilledResult<{ id: string; redirectUri: string }> => {
      return result.status === 'fulfilled'
    }
  )

  const rejected = listeners.filter(result => result.status === 'rejected')

  assert.equal(fulfilled.length, 8)
  assert.equal(rejected.length, 1)
  assert.match(String(rejected[0]!.reason), /Too many MCP OAuth listeners/)

  await Promise.all(fulfilled.map(result => invoke('lemon:mcp-oauth:cancel', result.value.id)))
})

test('listen can bind an exact IPv6 loopback redirect URI when the host supports it', async () => {
  let port: number

  try {
    port = await freePort('::1')
  } catch {
    return
  }

  const expectedRedirectUri = `http://[::1]:${port}/auth/callback`

  const { id, redirectUri } = (await invoke('lemon:mcp-oauth:listen', {
    redirectUri: expectedRedirectUri,
    expectedState: 'ipv6-state'
  })) as { id: string; redirectUri: string }

  assert.equal(redirectUri, expectedRedirectUri)

  const waitPromise = invoke('lemon:mcp-oauth:wait', id, 5000) as Promise<{
    code: null | string
    error: null | string
    state: null | string
  }>

  const ok = await fetch(`${redirectUri}?code=ipv6-code&state=ipv6-state`)
  assert.equal(ok.status, 200)

  const result = await waitPromise
  assert.equal(result.code, 'ipv6-code')
  assert.equal(result.state, 'ipv6-state')
})

test('listener lifetime timeout frees the port and pending slot when wait is never called', async () => {
  const port = await freePort()
  const redirectUri = `http://127.0.0.1:${port}/auth/callback`

  const first = (await invoke('lemon:mcp-oauth:listen', { redirectUri, timeoutMs: 1000 })) as {
    id: string
    redirectUri: string
  }

  assert.equal(first.redirectUri, redirectUri)

  await new Promise(resolve => setTimeout(resolve, 1200))
  await assert.rejects(fetch(`${redirectUri}?code=late&state=s`))

  const second = (await invoke('lemon:mcp-oauth:listen', { redirectUri, timeoutMs: 1000 })) as {
    id: string
    redirectUri: string
  }

  assert.equal(second.redirectUri, redirectUri)
  await invoke('lemon:mcp-oauth:cancel', second.id)
})
