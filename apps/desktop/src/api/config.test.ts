import { beforeEach, describe, expect, it, vi } from 'vitest'

const lemonApi = vi.fn()
const capabilityScoped = vi.fn()
const profileScoped = vi.fn()

vi.mock('./client', () => ({
  STARTUP_REQUEST_TIMEOUT_MS: 60_000,
  capabilityScoped,
  lemonApi,
  profileScoped
}))

describe('custom endpoint API scope', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    lemonApi.mockResolvedValue({})
    capabilityScoped.mockImplementation(scope => {
      if (scope && typeof scope === 'object') {
        return { connectionId: scope.connectionId, profile: scope.profile }
      }

      return scope ? { profile: scope } : {}
    })
    profileScoped.mockImplementation(scope => (scope ? { profile: scope } : {}))
  })

  it('routes list, save, validate, activate, and delete through capability scope', async () => {
    const api = await import('./config')
    const scope = { connectionId: 'local', profile: 'sales' }

    const payload = {
      base_url: 'http://127.0.0.1:5173/v1',
      id: 'lemon-ai-company',
      model: 'openai-codex-gpt-5-5',
      name: 'AI cong ty'
    }

    await api.getCustomEndpoints(scope)
    await api.saveCustomEndpoint(payload, scope)
    await api.validateCustomEndpoint(payload, scope)
    await api.activateCustomEndpoint('lemon-ai-company', scope)
    await api.deleteCustomEndpoint('lemon-ai-company', scope)

    expect(lemonApi).toHaveBeenNthCalledWith(1, {
      connectionId: 'local',
      profile: 'sales',
      path: '/api/providers/custom-endpoints'
    })
    expect(lemonApi).toHaveBeenNthCalledWith(2, {
      connectionId: 'local',
      profile: 'sales',
      path: '/api/providers/custom-endpoints',
      method: 'POST',
      body: payload
    })
    expect(lemonApi).toHaveBeenNthCalledWith(3, {
      connectionId: 'local',
      profile: 'sales',
      path: '/api/providers/custom-endpoints/validate',
      method: 'POST',
      body: payload
    })
    expect(lemonApi).toHaveBeenNthCalledWith(4, {
      connectionId: 'local',
      profile: 'sales',
      path: '/api/providers/custom-endpoints/lemon-ai-company/activate',
      method: 'POST'
    })
    expect(lemonApi).toHaveBeenNthCalledWith(5, {
      connectionId: 'local',
      profile: 'sales',
      path: '/api/providers/custom-endpoints/lemon-ai-company',
      method: 'DELETE'
    })
  })
})
