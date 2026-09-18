import { afterEach, describe, expect, it, vi } from 'vitest'

import { $activeGatewayProfile } from '@/store/profile'
import { $connection } from '@/store/session'

import { setApiRequestConnection, setApiRequestProfile } from '../api/client'
import { createMcpOAuthClient } from '../api/mcp'

import { completeMcpDesktopOAuth, McpOAuthCancelled } from './mcp-dashboard-oauth'
import { captureMcpOAuthScopeGuard } from './mcp-oauth-scope'

describe('completeMcpDesktopOAuth', () => {
  afterEach(() => {
    setApiRequestConnection(null)
    setApiRequestProfile(null)
    $activeGatewayProfile.set('default')
    $connection.set(null)
    vi.unstubAllGlobals()
  })

  it('opens the returned authorization URL and polls through approval', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)

    const status = vi
      .fn()
      .mockResolvedValueOnce({
        flow_id: 'flow-1',
        server_name: 'reports',
        status: 'authorization_required',
        authorization_url: 'https://idp.example/authorize',
        error: null
      })
      .mockResolvedValueOnce({
        flow_id: 'flow-1',
        server_name: 'reports',
        status: 'approved',
        authorization_url: 'https://idp.example/authorize',
        error: null,
        tools: [{ name: 'list_reports', description: 'List reports' }]
      })

    const result = await completeMcpDesktopOAuth({
      serverName: 'reports',
      start: vi.fn().mockResolvedValue({
        flow_id: 'flow-1',
        server_name: 'reports',
        status: 'authorization_required',
        authorization_url: 'https://idp.example/authorize',
        error: null
      }),
      status,
      openExternal,
      sleep: async () => {}
    })

    expect(openExternal).toHaveBeenCalledWith('https://idp.example/authorize')
    expect(result.status).toBe('approved')
  })

  it('retries a transient status failure', async () => {
    const status = vi.fn().mockRejectedValueOnce(new Error('temporary network failure')).mockResolvedValueOnce({
      flow_id: 'flow-2',
      server_name: 'reports',
      status: 'approved',
      authorization_url: 'https://idp.example/authorize',
      error: null,
      tools: []
    })

    const result = await completeMcpDesktopOAuth({
      serverName: 'reports',
      start: vi.fn().mockResolvedValue({
        flow_id: 'flow-2',
        server_name: 'reports',
        status: 'authorization_required',
        authorization_url: 'https://idp.example/authorize',
        error: null
      }),
      status,
      openExternal: vi.fn().mockResolvedValue(undefined),
      sleep: async () => {}
    })

    expect(result.status).toBe('approved')
    expect(status).toHaveBeenCalledTimes(2)
  })

  it('uses the desktop loopback listener and relays callback by pinned flow id', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const relayCallback = vi.fn().mockResolvedValue({ ok: true, flow_id: 'flow-loopback' })

    const status = vi.fn().mockResolvedValueOnce({
      flow_id: 'flow-loopback',
      server_name: 'amazon-ads',
      status: 'approved',
      authorization_url: 'https://idp.example/authorize?state=expected-state',
      error: null,
      tools: []
    })

    const listen = vi.fn().mockResolvedValue({ id: 'listener-1', redirectUri: 'http://localhost:8000/auth/callback' })
    const wait = vi.fn().mockResolvedValue({ code: 'code-1', state: 'expected-state', error: null })
    const cancelListener = vi.fn().mockResolvedValue(true)

    vi.stubGlobal('window', {
      setTimeout: (_callback: () => void) => 0,
      lemonDesktop: {
        mcpOauth: { listen, wait, cancel: cancelListener }
      }
    })

    const result = await completeMcpDesktopOAuth({
      serverName: 'amazon-ads',
      start: vi.fn().mockResolvedValue({
        flow_id: 'flow-loopback',
        server_name: 'amazon-ads',
        status: 'authorization_required',
        authorization_url: 'https://idp.example/authorize?state=expected-state',
        error: null,
        callback_transport: 'desktop_loopback',
        callback_redirect_uri: 'http://localhost:8000/auth/callback',
        callback_expected_state: 'expected-state'
      }),
      status,
      relayCallback,
      openExternal,
      sleep: async () => {}
    })

    expect(listen).toHaveBeenCalledWith({
      redirectUri: 'http://localhost:8000/auth/callback',
      expectedState: 'expected-state'
    })
    expect(openExternal).toHaveBeenCalledWith('https://idp.example/authorize?state=expected-state')
    expect(wait).toHaveBeenCalledWith('listener-1')
    expect(relayCallback).toHaveBeenCalledWith('flow-loopback', {
      code: 'code-1',
      state: 'expected-state',
      error: undefined
    })
    expect(result.status).toBe('approved')
  })

  it('fails custom desktop loopback with an actionable error outside Desktop', async () => {
    vi.stubGlobal('window', { setTimeout: (_callback: () => void) => 0 })

    await expect(
      completeMcpDesktopOAuth({
        serverName: 'amazon-ads',
        start: vi.fn().mockResolvedValue({
          flow_id: 'flow-browser',
          server_name: 'amazon-ads',
          status: 'authorization_required',
          authorization_url: 'https://idp.example/authorize?state=expected-state',
          error: null,
          callback_transport: 'desktop_loopback',
          callback_redirect_uri: 'http://localhost:8000/auth/callback',
          callback_expected_state: 'expected-state'
        }),
        status: vi.fn(),
        relayCallback: vi.fn(),
        openExternal: vi.fn(),
        sleep: async () => {}
      })
    ).rejects.toThrow(/Lemon AI app/)
  })

  it('brands custom desktop loopback missing-bridge errors for internal builds', async () => {
    vi.stubGlobal('__LEMON_DESKTOP_HARNESS__', 'internal')
    vi.stubGlobal('window', { setTimeout: (_callback: () => void) => 0 })

    await expect(
      completeMcpDesktopOAuth({
        serverName: 'amazon-ads',
        start: vi.fn().mockResolvedValue({
          flow_id: 'flow-browser',
          server_name: 'amazon-ads',
          status: 'authorization_required',
          authorization_url: 'https://idp.example/authorize?state=expected-state',
          error: null,
          callback_transport: 'desktop_loopback',
          callback_redirect_uri: 'http://localhost:8000/auth/callback',
          callback_expected_state: 'expected-state'
        }),
        status: vi.fn(),
        relayCallback: vi.fn(),
        openExternal: vi.fn(),
        sleep: async () => {}
      })
    ).rejects.toThrow(/Lemon AI app/)
  })

  it('cancels the backend flow when desktop listener setup fails', async () => {
    const cancel = vi.fn().mockResolvedValue({ ok: true })
    const listen = vi.fn().mockRejectedValue(new Error('port already in use'))

    vi.stubGlobal('window', {
      setTimeout: (_callback: () => void) => 0,
      lemonDesktop: {
        mcpOauth: { listen, wait: vi.fn(), cancel: vi.fn() }
      }
    })

    await expect(
      completeMcpDesktopOAuth({
        serverName: 'amazon-ads',
        start: vi.fn().mockResolvedValue({
          flow_id: 'flow-port-busy',
          server_name: 'amazon-ads',
          status: 'authorization_required',
          authorization_url: 'https://idp.example/authorize?state=expected-state',
          error: null,
          callback_transport: 'desktop_loopback',
          callback_redirect_uri: 'http://localhost:8000/auth/callback',
          callback_expected_state: 'expected-state'
        }),
        status: vi.fn(),
        relayCallback: vi.fn(),
        cancel,
        openExternal: vi.fn(),
        sleep: async () => {}
      })
    ).rejects.toThrow(/port already in use/)

    expect(cancel).toHaveBeenCalledWith('flow-port-busy')
  })

  it('keeps an explicit profile target current even when the ambient active profile differs', async () => {
    const requests: Array<{ body?: unknown; connectionId?: string; method?: string; path: string; profile?: string }> =
      []

    const openExternal = vi.fn().mockResolvedValue(undefined)

    setApiRequestConnection(null)
    setApiRequestProfile('default')
    $activeGatewayProfile.set('default')
    $connection.set({
      baseUrl: 'https://remote-a.example',
      mode: 'remote',
      profile: 'default',
      registryScoped: false
    } as never)
    const guard = captureMcpOAuthScopeGuard('work')
    const oauthClient = createMcpOAuthClient('work', guard)

    vi.stubGlobal('window', {
      setTimeout: (_callback: () => void) => 0,
      lemonDesktop: {
        api: vi.fn(async request => {
          requests.push(request)

          if (request.path === '/api/mcp/servers/amazon-ads/auth') {
            return {
              flow_id: 'flow-profile-target',
              server_name: 'amazon-ads',
              status: 'authorization_required',
              authorization_url: 'https://idp.example/authorize',
              error: null
            }
          }

          if (request.path === '/api/mcp/oauth/flows/flow-profile-target') {
            return {
              flow_id: 'flow-profile-target',
              server_name: 'amazon-ads',
              status: 'approved',
              authorization_url: 'https://idp.example/authorize',
              error: null,
              tools: []
            }
          }

          throw new Error(`unexpected request ${request.path}`)
        })
      }
    })

    const result = await completeMcpDesktopOAuth({
      serverName: 'amazon-ads',
      start: oauthClient.start,
      status: oauthClient.status,
      cancel: oauthClient.cancel,
      relayCallback: oauthClient.relayCallback,
      cancelled: () => !guard(),
      openExternal,
      sleep: async () => {}
    })

    expect(result.status).toBe('approved')
    expect(openExternal).toHaveBeenCalledWith('https://idp.example/authorize')
    expect(requests.map(request => request.profile)).toEqual(['work', 'work'])
  })

  it('keeps real MCP API wrappers pinned to the captured connection/profile after ambient switches', async () => {
    const requests: Array<{ body?: unknown; connectionId?: string; method?: string; path: string; profile?: string }> =
      []

    const capturedScope = { connectionId: 'remote-a', profile: 'work' }
    const listen = vi.fn().mockResolvedValue({ id: 'listener-1', redirectUri: 'http://localhost:8000/auth/callback' })
    const wait = vi.fn().mockResolvedValue({ code: 'code-1', state: 'expected-state', error: null })

    setApiRequestConnection('remote-a')
    setApiRequestProfile('work')
    $activeGatewayProfile.set('work')
    $connection.set({ connectionId: 'remote-a', mode: 'remote', profile: 'work', registryScoped: true } as never)
    const guard = captureMcpOAuthScopeGuard(capturedScope)
    const oauthClient = createMcpOAuthClient(capturedScope, guard)

    vi.stubGlobal('window', {
      setTimeout: (_callback: () => void) => 0,
      lemonDesktop: {
        mcpOauth: { listen, wait, cancel: vi.fn().mockResolvedValue(true) },
        api: vi.fn(async request => {
          requests.push(request)

          if (request.path === '/api/mcp/servers/amazon-ads/auth') {
            setApiRequestConnection('remote-b')
            setApiRequestProfile('other')
            $activeGatewayProfile.set('other')
            $connection.set({
              connectionId: 'remote-b',
              mode: 'remote',
              profile: 'other',
              registryScoped: true
            } as never)

            return {
              flow_id: 'flow-loopback',
              server_name: 'amazon-ads',
              status: 'authorization_required',
              authorization_url: 'https://idp.example/authorize?state=expected-state',
              error: null,
              callback_transport: 'desktop_loopback',
              callback_redirect_uri: 'http://localhost:8000/auth/callback',
              callback_expected_state: 'expected-state'
            }
          }

          if (request.path === '/api/mcp/oauth/flows/flow-loopback/callback') {
            setApiRequestConnection('remote-c')
            setApiRequestProfile('later')
            $activeGatewayProfile.set('later')
            $connection.set({
              connectionId: 'remote-c',
              mode: 'remote',
              profile: 'later',
              registryScoped: true
            } as never)

            return { ok: true, flow_id: 'flow-loopback' }
          }

          if (request.path === '/api/mcp/oauth/flows/flow-loopback') {
            return {
              flow_id: 'flow-loopback',
              server_name: 'amazon-ads',
              status: 'approved',
              authorization_url: 'https://idp.example/authorize?state=expected-state',
              error: null,
              tools: []
            }
          }

          throw new Error(`unexpected request ${request.path}`)
        })
      }
    })

    await completeMcpDesktopOAuth({
      serverName: 'amazon-ads',
      start: oauthClient.start,
      status: oauthClient.status,
      relayCallback: oauthClient.relayCallback,
      cancel: oauthClient.cancel,
      openExternal: vi.fn(async () => {
        setApiRequestConnection('remote-open')
        setApiRequestProfile('open')
        $activeGatewayProfile.set('open')
        $connection.set({ connectionId: 'remote-open', mode: 'remote', profile: 'open', registryScoped: true } as never)
      }),
      sleep: async () => {}
    })

    expect(requests.map(request => request.path)).toEqual([
      '/api/mcp/servers/amazon-ads/auth',
      '/api/mcp/oauth/flows/flow-loopback/callback',
      '/api/mcp/oauth/flows/flow-loopback'
    ])
    expect(requests.every(request => request.connectionId === 'remote-a')).toBe(true)
    expect(requests.every(request => request.profile === 'work')).toBe(true)
    expect(requests[0]!.body).toEqual({ supports_desktop_loopback: true })
  })

  it('fails closed without cancelling on a different backend after an id-less connection switch', async () => {
    const requests: Array<{ body?: unknown; connectionId?: string; method?: string; path: string; profile?: string }> =
      []

    const openExternal = vi.fn()
    const bridgeCancel = vi.fn().mockResolvedValue(true)

    setApiRequestConnection(null)
    setApiRequestProfile('work')
    $activeGatewayProfile.set('work')
    $connection.set({
      baseUrl: 'https://remote-a.example',
      mode: 'remote',
      profile: 'work',
      registryScoped: false
    } as never)
    const guard = captureMcpOAuthScopeGuard()
    const oauthClient = createMcpOAuthClient(undefined, guard)

    vi.stubGlobal('window', {
      setTimeout: (_callback: () => void) => 0,
      lemonDesktop: {
        mcpOauth: {
          listen: vi
            .fn()
            .mockResolvedValue({ id: 'listener-cancel', redirectUri: 'http://localhost:8000/auth/callback' }),
          wait: vi.fn(),
          cancel: bridgeCancel
        },
        api: vi.fn(async request => {
          requests.push(request)

          if (request.path === '/api/mcp/servers/amazon-ads/auth') {
            setApiRequestConnection('remote-b')
            setApiRequestProfile('other')
            $activeGatewayProfile.set('other')
            $connection.set({
              baseUrl: 'https://remote-b.example',
              mode: 'remote',
              profile: 'work',
              registryScoped: false
            } as never)

            return {
              flow_id: 'flow-cancel',
              server_name: 'amazon-ads',
              status: 'authorization_required',
              authorization_url: 'https://idp.example/authorize?state=expected-state',
              error: null,
              callback_transport: 'desktop_loopback',
              callback_redirect_uri: 'http://localhost:8000/auth/callback',
              callback_expected_state: 'expected-state'
            }
          }

          if (request.path === '/api/mcp/oauth/flows/flow-cancel' && request.method === 'DELETE') {
            return { ok: true, status: 'error' }
          }

          throw new Error(`unexpected request ${request.path}`)
        })
      }
    })

    await expect(
      completeMcpDesktopOAuth({
        serverName: 'amazon-ads',
        start: oauthClient.start,
        status: oauthClient.status,
        relayCallback: oauthClient.relayCallback,
        cancel: oauthClient.cancel,
        cancelled: () => !guard(),
        openExternal,
        sleep: async () => {}
      })
    ).rejects.toBeInstanceOf(McpOAuthCancelled)

    expect(openExternal).not.toHaveBeenCalled()
    expect(bridgeCancel).toHaveBeenCalledWith('listener-cancel')
    expect(requests).toEqual([
      expect.objectContaining({
        body: { supports_desktop_loopback: true },
        method: 'POST',
        path: '/api/mcp/servers/amazon-ads/auth',
        profile: 'work'
      })
    ])
    expect(requests.every(request => request.connectionId === undefined)).toBe(true)
  })

  it('cancels before relay when cancellation happens after callback capture', async () => {
    const cancel = vi.fn().mockResolvedValue({ ok: true })
    const relayCallback = vi.fn()
    let checks = 0

    vi.stubGlobal('window', {
      setTimeout: (_callback: () => void) => 0,
      lemonDesktop: {
        mcpOauth: {
          listen: vi
            .fn()
            .mockResolvedValue({ id: 'listener-after-callback', redirectUri: 'http://localhost:8000/auth/callback' }),
          wait: vi.fn().mockResolvedValue({ code: 'code-1', state: 'expected-state', error: null }),
          cancel: vi.fn().mockResolvedValue(true)
        }
      }
    })

    await expect(
      completeMcpDesktopOAuth({
        serverName: 'amazon-ads',
        start: vi.fn().mockResolvedValue({
          flow_id: 'flow-after-callback',
          server_name: 'amazon-ads',
          status: 'authorization_required',
          authorization_url: 'https://idp.example/authorize?state=expected-state',
          error: null,
          callback_transport: 'desktop_loopback',
          callback_redirect_uri: 'http://localhost:8000/auth/callback',
          callback_expected_state: 'expected-state'
        }),
        status: vi.fn(),
        relayCallback,
        cancel,
        cancelled: () => {
          checks += 1

          return checks >= 2
        },
        openExternal: vi.fn(),
        sleep: async () => {}
      })
    ).rejects.toBeInstanceOf(McpOAuthCancelled)

    expect(relayCallback).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledWith('flow-after-callback')
  })
})
