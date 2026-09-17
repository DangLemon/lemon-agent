import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProfileRail } from './profile-switcher'

// The rail's discoverability pills are navigation, not identity — assert the
// multi-gateway entry point deep-links to Settings → Connections instead of
// relying on someone finding the pane three levels into Settings (the exact
// gap reported against the multi-connection registry launch).

const navigate = vi.fn()

vi.mock('react-router', () => ({
  useNavigate: () => navigate
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      common: { cancel: 'Cancel' },
      profiles: {
        actions: 'Profile actions',
        allProfiles: 'All profiles',
        autoColor: 'Automatic color',
        color: 'Color',
        colorFor: 'Color for profile',
        connectGateway: 'Manage gateways…',
        failedLoadSoul: 'Failed to load SOUL.md',
        failedSaveSoul: 'Failed to save SOUL.md',
        editSoul: 'Edit SOUL.md',
        exportMenu: 'Export profile…',
        importProfile: 'Import profile…',
        manageProfiles: 'Manage profiles…',
        newProfile: 'New profile',
        remoteOverride: {
          badge: (host: string) => `Runs on ${host}`,
          menuItem: 'Connect to a remote host…'
        },
        renameMenu: 'Rename profile…',
        saveSoul: 'Save',
        saving: 'Saving…',
        setColor: 'Set color',
        showAllProfiles: 'Show all profiles',
        soulSaved: 'SOUL.md saved',
        switchToProfile: (name: string) => `Switch to ${name}`,
        title: 'Profiles'
      }
    }
  })
}))

vi.mock('@/store/profile', () => ({
  $activeGatewayProfile: atom('default'),
  $profileColors: atom({}),
  $profileCreateRequest: atom(0),
  $profileOrder: atom([]),
  $profiles: atom([{ is_default: true, name: 'default' }]),
  $profileScope: atom('default'),
  ALL_PROFILES: '*',
  normalizeProfileKey: (name: string) => name,
  profileLabel: (profile: { display_name?: string; name: string }) =>
    (profile.display_name ?? '').trim() || profile.name,
  refreshActiveProfile: vi.fn().mockResolvedValue(undefined),
  selectProfile: vi.fn(),
  setProfileColor: vi.fn(),
  setProfileOrder: vi.fn(),
  setShowAllProfiles: vi.fn(),
  sortByProfileOrder: (profiles: unknown[]) => profiles
}))

vi.mock('@/store/connections', () => ({
  $activeConnectionId: atom(null),
  $connectionsRegistry: atom(null),
  $hasMultipleConnections: atom(false),
  selectConnection: vi.fn()
}))

vi.mock('@/store/profile-share', () => ({
  runExportProfileFlow: vi.fn(),
  runImportProfileFlow: vi.fn()
}))

vi.mock('@/store/profile-remote-override', () => ({
  $profileRemoteOverrides: atom({}),
  $remoteOverrideDialogProfile: atom(null),
  closeRemoteOverrideDialog: vi.fn(),
  openRemoteOverrideDialog: vi.fn(),
  refreshProfileRemoteOverrides: vi.fn(),
  remoteHostLabel: (url: string) => url
}))

vi.mock('./use-profile-prewarm', () => ({
  useProfilePrewarm: () => ({ cancelPrewarm: vi.fn(), startPrewarm: vi.fn() })
}))

vi.mock('@/lemon', () => ({
  getProfileSoul: vi.fn().mockResolvedValue({ content: '' }),
  updateProfileSoul: vi.fn()
}))

vi.mock('@/components/chat/code-editor', () => ({ CodeEditor: () => null }))
vi.mock('../../profiles/create-profile-dialog', () => ({ CreateProfileDialog: () => null }))
vi.mock('../../profiles/delete-profile-dialog', () => ({ DeleteProfileDialog: () => null }))
vi.mock('../../profiles/rename-profile-dialog', () => ({ RenameProfileDialog: () => null }))

const { $hasMultipleConnections } = await import('@/store/connections')
const hasMultipleConnections = $hasMultipleConnections as ReturnType<typeof atom<boolean>>

const { setInternalCompanyCapabilitiesForTest, resetInternalCompanyCapabilitiesForTest } =
  await import('@/app/internal-company/store')

const { initialInternalCompanyCapabilities } = await import('@/app/internal-company/capabilities')
const { $profiles, selectProfile, setProfileColor, setProfileOrder } = await import('@/store/profile')
const { openRemoteOverrideDialog } = await import('@/store/profile-remote-override')
const { runExportProfileFlow, runImportProfileFlow } = await import('@/store/profile-share')
const profiles = $profiles as ReturnType<typeof atom<Array<{ is_default: boolean; name: string }>>>

