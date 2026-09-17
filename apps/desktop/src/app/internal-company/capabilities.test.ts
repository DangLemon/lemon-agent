import { describe, expect, it } from 'vitest'

import {
  filterInternalCompanyRoutes,
  harnessEnvFromBuildConstants,
  harnessProvisioningFromRuntimeReadiness,
  harnessUiFlagsFromEnv,
  initialInternalCompanyCapabilities,
  internalCompanyExpectedFromEnv,
  internalCompanyRouteAllowed,
  updateInternalCompanyProvisioning
} from './capabilities'

describe('internal company static harness capabilities', () => {
  it('keeps ordinary builds upstream with unrestricted routes and terminal', () => {
    const state = initialInternalCompanyCapabilities(false)

    expect(state.mode).toBe('upstream')
    expect(state.expected).toBe(false)
    expect(state.terminalAllowed).toBe(true)
    expect(internalCompanyRouteAllowed('/settings?tab=providers', state)).toBe(true)
    expect(internalCompanyRouteAllowed('/profiles', state)).toBe(true)
  })

  it('starts expected harness builds synchronously with base routes plus terminal and cron defaults', () => {
    const state = initialInternalCompanyCapabilities(true)

    expect(state.mode).toBe('harness')
    expect(state.expected).toBe(true)
    expect(state.provisioning.state).toBe('unknown')
    expect(state.terminalAllowed).toBe(true)

    for (const route of ['/', '/artifacts', '/settings', '/skills', '/cron']) {
      expect(internalCompanyRouteAllowed(route, state)).toBe(true)
    }

    for (const route of ['/agents', '/messaging', '/profiles', '/webhooks', '/command-center', '/starmap']) {
      expect(internalCompanyRouteAllowed(route, state)).toBe(false)
    }
  })

  it('lets static env flags opt into advanced harness surfaces and terminal visibility', () => {
    const ui = harnessUiFlagsFromEnv({
      VITE_LEMON_HARNESS_SHOW_AGENTS: '1',
      VITE_LEMON_HARNESS_SHOW_CRON: 'false',
      VITE_LEMON_HARNESS_SHOW_MESSAGING: 'true',
      VITE_LEMON_HARNESS_SHOW_TERMINAL: '0',
      VITE_LEMON_HARNESS_SHOW_WEBHOOKS: 'yes'
    })

    const state = initialInternalCompanyCapabilities(true, ui)

    expect(state.terminalAllowed).toBe(false)
    expect(internalCompanyRouteAllowed('/agents', state)).toBe(true)
    expect(internalCompanyRouteAllowed('/messaging', state)).toBe(true)
    expect(internalCompanyRouteAllowed('/webhooks', state)).toBe(true)
    expect(internalCompanyRouteAllowed('/cron', state)).toBe(false)
  })

  it('folds runtime readiness into honest nonblocking provisioning state', () => {
    const state = initialInternalCompanyCapabilities(true)

    expect(harnessProvisioningFromRuntimeReadiness(null)).toEqual({ missing: [], state: 'unknown' })
    expect(harnessProvisioningFromRuntimeReadiness({ ready: true, reason: null })).toEqual({
      missing: [],
      state: 'complete'
    })

    const incomplete = harnessProvisioningFromRuntimeReadiness({ ready: false, reason: 'model missing' })
    const updated = updateInternalCompanyProvisioning(state, incomplete)

    expect(updated.provisioning).toEqual({ detail: 'model missing', missing: ['inference'], state: 'incomplete' })
    expect(internalCompanyRouteAllowed('/skills', updated)).toBe(true)
    expect(internalCompanyRouteAllowed('/cron', updated)).toBe(true)
  })

  it('continues to allow session routes while reserving hidden app routes', () => {
    const state = initialInternalCompanyCapabilities(true)

    for (const route of [
      '/stored-A',
      '/remembered-session',
      '/sess-a',
      '/550e8400-e29b-41d4-a716-446655440000',
      '/a%3Fb%23c'
    ]) {
      expect(internalCompanyRouteAllowed(route, state)).toBe(true)
    }

    expect(internalCompanyRouteAllowed('/profiles', state)).toBe(false)
  })

  it('filters route lists through the same static policy', () => {
    const state = initialInternalCompanyCapabilities(true)

    expect(filterInternalCompanyRoutes(['/', '/skills', '/artifacts', '/profiles', '/cron'], state)).toEqual([
      '/',
      '/skills',
      '/artifacts',
      '/cron'
    ])
  })

  it('recognizes only the internal harness selector', () => {
    expect(internalCompanyExpectedFromEnv({ VITE_LEMON_DESKTOP_HARNESS: 'internal' })).toBe(true)
    expect(internalCompanyExpectedFromEnv({ VITE_LEMON_DESKTOP_HARNESS: 'internal-company' })).toBe(false)
    expect(internalCompanyExpectedFromEnv({ VITE_LEMON_DESKTOP_HARNESS: '1' })).toBe(false)
    expect(internalCompanyExpectedFromEnv({ VITE_LEMON_INTERNAL_COMPANY_EXPECTED: '1' })).toBe(false)
    expect(internalCompanyExpectedFromEnv({ VITE_LEMON_DESKTOP_HARNESS: 'upstream' })).toBe(false)
  })

  it('maps configured Vite build constants into the same env contract used by runtime helpers', () => {
    const env = harnessEnvFromBuildConstants({
      harness: 'internal',
      showAgents: 'true',
      showCron: 'false',
      showMessaging: 'true',
      showTerminal: 'false',
      showWebhooks: 'true'
    })

    expect(internalCompanyExpectedFromEnv(env)).toBe(true)
    expect(harnessUiFlagsFromEnv(env)).toEqual({
      agents: true,
      cron: false,
      messaging: true,
      terminal: false,
      webhooks: true
    })
  })
})
