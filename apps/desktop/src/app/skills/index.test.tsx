// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type * as ReactRouterDom from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { initialInternalCompanyCapabilities } from '@/app/internal-company/capabilities'
import {
  resetInternalCompanyCapabilitiesForTest,
  setInternalCompanyCapabilitiesForTest
} from '@/app/internal-company/store'
import type * as LemonApi from '@/lemon'
import { queryClient } from '@/lib/query-client'
import type * as SlashCompletionCache from '@/lib/slash-completion-cache'
import type * as HubActions from '@/store/hub-actions'
import type * as NotificationsStore from '@/store/notifications'

const getSkills = vi.fn()
const getToolsets = vi.fn()
const setSkillEnabled = vi.fn()
const setToolsetEnabled = vi.fn()
const getToolsetConfig = vi.fn()
const selectToolsetProvider = vi.fn()
const getUsageAnalytics = vi.fn()
const getProfiles = vi.fn()
const getSkillContent = vi.fn()
const getOfficialSkills = vi.fn()
const createSkill = vi.fn()

const slashMocks = vi.hoisted(() => ({
  invalidateSlashCompletions: vi.fn()
}))

const notificationMocks = vi.hoisted(() => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

// Partial mock: keep the real module (SkillsView pulls in @/store/profile,
// whose import-time subscription calls setApiRequestProfile) and stub only the
// calls we assert on. Args are forwarded so the per-profile scope arg is
// observable.
vi.mock('@/lemon', async importOriginal => ({
  ...(await importOriginal<typeof LemonApi>()),
  getSkills: (profile?: null | string) => getSkills(profile),
  getToolsets: (profile?: null | string) => getToolsets(profile),
  setSkillEnabled: (name: string, enabled: boolean, profile?: null | string) => setSkillEnabled(name, enabled, profile),
  setToolsetEnabled: (name: string, enabled: boolean, profile?: null | string) =>
    setToolsetEnabled(name, enabled, profile),
  getToolsetConfig: (name: string, profile?: null | string) => getToolsetConfig(name, profile),
  selectToolsetProvider: (toolset: string, provider: string) => selectToolsetProvider(toolset, provider),
  getUsageAnalytics: (days: number, profile?: null | string) => getUsageAnalytics(days, profile),
  getProfiles: () => getProfiles(),
  getSkillContent: (name: string, profile?: null | string) => getSkillContent(name, profile),
  getOfficialSkills: (profile?: null | string) => getOfficialSkills(profile),
  createSkill: (name: string, content: string, category?: null | string, profile?: LemonApi.ProfileScope) =>
    createSkill(name, content, category, profile)
}))

vi.mock('@/lib/slash-completion-cache', async importOriginal => ({
  ...(await importOriginal<typeof SlashCompletionCache>()),
  invalidateSlashCompletions: () => slashMocks.invalidateSlashCompletions()
}))

// Notifications hit nanostores/timers we don't care about here.
vi.mock('@/store/notifications', async importOriginal => ({
  ...(await importOriginal<typeof NotificationsStore>()),
  notify: notificationMocks.notify,
  notifyError: notificationMocks.notifyError
}))

// The catalog Install button routes through the hub action pipeline — stub the
// action entrypoint (real module kept: SkillsView reads $hubActions and the
// query keys from it).
vi.mock('@/store/hub-actions', async importOriginal => ({
  ...(await importOriginal<typeof HubActions>()),
  installHubSkill: vi.fn().mockResolvedValue(undefined)
}))

// The vision detail navigates to Settings → Models via useNavigate; spy on it
// so the deep-link target is assertable.
const navigateSpy = vi.fn()

vi.mock('react-router', async importOriginal => ({
  ...(await importOriginal<typeof ReactRouterDom>()),
  useNavigate: () => navigateSpy
}))

function toolset(overrides: Record<string, unknown> = {}) {
  return {
    name: 'web',
    label: 'Web Search',
    description: 'web_search, web_extract',
    enabled: true,
    available: true,
    configured: true,
    tools: ['web_search', 'web_extract'],
    ...overrides
  }
}

async function renderSkills() {
  const { SkillsView } = await import('./index')
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(
      // SkillsView reads skills/toolsets via useQuery, so it needs a provider.
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/skills?tab=toolsets']}>
          <SkillsView />
        </MemoryRouter>
      </QueryClientProvider>
    )
  })

  return result!
}

