import { routePathname, routeSessionIdWithReserved } from '@/app/route-contract'

export type InternalCompanyUiMode = 'harness' | 'upstream'
export type HarnessProvisioningState = 'complete' | 'incomplete' | 'unknown'

export interface HarnessUiFlags {
  agents: boolean
  cron: boolean
  messaging: boolean
  terminal: boolean
  webhooks: boolean
}

export interface HarnessProvisioning {
  detail?: string
  missing: string[]
  state: HarnessProvisioningState
}

export interface InternalCompanyCapabilityState {
  allowedRoutes: ReadonlySet<string>
  expected: boolean
  mode: InternalCompanyUiMode
  provisioning: HarnessProvisioning
  reservedRoutes: ReadonlySet<string>
  terminalAllowed: boolean
  ui: HarnessUiFlags
}

export interface InternalCompanyRouteState {
  allowedRoutes?: ReadonlySet<string>
  mode: InternalCompanyUiMode
  reservedRoutes?: ReadonlySet<string>
}

export interface HarnessEnv {
  readonly [key: string]: unknown
}

export interface HarnessBuildConstants {
  harness: string
  showAgents: string
  showCron: string
  showMessaging: string
  showTerminal: string
  showWebhooks: string
}

const BASE_ALLOWED_ROUTES = ['/', '/artifacts', '/settings', '/skills'] as const
const INTERNAL_HARNESS_EXCLUDED_PANES = new Set(['lemon-bots:pane'])

const SESSION_RESERVED_ROUTES = [
  ...BASE_ALLOWED_ROUTES,
  '/agents',
  '/command-center',
  '/cron',
  '/messaging',
  '/profiles',
  '/starmap',
  '/webhooks'
] as const

function envString(env: HarnessEnv, key: string): string {
  const value = env[key]

  return typeof value === 'string' ? value.trim() : ''
}

function envBoolean(env: HarnessEnv, key: string, fallback: boolean): boolean {
  const value = envString(env, key).toLowerCase()

  if (!value) {
    return fallback
  }

  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
}

export function harnessEnvFromBuildConstants(constants: Partial<HarnessBuildConstants> = {}): HarnessEnv {
  return {
    VITE_LEMON_DESKTOP_HARNESS: constants.harness ?? '',
    VITE_LEMON_HARNESS_SHOW_AGENTS: constants.showAgents ?? 'false',
    VITE_LEMON_HARNESS_SHOW_CRON: constants.showCron ?? 'true',
    VITE_LEMON_HARNESS_SHOW_MESSAGING: constants.showMessaging ?? 'false',
    VITE_LEMON_HARNESS_SHOW_TERMINAL: constants.showTerminal ?? 'true',
    VITE_LEMON_HARNESS_SHOW_WEBHOOKS: constants.showWebhooks ?? 'false'
  }
}

const HARNESS_RUNTIME_GLOBAL_BY_CONSTANT: Record<keyof HarnessBuildConstants, string> = {
  harness: '__LEMON_DESKTOP_HARNESS__',
  showAgents: '__LEMON_HARNESS_SHOW_AGENTS__',
  showCron: '__LEMON_HARNESS_SHOW_CRON__',
  showMessaging: '__LEMON_HARNESS_SHOW_MESSAGING__',
  showTerminal: '__LEMON_HARNESS_SHOW_TERMINAL__',
  showWebhooks: '__LEMON_HARNESS_SHOW_WEBHOOKS__'
}

function buildConstantValue(name: keyof HarnessBuildConstants, compiledValue: string, fallback: string): string {
  if (import.meta.env.MODE === 'test') {
    const globalValue = (globalThis as unknown as Partial<Record<string, unknown>>)[
      HARNESS_RUNTIME_GLOBAL_BY_CONSTANT[name]
    ]

    if (typeof globalValue === 'string') {
      return globalValue
    }
  }

  return compiledValue || fallback
}

