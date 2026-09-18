import type { FirstRunSetupDecision } from './first-run-setup-gate'

export interface PrimaryBackendStartupOptions<Backend, RuntimeBackend, Remote, Connection> {
  connectRemote: (remote: Remote) => Promise<Connection>
  ensureLocalRuntime: (backend: Backend) => Promise<RuntimeBackend>
  prepareLocalBackend: () => Backend | Promise<Backend>
  resolveRemote: () => Promise<Remote | null>
  waitForDecision: (backend: Backend) => Promise<FirstRunSetupDecision>
  waitForLocalStart: () => Promise<unknown>
  forceLocalBackend?: boolean
}

export type PrimaryBackendStartupResult<RuntimeBackend, Connection> =
  { kind: 'local'; backend: RuntimeBackend } | { kind: 'remote'; connection: Connection }

interface ResolvedPrimaryRemote {
  authMode?: 'oauth' | 'token'
  baseUrl: string
  connectionId?: string
  remoteLemonVersion?: string
  remoteHost?: string
  remoteKind?: 'cloud' | 'ssh' | 'url'
  source?: string
  ssh?: {
    effectiveConfigFingerprint?: string
    host?: string
    keyPath?: string
    port?: number
    remoteLemonPath?: string
    remoteProfile?: string
    user?: string
  }
  token: unknown
  wsUrl: string
}


export function resolvePrimaryHarnessLaunchScope({
  harnessRequested,
  persistedProfile
}: {
  harnessRequested: boolean
  persistedProfile?: string | null
}) {
  const primaryProfile = harnessRequested ? 'default' : String(persistedProfile || '').trim() || 'default'
  const backendArgs = ['serve', '--host', '127.0.0.1', '--port', '0']

  if (!harnessRequested && persistedProfile) {
    backendArgs.unshift('--profile', persistedProfile)
  }

  return { primaryProfile, backendArgs }
}

/**
 * Build the renderer-facing primary remote descriptor without dropping route
 * identity. Tests cross this same seam, so adding a field to the resolved
 * remote cannot silently disappear during primary startup.
 */
export function createPrimaryRemoteConnection<State extends object>(
  remote: ResolvedPrimaryRemote,
  logs: string[],
  windowState: State
) {
  return {
    baseUrl: remote.baseUrl,
    mode: 'remote' as const,
    source: remote.source,
    authMode: remote.authMode || 'token',
    remoteHost: remote.remoteHost,
    remoteKind: remote.remoteKind,
    remoteLemonVersion: remote.remoteLemonVersion,
    ...(remote.connectionId ? { connectionId: remote.connectionId } : {}),
    ...(remote.ssh ? { ssh: remote.ssh } : {}),
    token: remote.token,
    wsUrl: remote.wsUrl,
    logs,
    ...windowState
  }
}

export class FirstRunSetupResetError extends Error {
  readonly firstRunSetupReset = true

  constructor() {
    super('First-run setup was reset before a choice completed.')
    this.name = 'FirstRunSetupResetError'
  }
}

// Owns the production startLemon path up to the local process spawn. Keeping
// the full ordering here makes the first-run remote boundary executable in a
// test: an already-saved remote wins immediately; otherwise update exclusion
// and local backend resolution happen before the setup gate, and a remote Apply
// re-resolves persisted config without ever entering ensureRuntime/bootstrap.
export async function runPrimaryBackendStartup<Backend, RuntimeBackend, Remote, Connection>({
  connectRemote,
  ensureLocalRuntime,
  prepareLocalBackend,
  resolveRemote,
  waitForDecision,
  waitForLocalStart,
  forceLocalBackend = false
}: PrimaryBackendStartupOptions<Backend, RuntimeBackend, Remote, Connection>): Promise<
  PrimaryBackendStartupResult<RuntimeBackend, Connection>
> {
  const savedRemote = forceLocalBackend ? null : await resolveRemote()

  if (savedRemote) {
    return { kind: 'remote', connection: await connectRemote(savedRemote) }
  }

  await waitForLocalStart()

  const backend = await prepareLocalBackend()

  if (forceLocalBackend) {
    return { kind: 'local', backend: await ensureLocalRuntime(backend) }
  }

  const decision = await waitForDecision(backend)

  if (decision === 'remote-applied') {
    const appliedRemote = await resolveRemote()

    if (!appliedRemote) {
      throw new Error('First-run remote setup completed without a saved remote backend.')
    }

    return { kind: 'remote', connection: await connectRemote(appliedRemote) }
  }

  if (decision === 'reset') {
    throw new FirstRunSetupResetError()
  }

  return { kind: 'local', backend: await ensureLocalRuntime(backend) }
}