afterEach(() => {
  cleanup()
  hasMultipleConnections.set(false)
  profiles.set([{ is_default: true, name: 'default' }])
  resetInternalCompanyCapabilitiesForTest()
})

describe('ProfileRail multi-gateway entry point', () => {
  it('deep-links to the unified Settings → Gateways page from the rail', () => {
    render(<ProfileRail />)

    const pill = screen.getByRole('button', { name: 'Manage gateways…' })
    fireEvent.click(pill)

    expect(navigate).toHaveBeenCalledWith('/settings?tab=gateway')
  })

  it('keeps the entry point visible for single-profile users', () => {
    render(<ProfileRail />)

    // The whole point is first-run discoverability: the pill must not be
    // gated behind multiProfile the way the default↔all toggle is.
    expect(screen.getByRole('button', { name: 'Manage gateways…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Manage profiles…' })).toBeTruthy()
  })

  it('keeps the active profile explicit when gateway identity moves to the statusbar', () => {
    hasMultipleConnections.set(true)
    render(<ProfileRail />)

    expect(screen.getByRole('button', { name: 'default' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Manage gateways…' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Manage profiles…' })).toBeTruthy()
  })

  it('keeps thirteen profiles direct and condenses the fourteenth', () => {
    profiles.set([
      { is_default: true, name: 'default' },
      ...Array.from({ length: 12 }, (_, index) => ({ is_default: false, name: `Profile ${index + 1}` }))
    ])
    const { unmount } = render(<ProfileRail />)

    expect(screen.queryByRole('button', { name: 'Profiles' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Profile 12' })).toBeTruthy()
    unmount()

    profiles.set([
      { is_default: true, name: 'default' },
      ...Array.from({ length: 13 }, (_, index) => ({ is_default: false, name: `Profile ${index + 1}` }))
    ])
    render(<ProfileRail />)

    expect(screen.getByRole('button', { name: 'Profiles' })).toBeTruthy()
  })

  it('keeps square profile rail read-only in the internal harness', async () => {
    profiles.set([
      { is_default: true, name: 'default' },
      { is_default: false, name: 'Research' }
    ])
    setInternalCompanyCapabilitiesForTest(initialInternalCompanyCapabilities(true))

    render(<ProfileRail />)

    const profile = screen.getByRole('button', { name: 'Research' })
    fireEvent.click(profile)
    fireEvent.pointerDown(profile, { button: 2, ctrlKey: false, pointerType: 'mouse' })
    fireEvent.contextMenu(profile, { button: 2 })

    expect(selectProfile).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Color' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Rename profile…' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Edit SOUL.md' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Export profile…' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Connect to a remote host…' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'New profile' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import profile…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage profiles…' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Manage gateways…' })).toBeNull()
    expect(setProfileColor).not.toHaveBeenCalled()
    expect(setProfileOrder).not.toHaveBeenCalled()
    expect(openRemoteOverrideDialog).not.toHaveBeenCalled()
    expect(runExportProfileFlow).not.toHaveBeenCalled()
    expect(runImportProfileFlow).not.toHaveBeenCalled()
  })

  it('keeps condensed profile controls company-managed in locked-down mode', async () => {
    profiles.set([
      { is_default: true, name: 'default' },
      ...Array.from({ length: 13 }, (_, index) => ({ is_default: false, name: `Profile ${index + 1}` }))
    ])
    setInternalCompanyCapabilitiesForTest(
      initialInternalCompanyCapabilities(true, {
        agents: false,
        cron: true,
        messaging: false,
        terminal: false,
        webhooks: false
      })
    )

    render(<ProfileRail />)

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Profiles' }))

    expect(screen.queryByRole('menuitem', { name: 'New profile' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Import profile…' })).toBeNull()

    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Profile 1' }))

    await waitFor(() => {
      expect(selectProfile).not.toHaveBeenCalled()
      expect(runImportProfileFlow).not.toHaveBeenCalled()
    })
  })

  it('stays shrinkable with many profiles and multiple gateways', () => {
    hasMultipleConnections.set(true)
    profiles.set([
      { is_default: true, name: 'default' },
      ...Array.from({ length: 13 }, (_, index) => ({ is_default: false, name: `Profile ${index + 1}` }))
    ])
    render(<ProfileRail />)

    expect(screen.getByRole('group', { name: 'Profiles' }).className).toContain('min-w-0')
    expect(screen.getByRole('button', { name: 'Profiles' })).toBeTruthy()
  })
})
