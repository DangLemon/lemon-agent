// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { closePluginInstallRequest, openPluginInstallRequest } from '@/store/plugin-install-request'

const { requestGateway, installAgentPlugin, loadAgentPlugins, runGatewayRestart, notify, probePluginRepo } = vi.hoisted(() => ({
  requestGateway: vi.fn(),
  installAgentPlugin: vi.fn(),
  loadAgentPlugins: vi.fn(),
  runGatewayRestart: vi.fn(),
  notify: vi.fn(),
  probePluginRepo: vi.fn()
}))

vi.mock('@/app/gateway/hooks/use-gateway-request', () => ({
  useGatewayRequest: () => ({ requestGateway })
}))

vi.mock('@/store/agent-plugins', () => ({
  installAgentPlugin,
  loadAgentPlugins
}))

vi.mock('@/store/notifications', () => ({
  notify,
  notifyError: vi.fn()
}))

vi.mock('@/store/system-actions', () => ({ runGatewayRestart }))

vi.mock('@/contrib/runtime-loader', () => ({ discoverRuntimePlugins: vi.fn() }))

import { PluginInstallModal } from './plugin-install-modal'

beforeEach(() => {
  requestGateway.mockReset()
  installAgentPlugin.mockReset().mockResolvedValue({ ok: true, pluginName: 'demo-plugin' })
  loadAgentPlugins.mockReset().mockResolvedValue(undefined)
  runGatewayRestart.mockReset().mockResolvedValue(undefined)
  notify.mockReset()
  probePluginRepo.mockReset().mockResolvedValue({
    agent: true,
    agentName: 'demo-plugin',
    desktop: false,
    desktopName: null,
    error: undefined,
    insecure: false,
    ok: true,
    warnings: []
  })
  window.lemonDesktop = { probePluginRepo } as unknown as Window['lemonDesktop']
  openPluginInstallRequest({ repo: 'owner/demo-plugin', enable: true, force: false, legacyHint: null })
})

afterEach(() => {
  closePluginInstallRequest()
  cleanup()
  vi.clearAllMocks()
})

describe('PluginInstallModal', () => {
  it('installs in the app and offers a gateway restart for agent plugins', async () => {
    render(
      <I18nProvider configClient={null} initialLocale="en">
        <MemoryRouter initialEntries={['/'] }>
          <PluginInstallModal />
        </MemoryRouter>
      </I18nProvider>
    )

    await screen.findByText('Agent plugin')
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    await waitFor(() =>
      expect(installAgentPlugin).toHaveBeenCalledWith(expect.anything(), {
        enable: true,
        force: false,
        identifier: 'owner/demo-plugin'
      })
    )
    expect(loadAgentPlugins).toHaveBeenCalled()

    const restartNotification = notify.mock.calls
      .map(([input]) => input)
      .find(input => input?.title === 'Agent plugin installed')
    expect(restartNotification?.durationMs).toBe(0)

    expect(restartNotification?.action?.label).toBe('Restart gateway')

    await restartNotification.action.onClick()

    expect(runGatewayRestart).toHaveBeenCalledOnce()
    expect(loadAgentPlugins).toHaveBeenCalledTimes(2)
  })
})
