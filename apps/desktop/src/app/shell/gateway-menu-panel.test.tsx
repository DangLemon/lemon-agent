import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLogs: vi.fn().mockResolvedValue({ lines: [] }),
  notifyError: vi.fn(),
  reconnectGateway: vi.fn<() => Promise<void>>()
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tip: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('@/lemon', () => ({
  getLogs: mocks.getLogs
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      commandCenter: { restartGateway: 'Restart gateway' },
      shell: {
        gatewayMenu: {
          checkingInference: 'Checking inference',
          connected: 'Connected',
          connecting: 'Connecting',
          disconnected: 'Disconnected',
          inferenceNotReady: 'Inference not ready',
          inferenceReady: 'Inference ready',
          messagingPlatforms: 'Messaging platforms',
          offline: 'Offline',
          openAiConnection: 'Open AI Connection',
          openSystem: 'Open system panel',
          recentActivity: 'Recent activity',
          reconnectGateway: 'Reconnect gateway',
          viewAllLogs: 'View all logs',
          aiConnectionMissingTitle: 'No AI connection ready',
          aiConnectionMissingDetail: 'Add an AI connection before starting Lemon AI conversations.',
          provisioningUnknownTitle: 'IT setup status unknown',
          provisioningUnknownDetail: 'Runtime provisioning has not reported readiness yet.',
          provisioningIncompleteTitle: 'IT setup incomplete',
          provisioningIncompleteDetail: 'One or more required setup categories are missing.'
        }
      }
    }
  })
}))

vi.mock('@/store/gateway-reconnect', () => ({
  reconnectGateway: mocks.reconnectGateway
}))

vi.mock('@/store/notifications', () => ({
  notifyError: mocks.notifyError
}))

vi.mock('@/store/system-actions', () => ({
  runGatewayRestart: vi.fn()
}))

import { GatewayMenuPanel } from './gateway-menu-panel'

const renderPanel = (gatewayState: string, props: Partial<React.ComponentProps<typeof GatewayMenuPanel>> = {}) =>
  render(
    <GatewayMenuPanel
      gatewayState={gatewayState}
      inferenceStatus={null}
      onClose={vi.fn()}
      onOpenSystem={vi.fn()}
      statusSnapshot={null}
      {...props}
    />
  )

describe('GatewayMenuPanel reconnect action', () => {
  beforeEach(() => {
    mocks.reconnectGateway.mockReset().mockResolvedValue(undefined)
    mocks.getLogs.mockReset().mockResolvedValue({ lines: [] })
    mocks.notifyError.mockReset()
  })

  afterEach(() => cleanup())

  it('shows reconnect only while disconnected and disables it in flight', async () => {
    let finish: (() => void) | undefined
    mocks.reconnectGateway.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve
        })
    )

    renderPanel('closed')

    const reconnect = screen.getByRole('button', { name: 'Reconnect gateway' })
    fireEvent.click(reconnect)
    fireEvent.click(reconnect)

    expect(mocks.reconnectGateway).toHaveBeenCalledOnce()
    expect((reconnect as HTMLButtonElement).disabled).toBe(true)

    await act(async () => finish?.())
  })

  it('hides reconnect while the socket is open', async () => {
    renderPanel('open')
    await act(async () => undefined)

    expect(screen.queryByRole('button', { name: 'Reconnect gateway' })).toBeNull()
  })
})

describe('GatewayMenuPanel internal harness chrome', () => {
  afterEach(() => cleanup())

  it('renders a friendly AI connection action for missing inference and hides admin chrome', async () => {
    mocks.getLogs.mockResolvedValue({ lines: ['2026-09-07 10:00:00 setup check failed'] })
    const onClose = vi.fn()
    const onOpenAiConnection = vi.fn()

    renderPanel('open', {
      harnessMode: true,
      harnessProvisioning: { detail: 'No inference provider configured.', missing: ['inference'], state: 'incomplete' },
      onClose,
      onOpenAiConnection
    })

    expect(await screen.findByText('No AI connection ready')).toBeTruthy()
    expect(screen.getByText('Add an AI connection before starting Lemon AI conversations.')).toBeTruthy()
    expect(screen.queryByText('No inference provider configured.')).toBeNull()
    expect(screen.queryByText('Missing: inference')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open system panel' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Restart gateway' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'View all logs' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open AI Connection' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onOpenAiConnection).toHaveBeenCalledOnce()
  })

  it('renders an unknown provisioning notice with a direct AI connection action', () => {
    const onClose = vi.fn()
    const onOpenAiConnection = vi.fn()

    renderPanel('open', {
      harnessMode: true,
      harnessProvisioning: {
        detail: 'Runtime provisioning has not reported readiness yet.',
        missing: [],
        state: 'unknown'
      },
      onClose,
      onOpenAiConnection
    })

    expect(screen.getByText('IT setup status unknown')).toBeTruthy()
    expect(screen.getByText('Runtime provisioning has not reported readiness yet.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open AI Connection' }))

    expect(onClose).toHaveBeenCalledOnce()
    expect(onOpenAiConnection).toHaveBeenCalledOnce()
  })

  it('opens AI connection from the disconnected harness state', () => {
    const onOpenAiConnection = vi.fn()

    renderPanel('closed', {
      harnessMode: true,
      onOpenAiConnection
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open AI Connection' }))

    expect(onOpenAiConnection).toHaveBeenCalledOnce()
  })

  it('opens AI connection when provisioning is complete but inference is not ready', () => {
    const onOpenAiConnection = vi.fn()

    renderPanel('open', {
      harnessMode: true,
      harnessProvisioning: { missing: [], state: 'complete' },
      inferenceStatus: { checksDisagree: false, ready: false, reason: 'No provider can serve the selected model.', source: 'runtime_check' },
      onOpenAiConnection
    })

    expect(screen.getByText('No provider can serve the selected model.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open AI Connection' }))

    expect(onOpenAiConnection).toHaveBeenCalledOnce()
  })
})
