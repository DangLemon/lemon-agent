import { replaceLemonBrandTerms } from '@/lib/app-brand'

export interface McpOAuthFlow {
  flow_id: string
  server_name: string
  status: 'starting' | 'authorization_required' | 'approved' | 'error'
  authorization_url: string | null
  error: string | null
  tools?: Array<{ name: string; description: string }>
  callback_transport?: 'backend' | 'desktop_loopback'
  callback_redirect_uri?: null | string
  callback_expected_state?: null | string
}

interface DesktopLoopbackCallback {
  code: null | string
  error: null | string
  state: null | string
}

interface CompleteOptions {
  serverName: string
  start: (name: string) => Promise<McpOAuthFlow>
  status: (flowId: string) => Promise<McpOAuthFlow>
  relayCallback?: (
    flowId: string,
    callback: { code?: null | string; error?: null | string; state?: null | string }
  ) => Promise<unknown>
  openExternal: (url: string) => Promise<void>
  /** Polled between status checks. Returning true cancels: the flow is
   *  cancelled SERVER-SIDE (freeing the per-server in-progress slot — without
   *  it a retry 409s until the backend's callback timeout) and the promise
   *  rejects with `McpOAuthCancelled`. */
  cancelled?: () => boolean
  /** Server-side flow cancel, wired to DELETE /api/mcp/oauth/flows/{id}. */
  cancel?: (flowId: string) => Promise<unknown>
  sleep?: (milliseconds: number) => Promise<void>
  maxPollFailures?: number
}

/** Thrown when the caller's `cancelled()` tripped — callers branch on this to
 *  skip error toasts for a deliberate user cancel. */
export class McpOAuthCancelled extends Error {
  constructor() {
    super('OAuth cancelled by user')
    this.name = 'McpOAuthCancelled'
  }
}

const defaultSleep = (milliseconds: number) => new Promise<void>(resolve => window.setTimeout(resolve, milliseconds))

async function waitForDesktopCallback(
  listenerId: string,
  cancelled: (() => boolean) | undefined,
  sleep: (milliseconds: number) => Promise<void>
): Promise<DesktopLoopbackCallback> {
  const bridge = window.lemonDesktop?.mcpOauth

  if (!bridge) {
    throw new Error(
      replaceLemonBrandTerms(
        'Desktop loopback OAuth requires the Lemon AI app. Open this flow in Desktop and retry.'
      )
    )
  }

  const waitPromise = bridge.wait(listenerId)

  for (;;) {
    if (cancelled?.()) {
      await bridge.cancel(listenerId).catch(() => {})
      throw new McpOAuthCancelled()
    }

    const result = await Promise.race([
      waitPromise.then(value => ({ done: true as const, value })),
      sleep(250).then(() => ({ done: false as const }))
    ])

    if (result.done) {
      if (result.value.error && !result.value.state) {
        throw new Error(result.value.error)
      }

      return result.value
    }
  }
}

export async function completeMcpDesktopOAuth({
  serverName,
  start,
  status,
  relayCallback,
  openExternal,
  cancelled,
  cancel,
  sleep = defaultSleep,
  maxPollFailures = 3
}: CompleteOptions): Promise<McpOAuthFlow> {
  const started = await start(serverName)
  let listenerId: null | string = null

  try {
    if (started.status === 'error') {
      throw new Error(started.error || 'OAuth failed to start')
    }

    if (!started.authorization_url) {
      throw new Error('OAuth server did not provide an authorization URL')
    }

    if (started.callback_transport === 'desktop_loopback') {
      if (!started.callback_redirect_uri) {
        throw new Error('OAuth server requested Desktop loopback but did not provide a redirect URI')
      }

      if (!relayCallback) {
        throw new Error('OAuth server requested Desktop loopback but no callback relay is available')
      }

      const bridge = window.lemonDesktop?.mcpOauth

      if (!bridge) {
        throw new Error(
          replaceLemonBrandTerms(
            'Desktop loopback OAuth requires the Lemon AI app. Open this flow in Desktop and retry.'
          )
        )
      }

      const listener = await bridge.listen({
        redirectUri: started.callback_redirect_uri,
        expectedState: started.callback_expected_state
      })

      listenerId = listener.id
    }

    if (cancelled?.()) {
      throw new McpOAuthCancelled()
    }

    await openExternal(started.authorization_url)

    if (listenerId) {
      const callback = await waitForDesktopCallback(listenerId, cancelled, sleep)

      if (cancelled?.()) {
        throw new McpOAuthCancelled()
      }

      await relayCallback!(started.flow_id, {
        code: callback.code || undefined,
        state: callback.state || undefined,
        error: callback.error || undefined
      })
      listenerId = null
    }

    let pollFailures = 0

    for (;;) {
      if (cancelled?.()) {
        throw new McpOAuthCancelled()
      }

      let current: McpOAuthFlow

      try {
        current = await status(started.flow_id)
        pollFailures = 0
      } catch (error) {
        pollFailures += 1

        if (pollFailures >= maxPollFailures) {
          throw error
        }

        await sleep(1000)

        continue
      }

      if (current.status === 'approved') {
        return current
      }

      if (current.status === 'error') {
        throw new Error(current.error || 'OAuth authorization failed')
      }

      await sleep(1000)
    }
  } catch (error) {
    await cancel?.(started.flow_id).catch(() => {})
    throw error
  } finally {
    if (listenerId) {
      await window.lemonDesktop?.mcpOauth?.cancel(listenerId).catch(() => {})
    }
  }
}
