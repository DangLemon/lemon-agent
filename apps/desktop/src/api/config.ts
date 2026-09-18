import type {
  ConfigSchemaResponse,
  CustomEndpointsResponse,
  CustomEndpointUpdate,
  CustomEndpointValidationResponse,
  EnvVarInfo,
  LemonConfig,
  LemonConfigRecord,
  LemonRawConfigResponse,
  LogsResponse,
  OAuthPollResponse,
  OAuthProvidersResponse,
  OAuthStartResponse,
  OAuthSubmitResponse,
  StatusResponse
} from '@/types/lemon'

import { capabilityScoped, lemonApi, type ProfileScope, profileScoped, STARTUP_REQUEST_TIMEOUT_MS } from './client'

export function getStatus(): Promise<StatusResponse> {
  return lemonApi<StatusResponse>({
    ...profileScoped(),
    path: '/api/status'
  })
}

export function getLogs(params: {
  component?: string
  file?: string
  level?: string
  lines?: number
  search?: string
}): Promise<LogsResponse> {
  const query = new URLSearchParams()

  if (params.file) {
    query.set('file', params.file)
  }

  if (typeof params.lines === 'number') {
    query.set('lines', String(params.lines))
  }

  if (params.level && params.level !== 'ALL') {
    query.set('level', params.level)
  }

  if (params.component && params.component !== 'all') {
    query.set('component', params.component)
  }

  if (params.search) {
    query.set('search', params.search)
  }

  const suffix = query.toString()

  return lemonApi<LogsResponse>({
    ...profileScoped(),
    path: suffix ? `/api/logs?${suffix}` : '/api/logs'
  })
}

export function getLemonConfig(profile?: string): Promise<LemonConfig> {
  return lemonApi<LemonConfig>({
    ...profileScoped(profile),
    path: '/api/config',
    timeoutMs: STARTUP_REQUEST_TIMEOUT_MS
  })
}

export function getLemonConfigRecord(profile?: ProfileScope): Promise<LemonConfigRecord> {
  return window.lemonDesktop.api<LemonConfigRecord>({
    ...capabilityScoped(profile),
    path: '/api/config'
  })
}

export function getLemonRawConfig(profile?: ProfileScope): Promise<LemonRawConfigResponse> {
  return window.lemonDesktop.api<LemonRawConfigResponse>({
    ...capabilityScoped(profile),
    path: '/api/config/raw'
  })
}

export function getLemonConfigDefaults(): Promise<LemonConfigRecord> {
  return lemonApi<LemonConfigRecord>({
    ...profileScoped(),
    path: '/api/config/defaults',
    timeoutMs: STARTUP_REQUEST_TIMEOUT_MS
  })
}

export function getLemonConfigSchema(profile?: null | string): Promise<ConfigSchemaResponse> {
  return lemonApi<ConfigSchemaResponse>({
    ...profileScoped(profile),
    path: '/api/config/schema'
  })
}

export function saveLemonConfig(config: LemonConfigRecord, profile?: null | string): Promise<{ ok: boolean }> {
  return lemonApi<{ ok: boolean }>({
    ...profileScoped(profile),
    path: '/api/config',
    method: 'PUT',
    body: { config }
  })
}

/** Capability-scoped counterpart of saveLemonConfig — writes the config of
 *  the profile/connection the Capabilities scope selector points at (possibly
 *  on another registered gateway), mirroring getLemonConfigRecord. */
export function saveLemonConfigRecord(config: LemonConfigRecord, profile?: ProfileScope): Promise<{ ok: boolean }> {
  return window.lemonDesktop.api<{ ok: boolean }>({
    ...capabilityScoped(profile),
    path: '/api/config',
    method: 'PUT',
    body: { config }
  })
}

export function getEnvVars(profile?: null | string): Promise<Record<string, EnvVarInfo>> {
  return lemonApi<Record<string, EnvVarInfo>>({
    ...profileScoped(profile),
    path: '/api/env'
  })
}

export function setEnvVar(key: string, value: string, profile?: ProfileScope): Promise<{ ok: boolean }> {
  return window.lemonDesktop.api<{ ok: boolean }>({
    ...capabilityScoped(profile),
    path: '/api/env',
    method: 'PUT',
    body: { key, value }
  })
}

