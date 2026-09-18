import type { McpCatalogResponse, McpServerSummary } from '@/types/lemon'

import { capabilityScoped, captureCapabilityScope, lemonApi, type ProfileScope, profileScoped } from './client'

export interface McpTestResult {
  ok: boolean
  error?: string
  /** `schema_chars` (converted registry-schema size, chars) is additive —
   *  older backends omit it and the cost overlay shows no token estimate. */
  tools: { name: string; description: string; schema_chars?: number }[]
  /** Capability counts (absent on older backends / failed probes). */
  prompts?: number
  resources?: number
}

export interface McpOAuthFlow {
  flow_id: string
  server_name: string
  status: 'starting' | 'authorization_required' | 'approved' | 'error'
  authorization_url: string | null
  error: string | null
  tools?: { name: string; description: string }[]
  callback_transport?: 'backend' | 'desktop_loopback'
  callback_redirect_uri?: null | string
  callback_expected_state?: null | string
}

/** Connect to the server, list its tools, disconnect. Slow (spawns/handshakes
 *  for real) — well past the 15s default fetch timeout. */
export function testMcpServer(name: string, profile?: ProfileScope): Promise<McpTestResult> {
  return window.lemonDesktop.api<McpTestResult>({
    ...capabilityScoped(profile),
    path: `/api/mcp/servers/${encodeURIComponent(name)}/test`,
    method: 'POST',
    timeoutMs: 60_000
  })
}

/** Replace the whole `mcp_servers` map (the mcp.json editor's save). Unlike
 *  `saveLemonConfig`, this REPLACES rather than deep-merges, so deletes,
 *  re-enables (dropping `enabled: false`), and removed nested fields persist. */
export function saveMcpServers(
  servers: Record<string, Record<string, unknown>>,
  profile?: ProfileScope
): Promise<{ ok: boolean }> {
  return window.lemonDesktop.api<{ ok: boolean }>({
    ...capabilityScoped(profile),
    path: '/api/mcp/servers',
    method: 'PUT',
    body: { servers }
  })
}

/** Start an MCP OAuth flow and return the authorization URL. */
export function authMcpServer(name: string, profile?: ProfileScope): Promise<McpOAuthFlow> {
  return window.lemonDesktop.api<McpOAuthFlow>({
    ...capabilityScoped(profile),
    path: `/api/mcp/servers/${encodeURIComponent(name)}/auth`,
    method: 'POST',
    body: { supports_desktop_loopback: true },
    timeoutMs: 60_000
  })
}

export function getMcpOAuthFlow(flowId: string, profile?: ProfileScope): Promise<McpOAuthFlow> {
  return window.lemonDesktop.api<McpOAuthFlow>({
    ...capabilityScoped(profile),
    path: `/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`
  })
}

/** Cancel an in-flight MCP OAuth flow server-side, freeing the per-server
 *  "already in progress" slot so a retry doesn't 409. */
export function relayMcpOAuthCallback(
  flowId: string,
  body: { code?: null | string; error?: null | string; state?: null | string },
  profile?: ProfileScope
): Promise<{ ok: boolean; flow_id: string }> {
  return window.lemonDesktop.api<{ ok: boolean; flow_id: string }>({
    ...capabilityScoped(profile),
    path: `/api/mcp/oauth/flows/${encodeURIComponent(flowId)}/callback`,
    method: 'POST',
    body
  })
}

export function cancelMcpOAuthFlow(flowId: string, profile?: ProfileScope): Promise<{ ok: boolean; status: string }> {
  return window.lemonDesktop.api<{ ok: boolean; status: string }>({
    ...capabilityScoped(profile),
    path: `/api/mcp/oauth/flows/${encodeURIComponent(flowId)}`,
    method: 'DELETE'
  })
}

// ---------------------------------------------------------------------------
// MCP servers — structured list / test / enable toggle / catalog (parity with
// `lemon mcp` and the dashboard MCP page). Raw JSON editing stays in
// config.yaml via saveLemonConfig.
// ---------------------------------------------------------------------------

export function listMcpServers(): Promise<{ servers: McpServerSummary[] }> {
  return lemonApi<{ servers: McpServerSummary[] }>({
    ...profileScoped(),
    path: '/api/mcp/servers'
  })
}

/** Add one server to `mcp_servers` (validated + name-collision-checked
 *  server-side — the same endpoint the dashboard's add form uses). */
export function addMcpServer(body: {
  name: string
  url?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
  auth?: string
}): Promise<McpServerSummary> {
  return lemonApi<McpServerSummary>({
    ...profileScoped(),
    path: '/api/mcp/servers',
    method: 'POST',
    body
  })
}

/** Remove one server from `mcp_servers` (the inline setup card's rollback
 *  when a directory install is cancelled after the config write). */
export function removeMcpServer(name: string): Promise<{ ok: boolean }> {
  return lemonApi<{ ok: boolean }>({
    ...profileScoped(),
    path: `/api/mcp/servers/${encodeURIComponent(name)}`,
    method: 'DELETE'
  })
}

export function setMcpServerEnabled(name: string, enabled: boolean): Promise<{ ok: boolean }> {
  return lemonApi<{ ok: boolean }>({
    ...profileScoped(),
    path: `/api/mcp/servers/${encodeURIComponent(name)}/enabled`,
    method: 'PUT',
    body: { enabled }
  })
}

export function getMcpCatalog(profile?: ProfileScope): Promise<McpCatalogResponse> {
  return window.lemonDesktop.api<McpCatalogResponse>({
    ...capabilityScoped(profile),
    path: '/api/mcp/catalog'
  })
}

export function installMcpCatalogEntry(
  name: string,
  env: Record<string, string> = {},
  profile?: ProfileScope
): Promise<{ ok: boolean; name?: string; pid?: number; action?: string; background?: boolean }> {
  return window.lemonDesktop.api<{ ok: boolean; name?: string; pid?: number; action?: string; background?: boolean }>({
    ...capabilityScoped(profile),
    path: '/api/mcp/catalog/install',
    method: 'POST',
    body: { name, env, enable: true },
    timeoutMs: 60_000
  })
}

export function createMcpOAuthClient(
  scope?: ProfileScope,
  isCurrent: () => boolean = () => true
): {
  cancel: (flowId: string) => Promise<{ ok: boolean; status: string }>
  relayCallback: (
    flowId: string,
    callback: { code?: null | string; error?: null | string; state?: null | string }
  ) => Promise<{ ok: boolean; flow_id: string }>
  start: (name: string) => Promise<McpOAuthFlow>
  status: (flowId: string) => Promise<McpOAuthFlow>
} {
  const capturedScope = captureCapabilityScope(scope)

  const assertCurrent = () => {
    if (!isCurrent()) {
      throw new Error('MCP OAuth scope changed before the flow completed')
    }
  }

  return {
    start: name => {
      assertCurrent()

      return authMcpServer(name, capturedScope)
    },
    status: flowId => {
      assertCurrent()

      return getMcpOAuthFlow(flowId, capturedScope)
    },
    cancel: async flowId => {
      // An id-less legacy route cannot address its old backend after a switch.
      // Let that flow expire instead of sending its ID to the new backend.
      if (!capturedScope.connectionId) {
        assertCurrent()
      }

      return cancelMcpOAuthFlow(flowId, capturedScope)
    },
    relayCallback: (flowId, callback) => {
      assertCurrent()

      return relayMcpOAuthCallback(flowId, callback, capturedScope)
    }
  }
}
