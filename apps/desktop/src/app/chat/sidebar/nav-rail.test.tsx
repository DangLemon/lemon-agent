import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { $internalCompanyCapabilities } from '@/app/internal-company/store'
import { SIDEBAR_COLLAPSE_MEDIA_QUERY } from '@/app/layout-constants'
import { SIDEBAR_NAV_AREA } from '@/app/routes'
import { $sidebarPreviewSide } from '@/components/pane-shell/tree/store'
import { SidebarProvider } from '@/components/ui/sidebar'
import { registry } from '@/contrib/registry'
import { I18nProvider } from '@/i18n'
import { $panesFlipped, $sidebarOpen, setSidebarOpen } from '@/store/layout'
import { openRouteTile } from '@/store/route-tiles'

import { SidebarNavRail } from './nav-rail'

const disposers: (() => void)[] = []

vi.mock('@/contrib/react/use-contributions', () => ({
  useContributions: (area: string) => (area === SIDEBAR_NAV_AREA ? registry.getArea(area) : [])
}))
vi.mock('@/store/route-tiles', () => ({ openRouteTile: vi.fn() }))

afterEach(() => {
  cleanup()
  disposers.splice(0).forEach(dispose => dispose())
  vi.unstubAllGlobals()
  setSidebarOpen(true)
  $sidebarPreviewSide.set(null)
  $panesFlipped.set(false)
  $internalCompanyCapabilities.set({ ...$internalCompanyCapabilities.get(), mode: 'upstream' })
  vi.clearAllMocks()
})

describe('SidebarNavRail', () => {
  it('shows accessible route icons and navigates without including New chat', () => {
    const onNavigate = vi.fn()

    render(
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <SidebarProvider>
            <SidebarNavRail currentView="chat" onNavigate={onNavigate} />
          </SidebarProvider>
        </I18nProvider>
      </MemoryRouter>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Capabilities' }))

    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ id: 'skills', route: '/skills' }))
    expect(onNavigate).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'new-session' }))
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy()
  })

  it('previews the sidebar from the Chat rail icon, not the titlebar toggle', () => {
    setSidebarOpen(false)
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query !== SIDEBAR_COLLAPSE_MEDIA_QUERY,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
    render(
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <SidebarProvider>
            <SidebarNavRail currentView="chat" onNavigate={vi.fn()} />
          </SidebarProvider>
        </I18nProvider>
      </MemoryRouter>
    )

    const chat = screen.getByRole('button', { name: 'Chat' })
    const skills = screen.getByRole('button', { name: 'Capabilities' })

    fireEvent.pointerEnter(skills)
    expect($sidebarPreviewSide.get()).toBeNull()

    fireEvent.pointerEnter(chat)
    expect($sidebarPreviewSide.get()).toBe('left')

    fireEvent.pointerLeave(chat)
    expect($sidebarOpen.get()).toBe(false)
  })

  it('previews the physically flipped sessions side from the Chat rail icon', () => {
    setSidebarOpen(false)
    $panesFlipped.set(true)
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query !== SIDEBAR_COLLAPSE_MEDIA_QUERY,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
    render(
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <SidebarProvider>
            <SidebarNavRail currentView="chat" onNavigate={vi.fn()} />
          </SidebarProvider>
        </I18nProvider>
      </MemoryRouter>
    )

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Chat' }))

    expect($sidebarPreviewSide.get()).toBe('right')
  })

  it('keeps New chat out of the navigation rail so it remains a panel action', () => {
    render(
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <SidebarProvider>
            <SidebarNavRail currentView="chat" onNavigate={vi.fn()} />
          </SidebarProvider>
        </I18nProvider>
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull()
  })

  it('omits routes denied by the internal workspace policy', () => {
    $internalCompanyCapabilities.set({ ...$internalCompanyCapabilities.get(), mode: 'harness' })

    render(
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <SidebarProvider>
            <SidebarNavRail currentView="chat" onNavigate={vi.fn()} />
          </SidebarProvider>
        </I18nProvider>
      </MemoryRouter>
    )

    expect(screen.queryByRole('button', { name: 'Scheduled jobs' })).toBeNull()
  })

  it('shows contributed routes in the rail and opens them in a split', () => {
    disposers.push(
      registry.register({
        area: SIDEBAR_NAV_AREA,
        data: { codicon: 'plug', label: 'Plugin tool', path: '/plugin-tool' },
        id: 'plugin-tool',
        title: 'Plugin tool'
      })
    )

    render(
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <SidebarProvider>
            <SidebarNavRail currentView="chat" onNavigate={vi.fn()} />
          </SidebarProvider>
        </I18nProvider>
      </MemoryRouter>
    )

    expect(screen.getByRole('button', { name: 'Plugin tool' })).toBeTruthy()
  })

  it('opens a route in a split from its context menu', () => {
    render(
      <MemoryRouter>
        <I18nProvider configClient={null} initialLocale="en">
          <SidebarProvider>
            <SidebarNavRail currentView="chat" onNavigate={vi.fn()} />
          </SidebarProvider>
        </I18nProvider>
      </MemoryRouter>
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Capabilities' }))
    fireEvent.click(screen.getByText('Open in split'))

    expect(openRouteTile).toHaveBeenCalledWith('/skills', 'right')
  })
})