export function internalCompanyBuildEnv(): HarnessEnv {
  return harnessEnvFromBuildConstants({
    harness: buildConstantValue('harness', typeof __LEMON_DESKTOP_HARNESS__ === 'string' ? __LEMON_DESKTOP_HARNESS__ : '', ''),
    showAgents: buildConstantValue(
      'showAgents',
      typeof __LEMON_HARNESS_SHOW_AGENTS__ === 'string' ? __LEMON_HARNESS_SHOW_AGENTS__ : '',
      'false'
    ),
    showCron: buildConstantValue(
      'showCron',
      typeof __LEMON_HARNESS_SHOW_CRON__ === 'string' ? __LEMON_HARNESS_SHOW_CRON__ : '',
      'true'
    ),
    showMessaging: buildConstantValue(
      'showMessaging',
      typeof __LEMON_HARNESS_SHOW_MESSAGING__ === 'string' ? __LEMON_HARNESS_SHOW_MESSAGING__ : '',
      'false'
    ),
    showTerminal: buildConstantValue(
      'showTerminal',
      typeof __LEMON_HARNESS_SHOW_TERMINAL__ === 'string' ? __LEMON_HARNESS_SHOW_TERMINAL__ : '',
      'true'
    ),
    showWebhooks: buildConstantValue(
      'showWebhooks',
      typeof __LEMON_HARNESS_SHOW_WEBHOOKS__ === 'string' ? __LEMON_HARNESS_SHOW_WEBHOOKS__ : '',
      'false'
    )
  })
}

export function internalCompanyExpectedFromEnv(env: HarnessEnv): boolean {
  const profile = envString(env, 'VITE_LEMON_DESKTOP_HARNESS').toLowerCase()

  return profile === 'internal'
}

export function harnessUiFlagsFromEnv(env: HarnessEnv): HarnessUiFlags {
  return {
    agents: envBoolean(env, 'VITE_LEMON_HARNESS_SHOW_AGENTS', false),
    cron: envBoolean(env, 'VITE_LEMON_HARNESS_SHOW_CRON', true),
    messaging: envBoolean(env, 'VITE_LEMON_HARNESS_SHOW_MESSAGING', false),
    terminal: envBoolean(env, 'VITE_LEMON_HARNESS_SHOW_TERMINAL', true),
    webhooks: envBoolean(env, 'VITE_LEMON_HARNESS_SHOW_WEBHOOKS', false)
  }
}

function buildAllowedRoutes(ui: HarnessUiFlags): ReadonlySet<string> {
  const routes = new Set<string>(BASE_ALLOWED_ROUTES)

  if (ui.agents) {
    routes.add('/agents')
  }

  if (ui.cron) {
    routes.add('/cron')
  }

  if (ui.messaging) {
    routes.add('/messaging')
  }

  if (ui.webhooks) {
    routes.add('/webhooks')
  }

  return routes
}

export function initialInternalCompanyCapabilities(
  expected: boolean,
  ui: HarnessUiFlags = harnessUiFlagsFromEnv({})
): InternalCompanyCapabilityState {
  if (!expected) {
    return {
      allowedRoutes: new Set(),
      expected,
      mode: 'upstream',
      provisioning: { missing: [], state: 'unknown' },
      reservedRoutes: new Set(),
      terminalAllowed: true,
      ui
    }
  }

  const allowedRoutes = buildAllowedRoutes(ui)

  return {
    allowedRoutes,
    expected,
    mode: 'harness',
    provisioning: { detail: 'Runtime provisioning has not reported readiness yet.', missing: [], state: 'unknown' },
    reservedRoutes: new Set(SESSION_RESERVED_ROUTES),
    terminalAllowed: ui.terminal,
    ui
  }
}

export function updateInternalCompanyProvisioning(
  current: InternalCompanyCapabilityState,
  provisioning: HarnessProvisioning
): InternalCompanyCapabilityState {
  if (current.mode === 'upstream') {
    return current
  }

  return { ...current, provisioning }
}

export function harnessProvisioningFromRuntimeReadiness(
  status: {
    ready: boolean
    reason: null | string
  } | null
): HarnessProvisioning {
  if (status === null) {
    return { missing: [], state: 'unknown' }
  }

  if (status.ready) {
    return { missing: [], state: 'complete' }
  }

  return {
    detail: status.reason ?? 'IT setup incomplete.',
    missing: ['inference'],
    state: 'incomplete'
  }
}

export function internalCompanyRouteAllowed(to: string, state: InternalCompanyRouteState): boolean {
  if (state.mode === 'upstream') {
    return true
  }

  const path = routePathname(to)

  if (state.allowedRoutes?.has(path)) {
    return true
  }

  return routeSessionIdWithReserved(path, state.reservedRoutes ?? new Set(SESSION_RESERVED_ROUTES)) !== null
}

export function filterInternalCompanyRoutes(routes: readonly string[], state: InternalCompanyRouteState): string[] {
  return routes.filter(route => internalCompanyRouteAllowed(route, state))
}

export function internalCompanyPaneAllowed(paneId: string, state: InternalCompanyRouteState): boolean {
  return state.mode !== 'harness' || !INTERNAL_HARNESS_EXCLUDED_PANES.has(paneId)
}
