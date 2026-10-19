// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { initialInternalCompanyCapabilities } from '@/app/internal-company/capabilities'
import { resetInternalCompanyCapabilitiesForTest, setInternalCompanyCapabilitiesForTest } from '@/app/internal-company/store'
import { $sidebarPreviewSide } from '@/components/pane-shell/tree/store'
import { $panesFlipped, $sidebarOpen, setSidebarOpen } from '@/store/layout'

import { TitlebarControls, type TitlebarTool } from './titlebar-controls'

function renderControls(tools: TitlebarTool[], leftTools: TitlebarTool[] = []) {
  return render(
    <MemoryRouter>
      <TitlebarControls leftTools={leftTools} onOpenSettings={vi.fn()} tools={tools} />
    </MemoryRouter>
  )
}

afterEach(() => {
  cleanup()
  resetInternalCompanyCapabilitiesForTest()
  vi.unstubAllGlobals()
  setSidebarOpen(true)
  $sidebarPreviewSide.set(null)
  $panesFlipped.set(false)
})

describe('TitlebarControls internal harness policy', () => {
  it('hides denied route tools before their action can execute', () => {
    const onSelect = vi.fn()
    setInternalCompanyCapabilitiesForTest(initialInternalCompanyCapabilities(true))

    renderControls([{ icon: <span />, id: 'profiles', label: 'Profiles', onSelect, to: '/profiles' }])

    expect(screen.queryByRole('button', { name: 'Profiles' })).toBeNull()
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes the sidebar instead of leaving a stale hover preview over it', () => {
    renderControls([])
    $sidebarPreviewSide.set('left')

    fireEvent.click(screen.getByRole('button', { name: 'Hide sidebar' }))

    expect($sidebarOpen.get()).toBe(false)
    expect($sidebarPreviewSide.get()).toBeNull()
  })

  it('keeps only sidebar and settings controls in the internal harness titlebar', () => {
    setInternalCompanyCapabilitiesForTest(initialInternalCompanyCapabilities(true))

    renderControls(
      [{ icon: <span />, id: 'pane-devtools', label: 'Devtools' }],
      [{ icon: <span />, id: 'workspace-tool', label: 'Workspace tool' }]
    )

    expect(screen.getByRole('button', { name: 'Hide sidebar' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open settings' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Swap sidebar sides' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'HUD mode' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mute haptics' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show right sidebar' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Workspace tool' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Devtools' })).toBeNull()
  })
})