export function deleteEnvVar(key: string, profile?: ProfileScope): Promise<{ ok: boolean }> {
  return window.lemonDesktop.api<{ ok: boolean }>({
    ...capabilityScoped(profile),
    path: '/api/env',
    method: 'DELETE',
    body: { key }
  })
}

export function revealEnvVar(key: string, profile?: ProfileScope): Promise<{ key: string; value: string }> {
  return window.lemonDesktop.api<{ key: string; value: string }>({
    ...capabilityScoped(profile),
    path: '/api/env/reveal',
    method: 'POST',
    body: { key }
  })
}

export function validateProviderCredential(
  key: string,
  value: string,
  apiKey?: string
): Promise<{ ok: boolean; reachable: boolean; message: string; models?: string[] }> {
  return lemonApi<{ ok: boolean; reachable: boolean; message: string; models?: string[] }>({
    ...profileScoped(),
    path: '/api/providers/validate',
    method: 'POST',
    body: { key, value, api_key: apiKey ?? '' }
  })
}

export function getCustomEndpoints(scope?: ProfileScope): Promise<CustomEndpointsResponse> {
  return lemonApi<CustomEndpointsResponse>({
    ...capabilityScoped(scope),
    path: '/api/providers/custom-endpoints'
  })
}

export function saveCustomEndpoint(endpoint: CustomEndpointUpdate, scope?: ProfileScope): Promise<CustomEndpointsResponse> {
  return lemonApi<CustomEndpointsResponse>({
    ...capabilityScoped(scope),
    path: '/api/providers/custom-endpoints',
    method: 'POST',
    body: endpoint
  })
}

export function validateCustomEndpoint(endpoint: CustomEndpointUpdate, scope?: ProfileScope): Promise<CustomEndpointValidationResponse> {
  return lemonApi<CustomEndpointValidationResponse>({
    ...capabilityScoped(scope),
    path: '/api/providers/custom-endpoints/validate',
    method: 'POST',
    body: endpoint
  })
}

export function activateCustomEndpoint(id: string, scope?: ProfileScope): Promise<{ ok: boolean; provider: string; model: string }> {
  return lemonApi<{ ok: boolean; provider: string; model: string }>({
    ...capabilityScoped(scope),
    path: `/api/providers/custom-endpoints/${encodeURIComponent(id)}/activate`,
    method: 'POST'
  })
}

export function deleteCustomEndpoint(id: string, scope?: ProfileScope): Promise<CustomEndpointsResponse> {
  return lemonApi<CustomEndpointsResponse>({
    ...capabilityScoped(scope),
    path: `/api/providers/custom-endpoints/${encodeURIComponent(id)}`,
    method: 'DELETE'
  })
}

export function listOAuthProviders(): Promise<OAuthProvidersResponse> {
  return lemonApi<OAuthProvidersResponse>({
    ...profileScoped(),
    path: '/api/providers/oauth'
  })
}

export function disconnectOAuthProvider(providerId: string): Promise<{ ok: boolean; provider: string }> {
  return lemonApi<{ ok: boolean; provider: string }>({
    ...profileScoped(),
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}`,
    method: 'DELETE'
  })
}

export function startOAuthLogin(providerId: string, profile?: ProfileScope): Promise<OAuthStartResponse> {
  return window.lemonDesktop.api<OAuthStartResponse>({
    ...capabilityScoped(profile),
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}/start`,
    method: 'POST',
    body: {}
  })
}

export function submitOAuthCode(providerId: string, sessionId: string, code: string): Promise<OAuthSubmitResponse> {
  return lemonApi<OAuthSubmitResponse>({
    ...profileScoped(),
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}/submit`,
    method: 'POST',
    body: { session_id: sessionId, code }
  })
}

export function pollOAuthSession(
  providerId: string,
  sessionId: string,
  profile?: ProfileScope
): Promise<OAuthPollResponse> {
  return window.lemonDesktop.api<OAuthPollResponse>({
    ...capabilityScoped(profile),
    path: `/api/providers/oauth/${encodeURIComponent(providerId)}/poll/${encodeURIComponent(sessionId)}`
  })
}

export function cancelOAuthSession(sessionId: string): Promise<{ ok: boolean }> {
  return lemonApi<{ ok: boolean }>({
    ...profileScoped(),
    path: `/api/providers/oauth/sessions/${encodeURIComponent(sessionId)}`,
    method: 'DELETE'
  })
}
