import { act, cleanup, render, screen } from '@testing-library/react'
import { atom } from 'nanostores'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $internalCompanyCapabilities, resetInternalCompanyCapabilitiesForTest } from '@/app/internal-company/store'
import type { LemonGateway } from '@/lemon'
import { $gateway } from '@/store/gateway'
import { $activeGatewayProfile } from '@/store/profile'

import { ChatRoutesSurface } from './surfaces'
import type { WiringActions } from './types'

vi.mock('@/contrib/react/use-contributions', () => ({ useContributions: vi.fn() }))
vi.mock('@/store/connections', () => ({ $activeConnectionId: atom('local') }))
vi.mock('@/store/gateway', () => ({ $gateway: atom<unknown>(null) }))
vi.mock('@/store/profile', () => ({ $activeGatewayProfile: atom('default') }))
vi.mock('@/store/session', () => ({
  $freshDraftReady: atom(false),
  $gatewayState: atom('open')
}))
vi.mock('../chat', () => ({
  ChatView: ({ gateway, modelMenuContent }: { gateway: { id?: string } | null; modelMenuContent?: ReactNode }) => (
    <div data-testid="gateway">
      {gateway?.id}
      {modelMenuContent}
    </div>
  )
}))
vi.mock('../chat/sidebar', () => ({ ChatSidebar: () => null }))
vi.mock('../right-sidebar/terminal/chrome', () => ({ TerminalPaneChrome: () => null }))
vi.mock('../shell/hooks/use-status-snapshot', () => ({ useStatusSnapshot: () => ({}) }))
vi.mock('../shell/hooks/use-statusbar-items', () => ({
  useStatusbarItems: () => ({ leftStatusbarItems: [], statusbarItems: [] })
}))
vi.mock('../shell/statusbar-controls', () => ({ StatusbarControls: () => null }))
vi.mock('../routes', () => ({
  contributedRoutes: () => [],
  internalCompanyRouteAllowed: vi.fn(
    (to: string, state: { allowedRoutes?: Set<string>; mode?: 'harness' | 'upstream' } = { mode: 'upstream' }) => {
      if (state.mode === 'upstream') {
        return true
      }

      const path = to.split(/[?#]/, 1)[0] || '/'

      return state.allowedRoutes?.has(path) ?? true
    }
  ),
  NEW_CHAT_ROUTE: '/new',
  ROUTES_AREA: 'routes',
  sessionRoute: (id: string) => `/${id}`
}))
vi.mock('./latest-actions', () => ({ latestChatActions: () => ({}), latestSidebarActions: () => ({}) }))
vi.mock('./panes', () => ({ setStatusbarItemGroup: vi.fn(), useStatusbarContributions: () => [] }))
vi.mock('../shell/model-menu-panel', () => ({
  ModelMenuPanel: ({ onlyCurrentProvider }: { onlyCurrentProvider?: boolean }) => (
    <div data-only-current-provider={String(!!onlyCurrentProvider)} data-testid="model-menu" />
  )
}))

afterEach(() => {
  cleanup()
  $gateway.set(null)
  $activeGatewayProfile.set('default')
  resetInternalCompanyCapabilitiesForTest()
})

describe('ChatRoutesSurface', () => {
  it('passes the live gateway after an open-to-open profile switch', () => {
    const gatewayA = { id: 'a' } as unknown as LemonGateway
    const gatewayB = { id: 'b' } as unknown as LemonGateway

    $gateway.set(gatewayA)
    const actions = { getGateway: () => $gateway.get() } as unknown as WiringActions

    render(
      <MemoryRouter>
        <ChatRoutesSurface actions={actions} />
      </MemoryRouter>
    )

    expect(screen.getByTestId('gateway').textContent).toBe('a')

    act(() => {
      $gateway.set(gatewayB)
      $activeGatewayProfile.set('other')
    })

    expect(screen.getByTestId('gateway').textContent).toBe('b')
  })

  it('keeps the chat model menu available in the internal workspace', () => {
    $internalCompanyCapabilities.set({ ...$internalCompanyCapabilities.get(), expected: true, mode: 'harness' })
    const actions = { getGateway: () => $gateway.get() } as unknown as WiringActions

    render(
      <MemoryRouter>
        <ChatRoutesSurface actions={actions} />
      </MemoryRouter>
    )

    expect(screen.getByTestId('model-menu').getAttribute('data-only-current-provider')).toBe('true')
  })
})