beforeEach(() => {
  getSkills.mockResolvedValue([])
  getToolsets.mockResolvedValue([toolset()])
  setToolsetEnabled.mockResolvedValue({ ok: true, name: 'web', enabled: false })
  getToolsetConfig.mockResolvedValue({ has_category: true, active_provider: null, providers: [] })
  getUsageAnalytics.mockResolvedValue({ tools: [] })
  getOfficialSkills.mockResolvedValue({ skills: [] })
  createSkill.mockResolvedValue({ success: true, name: 'daily-review' })
  slashMocks.invalidateSlashCompletions.mockClear()
  notificationMocks.notify.mockClear()
  notificationMocks.notifyError.mockClear()
  getSkillContent.mockResolvedValue({
    name: 'web-research',
    path: '/skills/web-research/SKILL.md',
    content: '---\nname: web-research\nversion: 1.2.0\nauthor: Nous\n---\n\n# Web Research\n\nDeep research steps.'
  })
  // Single profile by default → the scope selector stays hidden (>1 gate),
  // so existing tests see unchanged single-profile behavior.
  getProfiles.mockResolvedValue({ profiles: [{ name: 'default', is_default: true }] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // Shared singleton client — drop cached skills/toolsets so each test refetches.
  queryClient.clear()
  resetInternalCompanyCapabilitiesForTest()
})

// SkillsView is a heavy module: the first test pays the whole dynamic-import
// cost, and the file legitimately runs ~14s on CI runners — right against the
// global 15s per-test budget, so slow runners cascade-fail all 11 tests
// (2× in a row on PR #93612, plus a main run the same hour). Give this file
// headroom; the tests are not slow individually.
describe('SkillsView toolset management', { timeout: 60_000 }, () => {
  it('hides toolset and Hub install surfaces in the internal harness while preserving personal Skills', async () => {
    setInternalCompanyCapabilitiesForTest(initialInternalCompanyCapabilities(true))
    getSkills.mockResolvedValue([
      {
        name: 'daily-review',
        description: 'Daily review',
        category: 'general',
        enabled: true,
        usage: 0,
        provenance: 'agent'
      }
    ])
    getOfficialSkills.mockResolvedValue({
      skills: [
        {
          category: 'general',
          description: 'Official',
          identifier: 'official/general/web',
          installed: false,
          name: 'web',
          tags: []
        }
      ]
    })

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=toolsets']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await screen.findByRole('button', { name: 'Create skill' })
    expect(screen.queryByRole('button', { name: 'New skill' })).toBeNull()

    expect(screen.queryByRole('button', { name: /Tools/ })).toBeNull()
    expect(screen.queryByText('Official')).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
    expect(getOfficialSkills).not.toHaveBeenCalled()
  })

  it('renders a switch for each toolset and toggles it off', async () => {
    await renderSkills()

    // The switch names the action, so an enabled toolset offers to turn it off.
    const sw = await screen.findByRole('switch', { name: 'Turn Web Search toolset off' })
    expect(sw.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      fireEvent.click(sw)
    })

    await waitFor(() => expect(setToolsetEnabled).toHaveBeenCalled())
    expect(setToolsetEnabled.mock.calls[0].slice(0, 2)).toEqual(['web', false])
  })

  it('renders toolset titles without leading emoji', async () => {
    getToolsets.mockResolvedValue([toolset({ name: 'cronjob', label: '⏰ Cron Jobs', description: 'cron tools' })])

    await renderSkills()

    // The label renders in both the row and the auto-selected detail header, so
    // assert via the switch's (emoji-stripped) accessible name and the absence
    // of the emoji rather than a single-match text lookup.
    await screen.findByRole('switch', { name: 'Turn Cron Jobs toolset off' })
    expect(screen.queryByText(/⏰/)).toBeNull()
  })

  it('renders the provider config panel inline for the selected toolset', async () => {
    // The master-detail UI dropped the resting "Configured" pill and the
    // "Configure" expander: the detail column auto-selects the first toolset
    // and renders its config panel directly, which fetches on mount.
    await renderSkills()

    await screen.findByRole('switch', { name: 'Turn Web Search toolset off' })
    await waitFor(() => expect(getToolsetConfig).toHaveBeenCalled())
    expect(getToolsetConfig.mock.calls[0][0]).toBe('web')
  })

  it('scopes Tools config to the profile chosen in the selector', async () => {
    // Two profiles → the "Configuring:" selector renders. Picking a non-active
    // profile must re-fetch toolsets scoped to THAT profile.
    // jsdom's scrollIntoView is missing/non-functional; Radix Select calls it
    // on open. Force a stub so the dropdown can render in the test env.
    Element.prototype.scrollIntoView = vi.fn()
    getProfiles.mockResolvedValue({
      profiles: [
        { name: 'default', is_default: true },
        { name: 'researcher', is_default: false }
      ]
    })

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=toolsets']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    // The selector appears with >1 profile.
    const trigger = await screen.findByRole('combobox')
    await act(async () => {
      fireEvent.click(trigger)
    })
    const option = await screen.findByRole('option', { name: 'researcher' })
    await act(async () => {
      fireEvent.click(option)
    })

    // Toolsets refetch scoped to the picked profile.
    await waitFor(() => expect(getToolsets).toHaveBeenCalledWith('researcher'))
  })

  it('scopes the Skills tab (and skill toggles) to the profile chosen in the selector', async () => {
    // The selector is Capabilities-WIDE: picking a profile on the Skills tab
    // must refetch the skill list scoped to it, and route toggles there too.
    Element.prototype.scrollIntoView = vi.fn()
    getProfiles.mockResolvedValue({
      profiles: [
        { name: 'default', is_default: true },
        { name: 'researcher', is_default: false }
      ]
    })
    getSkills.mockResolvedValue([
      {
        name: 'web-research',
        description: 'Research the web',
        category: 'research',
        enabled: true,
        usage: 3,
        provenance: 'bundled'
      }
    ])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    // The selector renders on the Skills tab too (Capabilities-wide).
    const trigger = await screen.findByRole('combobox')
    await act(async () => {
      fireEvent.click(trigger)
    })
    const option = await screen.findByRole('option', { name: 'researcher' })
    await act(async () => {
      fireEvent.click(option)
    })

    // Skills refetch scoped to the picked profile...
    await waitFor(() => expect(getSkills).toHaveBeenCalledWith('researcher'))

    // ...and a toggle routes its write to that profile as well.
    const sw = await screen.findByRole('switch', { name: 'web-research' })
    await act(async () => {
      fireEvent.click(sw)
    })
    await waitFor(() => expect(setSkillEnabled).toHaveBeenCalledWith('web-research', false, 'researcher'))
  })

  it('keeps ordinary Lemon AI Skills presentation technical and ungated by Lemon copy', async () => {
    getSkills.mockResolvedValue([
      {
        name: 'web-research',
        description: 'Research the web',
        category: 'research',
        enabled: true,
        usage: 3,
        provenance: 'bundled'
      }
    ])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await waitFor(() => expect(getSkillContent).toHaveBeenCalled())
    expect(getSkillContent.mock.calls[0][0]).toBe('web-research')
    expect(screen.getByLabelText('Search skills...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Tools/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New skill' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Create skill' })).toBeNull()
    expect(screen.getByRole('button', { name: /web-research/ })).toBeTruthy()
    expect(screen.queryByText('Technical details')).toBeNull()
    expect(await screen.findByText('version')).toBeTruthy()
    expect(await screen.findByText('1.2.0')).toBeTruthy()
    expect(await screen.findByText(/Deep research steps/)).toBeTruthy()
  })

  it('keeps the internal Skills detail flat and leaves the search placeholder fixed', async () => {
    setInternalCompanyCapabilitiesForTest(initialInternalCompanyCapabilities(true))
    getSkills.mockResolvedValue([
      {
        name: 'web-research',
        description: 'Research the web',
        category: 'research',
        enabled: true,
        usage: 3,
        provenance: 'agent'
      }
    ])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    const search = await screen.findByLabelText('Search skills…')
    expect(search.getAttribute('placeholder')).toBe('Search skills…')
    await waitFor(() => expect(screen.getAllByText('Research the web')).toHaveLength(1))
    expect(screen.getByText('Enabled')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create skill' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New skill' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })
    expect(screen.getByText('Create skill/SKILL.md')).toBeTruthy()
  })

  it('hub picker refuses to reinstall an already-installed skill', async () => {
    const { notify } = await import('@/store/notifications')
    const { EmbeddedHubPicker } = await import('./embedded-hub-picker')

    render(<EmbeddedHubPicker installedNames={new Set(['web-research'])} profile={null} />)

    // The picker is expanded by default — the hub iframe is live on mount.
    expect(document.querySelector('iframe')).toBeTruthy()

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'lemon-skill-pick', name: 'web-research', identifier: 'web-research' },
          origin: 'https://github.com/DangLemon/lemon-agent'
        })
      )
    })

    // Refused with an informational toast, no install action spawned.
    await waitFor(() =>
      expect(vi.mocked(notify)).toHaveBeenCalledWith(
        expect.objectContaining({ title: '"web-research" is already installed' })
      )
    )
  })

  it('mounts the hub iframe lazily and keeps it (hidden) across tab switches', async () => {
    // On a non-Skills tab the docs-site iframe must not exist at all — an
    // eagerly mounted hub is exactly the Capabilities lag bug.
    await renderSkills() // ?tab=toolsets
    await screen.findByRole('switch', { name: 'Turn Web Search toolset off' })
    expect(document.querySelector('iframe')).toBeNull()
    cleanup()

    // Embedded mode drives tabs through local state (the route hooks are
    // mocked here), starting on Skills: the picker mounts with the tab.
    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills']}>
            <SkillsView embedded />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    const iframe = document.querySelector('iframe')
    expect(iframe).toBeTruthy()
    expect(iframe!.closest('section')!.classList.contains('hidden')).toBe(false)

    // Switch to Tools → the iframe STAYS mounted (no docs-site reload on the
    // next visit) but its section is fully hidden, so nothing from the hub
    // can paint over the toolsets UI.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Tools/ }))
    })
    const kept = document.querySelector('iframe')
    expect(kept).toBeTruthy()
    expect(kept!.closest('section')!.classList.contains('hidden')).toBe(true)
  })

  it('shows a vision explainer that deep-links to Settings → Models', async () => {
    // Vision has no TOOL_CATEGORIES provider matrix — its model lives in the
    // auxiliary model config, so the detail pane must point there instead of
    // rendering an empty panel.
    getToolsets.mockResolvedValue([
      toolset({
        name: 'vision',
        label: 'Vision / Image Analysis',
        description: 'vision_analyze',
        tools: ['vision_analyze']
      })
    ])
    getToolsetConfig.mockResolvedValue({ has_category: false, active_provider: null, providers: [] })

    await renderSkills()

    expect(await screen.findByText(/auxiliary model configuration/)).toBeTruthy()
    const link = screen.getByRole('button', { name: /Choose vision model in Settings/ })

    await act(async () => {
      fireEvent.click(link)
    })

    // Internal route change into the Models section with the aux slot target —
    // consumed by ModelSettings' deep-link highlight. Never an external URL.
    await waitFor(() => expect(navigateSpy).toHaveBeenCalledWith('/settings?tab=config:model&aux=vision'))
  })

  it('fixedConnection pins every read to the target connection', async () => {
    // Bot Mode's remote-target door: a bot on another registered gateway gets
    // the live surface pointed at ITS backend — the reads must carry the
    // (connection, profile) pin, not a bare profile name that would resolve
    // against the ACTIVE gateway (the wrong-machine bug).
    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills']}>
            <SkillsView embedded fixedConnection="homelab" fixedProfile="inbox-bot" />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await waitFor(() => expect(getSkills).toHaveBeenCalled())
    expect(getSkills.mock.calls[0][0]).toEqual({ connectionId: 'homelab', profile: 'inbox-bot' })
    expect(getToolsets.mock.calls[0][0]).toEqual({ connectionId: 'homelab', profile: 'inbox-bot' })
    // Pinned scope → no roster/profiles fetch, selector hidden.
    expect(getProfiles).not.toHaveBeenCalled()
  })

  it('offers (connection, profile) scope rows on multi-connection desktops', async () => {
    // With a v2 registry holding >1 connection, the scope selector lists the
    // union agent roster — profile + owning device — instead of the local
    // profiles list, so a selection identifies WHICH gateway's capabilities
    // are being configured.
    const connections = {
      list: vi.fn().mockResolvedValue({
        version: 2,
        primary: 'local',
        secureTokenStorage: true,
        connections: [
          { id: 'local', kind: 'local', label: 'This device', tokenSet: false, tokenPreview: null },
          { id: 'homelab', kind: 'remote', label: 'Homelab', tokenSet: true, tokenPreview: '…' }
        ]
      })
    }

    const getAgentRoster = vi.fn().mockResolvedValue({
      agents: [
        {
          connectionId: 'local',
          connectionKind: 'local',
          connectionLabel: 'This device',
          profile: 'default',
          handle: 'default'
        },
        {
          connectionId: 'homelab',
          connectionKind: 'remote',
          connectionLabel: 'Homelab',
          profile: 'inbox-bot',
          handle: 'inbox-bot-homelab'
        }
      ],
      sources: []
    })

    ;(window as { lemonDesktop?: unknown }).lemonDesktop = { connections, getAgentRoster }

    try {
      await renderSkills()

      await waitFor(() => expect(getAgentRoster).toHaveBeenCalled())
      // The selector paints roster rows labeled profile — device.
      expect(await screen.findByText('default — This device (current)')).toBeTruthy()
    } finally {
      delete (window as { lemonDesktop?: unknown }).lemonDesktop
    }
  })

  it('lists the built-in optional-skills catalog with Install buttons that route through the hub pipeline', async () => {
    // The full official catalog renders BELOW the installed list; each row
    // carries an Install button (no toggle until installed) that routes
    // through the standard hub action pipeline scoped to the Capabilities
    // profile. Already-installed catalog entries are filtered out.
    const { installHubSkill } = await import('@/store/hub-actions')

    getSkills.mockResolvedValue([
      {
        name: 'web-research',
        description: 'Research the web',
        category: 'research',
        enabled: true,
        usage: 3,
        provenance: 'bundled'
      }
    ])
    getOfficialSkills.mockResolvedValue({
      skills: [
        {
          name: 'gif-search',
          description: 'Search GIFs',
          identifier: 'official/gifs/gif-search',
          category: 'gifs',
          installed: false,
          tags: ['gifs']
        },
        {
          name: 'web-research',
          description: 'already here under a different source',
          identifier: 'official/research/web-research',
          category: 'research',
          installed: false,
          tags: []
        },
        {
          name: 'ascii-art',
          description: 'ASCII art',
          identifier: 'official/creative/ascii-art',
          category: 'creative',
          installed: true,
          tags: []
        }
      ]
    })

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    // Catalog section header + the one genuinely-available row. Rows already
    // installed (lock flag OR name collision with the installed list) are gone.
    expect(await screen.findByText('Available to install')).toBeTruthy()
    expect(await screen.findByText('gif-search')).toBeTruthy()
    expect(screen.queryByText('ascii-art')).toBeNull()

    // The installed skill still shows its toggle; the catalog row shows
    // Install instead of a switch.
    expect(screen.getByRole('switch', { name: 'web-research' })).toBeTruthy()
    const install = screen.getByRole('button', { name: 'Install' })

    await act(async () => {
      fireEvent.click(install)
    })

    await waitFor(() =>
      expect(vi.mocked(installHubSkill)).toHaveBeenCalledWith('official/gifs/gif-search', expect.anything())
    )
  })

  it('creates a scoped personal skill with complete SKILL.md content', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    getProfiles.mockResolvedValue({
      profiles: [
        { name: 'default', is_default: true },
        { name: 'researcher', is_default: false }
      ]
    })
    let created = false
    getSkills.mockImplementation((profile?: null | string) =>
      Promise.resolve(
        created && profile === 'researcher'
          ? [
              {
                name: 'daily-review',
                description: 'Summarize the day',
                category: 'planning',
                enabled: true,
                usage: 0,
                provenance: 'agent'
              }
            ]
          : []
      )
    )
    createSkill.mockImplementation(async () => {
      created = true

      return { name: 'daily-review', success: true }
    })

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    const trigger = await screen.findByRole('combobox')
    await act(async () => {
      fireEvent.click(trigger)
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'researcher' }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New skill' }))
    })
    expect(screen.getByText('New skill/SKILL.md')).toBeTruthy()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'daily-review' } })
      fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'planning' } })
      fireEvent.change(screen.getByLabelText('SKILL.md'), {
        target: {
          value: '---\nname: daily-review\ndescription: Summarize the day\n---\n\n# Daily Review\n\nSummarize the day.'
        }
      })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    await waitFor(() => expect(createSkill).toHaveBeenCalled())
    expect(createSkill).toHaveBeenCalledWith(
      'daily-review',
      '---\nname: daily-review\ndescription: Summarize the day\n---\n\n# Daily Review\n\nSummarize the day.',
      'planning',
      'researcher'
    )
    await waitFor(() => expect(screen.getAllByText('daily-review').length).toBeGreaterThanOrEqual(1))
    expect(screen.queryByLabelText('SKILL.md')).toBeNull()
    expect(slashMocks.invalidateSlashCompletions).toHaveBeenCalled()
    expect(notificationMocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Use /daily-review in a new session.',
        title: 'Skill created'
      })
    )
  })

  it('keeps the create draft on validation and API errors without adding an optimistic row', async () => {
    createSkill.mockRejectedValueOnce(new Error('name already exists'))
    getSkills.mockResolvedValue([])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })
    expect(await screen.findByText('Skill name is required.')).toBeTruthy()
    expect(createSkill).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'daily-review' } })
      fireEvent.change(screen.getByLabelText('SKILL.md'), {
        target: {
          value: '---\nname: daily-review\ndescription: Summarize the day\n---\n\n# Daily Review'
        }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    await waitFor(() => expect(createSkill).toHaveBeenCalled())
    expect((screen.getByLabelText('Skill name') as HTMLInputElement).value).toBe('daily-review')
    expect((screen.getByLabelText('SKILL.md') as HTMLTextAreaElement).value).toBe(
      '---\nname: daily-review\ndescription: Summarize the day\n---\n\n# Daily Review'
    )
    expect(screen.queryByText('daily-review')).toBeNull()
  })

  it('closes create editor on scope changes and ignores stale create responses', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    getProfiles.mockResolvedValue({
      profiles: [
        { name: 'default', is_default: true },
        { name: 'researcher', is_default: false }
      ]
    })
    let resolveCreate: (value: unknown) => void = () => undefined
    createSkill.mockReturnValue(new Promise(resolve => void (resolveCreate = resolve)))
    getSkills.mockResolvedValue([])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })
    await screen.findByLabelText('Skill name')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'daily-review' } })
      fireEvent.change(screen.getByLabelText('SKILL.md'), {
        target: {
          value: '---\nname: daily-review\ndescription: Summarize the day\n---\n\n# Daily Review'
        }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    const trigger = await screen.findByRole('combobox')
    await act(async () => {
      fireEvent.click(trigger)
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'researcher' }))
    })

    expect(screen.queryByLabelText('SKILL.md')).toBeNull()

    await act(async () => {
      resolveCreate({ success: true, name: 'daily-review' })
    })

    expect(screen.queryByText('daily-review')).toBeNull()
    expect(screen.queryByText('Use /daily-review in a new session.')).toBeNull()
  })

  it('keeps generated SKILL.md frontmatter synchronized with the full typed name until content is edited', async () => {
    getSkills.mockResolvedValue([])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })

    const input = await screen.findByLabelText('Skill name')

    for (let i = 1; i <= 'daily-review'.length; i += 1) {
      await act(async () => {
        fireEvent.change(input, { target: { value: 'daily-review'.slice(0, i) } })
      })
    }

    expect((screen.getByLabelText('SKILL.md') as HTMLTextAreaElement).value).toContain('name: daily-review')

    await act(async () => {
      fireEvent.change(screen.getByLabelText('SKILL.md'), {
        target: { value: '---\nname: manual-name\n---\n\n# Manual body' }
      })
      fireEvent.change(input, { target: { value: 'weekly-review' } })
    })

    expect((screen.getByLabelText('SKILL.md') as HTMLTextAreaElement).value).toBe(
      '---\nname: manual-name\n---\n\n# Manual body'
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    await waitFor(() => expect(createSkill).toHaveBeenCalled())
    expect(createSkill.mock.calls[0]?.[0]).toBe('weekly-review')
    expect(createSkill.mock.calls[0]?.[1]).toBe('---\nname: manual-name\n---\n\n# Manual body')
  })

  it('does not let an in-flight create mutate UI or notify after the create pane is closed', async () => {
    let resolveCreate: (value: unknown) => void = () => undefined
    createSkill.mockReturnValue(
      new Promise(resolve => {
        resolveCreate = value => {
          created = true
          resolve(value)
        }
      })
    )
    let created = false
    getSkills.mockImplementation(() =>
      Promise.resolve(
        created
          ? [{ name: 'daily-review', description: 'Summarize the day', enabled: true, usage: 0, provenance: 'agent' }]
          : []
      )
    )

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })
    await screen.findByLabelText('Skill name')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'daily-review' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    })

    await act(async () => {
      resolveCreate({ success: true })
    })

    expect(notificationMocks.notify).not.toHaveBeenCalled()
    expect(screen.queryByText('daily-review')).toBeNull()
  })

  it('does not notify or mutate UI when an in-flight create resolves after unmount', async () => {
    let resolveCreate: (value: unknown) => void = () => undefined
    createSkill.mockReturnValue(new Promise(resolve => void (resolveCreate = resolve)))
    getSkills.mockResolvedValue([
      { name: 'daily-review', description: 'Summarize the day', enabled: true, usage: 0, provenance: 'agent' }
    ])

    const { SkillsView } = await import('./index')
    let rendered: ReturnType<typeof render>
    await act(async () => {
      rendered = render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })
    await screen.findByLabelText('Skill name')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'daily-review' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })
    await act(async () => {
      rendered.unmount()
    })

    await act(async () => {
      resolveCreate({ success: true })
    })

    expect(notificationMocks.notify).not.toHaveBeenCalled()
  })

  it('closes and invalidates create work when leaving the Skills tab for Tools or MCP', async () => {
    getSkills.mockResolvedValue([])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })
    expect(await screen.findByLabelText('SKILL.md')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Tools/ }))
    })
    expect(screen.queryByLabelText('SKILL.md')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: /Skills/ })[0])
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'New skill' }))
    })
    expect(await screen.findByLabelText('SKILL.md')).toBeTruthy()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'MCP' }))
    })
    expect(screen.queryByLabelText('SKILL.md')).toBeNull()
  })

  it('does not revive a stale create response after scope changes from A to B and back to A', async () => {
    Element.prototype.scrollIntoView = vi.fn()
    getProfiles.mockResolvedValue({
      profiles: [
        { name: 'default', is_default: true },
        { name: 'researcher', is_default: false }
      ]
    })
    let resolveCreate: (value: unknown) => void = () => undefined
    createSkill.mockReturnValue(new Promise(resolve => void (resolveCreate = resolve)))
    getSkills.mockResolvedValue([])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })
    await screen.findByLabelText('Skill name')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'daily-review' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    const trigger = await screen.findByRole('combobox')
    await act(async () => {
      fireEvent.click(trigger)
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'researcher' }))
    })
    const triggerAgain = await screen.findByRole('combobox')
    await act(async () => {
      fireEvent.click(triggerAgain)
    })
    await act(async () => {
      fireEvent.click(await screen.findByRole('option', { name: 'Lemon AI (default)' }))
    })

    await act(async () => {
      resolveCreate({ success: true, name: 'daily-review' })
    })

    expect(screen.queryByText('daily-review')).toBeNull()
    expect(notificationMocks.notify).not.toHaveBeenCalled()
  })

  it('renders FastAPI create validation detail cleanly and preserves the draft', async () => {
    createSkill.mockRejectedValueOnce(new Error('400: {"detail":"A skill named daily-review already exists."}'))
    getSkills.mockResolvedValue([])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })
    await screen.findByLabelText('Skill name')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'daily-review' } })
      fireEvent.change(screen.getByLabelText('SKILL.md'), {
        target: { value: '---\nname: daily-review\n---\n\n# Daily Review' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    expect(await screen.findByText('A skill named daily-review already exists.')).toBeTruthy()
    expect(screen.queryByText(/400:/)).toBeNull()
    expect((screen.getByLabelText('Skill name') as HTMLInputElement).value).toBe('daily-review')
    expect((screen.getByLabelText('SKILL.md') as HTMLTextAreaElement).value).toBe(
      '---\nname: daily-review\n---\n\n# Daily Review'
    )
  })

  it('reports backend create success without claiming availability when discovery does not return the created skill', async () => {
    createSkill.mockResolvedValueOnce({ success: true })
    getSkills.mockResolvedValue([])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })
    await screen.findByLabelText('Skill name')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'daily-review' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    await waitFor(() => expect(createSkill).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByLabelText('SKILL.md')).toBeNull())
    expect(notificationMocks.notifyError).not.toHaveBeenCalled()
    expect(screen.queryByText('daily-review')).toBeNull()
    expect(notificationMocks.notify).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Use /daily-review in a new session.' })
    )
    expect(notificationMocks.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'success',
        message: 'Skill saved, but discovery did not return it yet. Refresh Skills before using it in a new session.',
        title: 'Skill created'
      })
    )
  })

  it('announces create validation and API errors with a stable alert and field associations', async () => {
    createSkill.mockRejectedValueOnce(new Error('400: {"detail":"A skill named daily-review already exists."}'))
    getSkills.mockResolvedValue([])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })

    const nameInput = (await screen.findByLabelText('Skill name')) as HTMLInputElement
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    const validationAlert = await screen.findByRole('alert')
    const validationAlertId = validationAlert.getAttribute('id')
    expect(validationAlert.textContent).toBe('Skill name is required.')
    expect(validationAlertId).toBeTruthy()
    expect(nameInput.getAttribute('aria-invalid')).toBe('true')
    expect(nameInput.getAttribute('aria-describedby')).toContain(validationAlertId)

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'daily-review' } })
      fireEvent.change(screen.getByLabelText('SKILL.md'), {
        target: { value: '---\nname: daily-review\n---\n\n# Daily Review' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    const apiAlert = await screen.findByRole('alert')
    expect(apiAlert.getAttribute('id')).toBe(validationAlertId)
    expect(apiAlert.textContent).toBe('A skill named daily-review already exists.')
    expect(nameInput.getAttribute('aria-invalid')).toBe('true')
    expect(nameInput.getAttribute('aria-describedby')).toContain(validationAlertId)
  })

  it('uses semantic form submit from text inputs without submitting on textarea Enter', async () => {
    getSkills.mockResolvedValue([])

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'New skill' }))
    })

    const nameInput = (await screen.findByLabelText('Skill name')) as HTMLInputElement
    const categoryInput = screen.getByLabelText('Category') as HTMLInputElement
    const textarea = screen.getByLabelText('SKILL.md') as HTMLTextAreaElement
    const createButton = screen.getByRole('button', { name: 'Create skill' }) as HTMLButtonElement
    const form = nameInput.form

    expect(form).toBeTruthy()
    expect(categoryInput.form).toBe(form)
    expect(textarea.form).toBe(form)
    expect(createButton.type).toBe('submit')

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'daily-review' } })
      fireEvent.change(textarea, { target: { value: '---\nname: daily-review\n---\n\n# Daily Review' } })
      fireEvent.keyDown(textarea, { key: 'Enter' })
    })
    expect(createSkill).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.submit(form!)
    })
    await waitFor(() => expect(createSkill).toHaveBeenCalled())
  })

  it('restores focus to Create skill after user close, cancel, and confirmed create on the active Skills tab', async () => {
    let created = false
    getSkills.mockImplementation(() =>
      Promise.resolve(
        created
          ? [{ name: 'daily-review', description: 'Summarize the day', enabled: true, usage: 0, provenance: 'agent' }]
          : []
      )
    )
    createSkill.mockImplementation(async () => {
      created = true

      return { success: true, name: 'daily-review' }
    })

    const { SkillsView } = await import('./index')
    await act(async () => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/skills?tab=skills']}>
            <SkillsView />
          </MemoryRouter>
        </QueryClientProvider>
      )
    })

    const trigger = await screen.findByRole('button', { name: 'New skill' })
    await act(async () => {
      fireEvent.click(trigger)
    })
    await screen.findByLabelText('Skill name')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    })
    expect(trigger.ownerDocument.activeElement).toBe(await screen.findByRole('button', { name: 'New skill' }))

    const cancelTrigger = await screen.findByRole('button', { name: 'New skill' })
    await act(async () => {
      fireEvent.click(cancelTrigger)
    })
    await screen.findByLabelText('Skill name')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    expect(cancelTrigger.ownerDocument.activeElement).toBe(await screen.findByRole('button', { name: 'New skill' }))

    const createTrigger = await screen.findByRole('button', { name: 'New skill' })
    await act(async () => {
      fireEvent.click(createTrigger)
    })
    await screen.findByLabelText('Skill name')
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'daily-review' } })
      fireEvent.change(screen.getByLabelText('SKILL.md'), {
        target: { value: '---\nname: daily-review\n---\n\n# Daily Review' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Create skill' }))
    })

    await waitFor(() => expect(notificationMocks.notify).toHaveBeenCalled())
    expect(createTrigger.ownerDocument.activeElement).toBe(await screen.findByRole('button', { name: 'New skill' }))
  })
})
