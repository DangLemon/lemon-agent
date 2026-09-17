import { act, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { textPart } from '@/lib/chat-messages'
import { createClientSessionState } from '@/lib/chat-runtime'
import { $notifications, clearNotifications } from '@/store/notifications'
import { setActiveSessionId } from '@/store/session'

import { type MessageStreamHarness, renderMessageStream } from './test-harness'

const SID = 'rt-new-session'

let stream: MessageStreamHarness

function mountStream() {
  stream = renderMessageStream(SID)
}

function setWindowState({ focused = true, hidden = false }: { focused?: boolean; hidden?: boolean }) {
  Object.defineProperty(document, 'hidden', { configurable: true, value: hidden })
  Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => focused })
}

/** Seed the session as it looks right after a first-message submit: the
 *  optimistic user row is present, the turn is awaiting its response. */
function seedOptimisticFirstMessage() {
  stream.states.set(SID, {
    ...createClientSessionState('stored-new-session', [
      { id: 'user-123-abc', role: 'user', parts: [textPart('first message of a new chat')] }
    ]),
    busy: true,
    awaitingResponse: true
  })
}

describe('useMessageStream agent-init error surfacing (#63078)', () => {
  beforeEach(() => {
    clearNotifications()
  })

  afterEach(() => {
    cleanup()
    clearNotifications()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders an agent-init failure as a visible in-transcript error and keeps the optimistic first message', async () => {
    mountStream()
    seedOptimisticFirstMessage()

    act(() =>
      stream.handleEvent({
        payload: {
          message:
            'agent initialization timed out after 601s — your message was not sent; retry once the session is ready'
        },
        session_id: SID,
        type: 'error'
      })
    )

    const state = stream.state()

    // The user's optimistic first message must survive — the failure mode of
    // #63078 was the message silently vanishing into a blank session.
    const userRows = state.messages.filter(m => m.role === 'user')
    expect(userRows).toHaveLength(1)
    expect(userRows[0]!.id).toBe('user-123-abc')

    // The failure is VISIBLE in the session view: an assistant error bubble...
    const errorRows = state.messages.filter(m => m.role === 'assistant' && m.error)
    expect(errorRows).toHaveLength(1)
    expect(errorRows[0]!.error).toContain('your message was not sent')

    // ...and the composer is released (no forever-spinner on a dead turn).
    expect(state.busy).toBe(false)
    expect(state.awaitingResponse).toBe(false)

    // A global toast also fired (turn-ending errors are easy to miss inline).
    expect($notifications.get().some(n => n.kind === 'error' && n.message?.includes('was not sent'))).toBe(true)
  })

  it('renders the pre-ready cancel error event (#65567 server emit) visibly', () => {
    mountStream()
    seedOptimisticFirstMessage()

    act(() =>
      stream.handleEvent({
        payload: { message: 'Turn cancelled before the agent was ready' },
        session_id: SID,
        type: 'error'
      })
    )

    const state = stream.state()
    expect(state.messages.some(m => m.role === 'assistant' && m.error?.includes('cancelled'))).toBe(true)
    expect(state.messages.some(m => m.id === 'user-123-abc')).toBe(true)
    expect(state.busy).toBe(false)
  })

  it('brands only the static gateway error fallback when the backend omits error text', () => {
    vi.stubGlobal('__LEMON_DESKTOP_HARNESS__', 'internal')
    mountStream()
    seedOptimisticFirstMessage()

    act(() =>
      stream.handleEvent({
        payload: {},
        session_id: SID,
        type: 'error'
      })
    )

    const expected = 'Lemon AI reported an error'
    const state = stream.state()

    expect(state.messages.some(m => m.role === 'assistant' && m.error === expected)).toBe(true)
    expect($notifications.get().some(n => n.title === 'Lemon AI error' && n.message === expected)).toBe(true)
  })

  it('preserves raw gateway error payloads in transcript, toast, and native notification storage', () => {
    const notify = vi.fn().mockResolvedValue(true)
    const sourceEnvPath = ['~/.lemon-ai/', 'env'].join('.')
    vi.stubGlobal('__LEMON_DESKTOP_HARNESS__', 'internal')
    Object.defineProperty(window, 'lemonDesktop', {
      configurable: true,
      value: { notify }
    })
    setWindowState({ focused: false, hidden: true })
    setActiveSessionId(SID)
    mountStream()
    seedOptimisticFirstMessage()

    act(() =>
      stream.handleEvent({
        payload: {
          message: `Run 'lemon model', then check ${sourceEnvPath} because Hermes-4.5 failed in the Lemon AI gateway.`
        },
        session_id: SID,
        type: 'error'
      })
    )

    const expected = `Run 'lemon model', then check ${sourceEnvPath} because Hermes-4.5 failed in the Lemon AI gateway.`
    const state = stream.state()

    expect(state.messages.some(m => m.role === 'assistant' && m.error === expected)).toBe(true)
    expect($notifications.get().some(n => n.title === 'Lemon AI error' && n.message === expected)).toBe(true)
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ body: expected, kind: 'turnError' }))
  })
})
