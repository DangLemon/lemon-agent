// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CustomEndpoint, CustomEndpointUpdate } from '@/types/lemon'

const getCustomEndpoints = vi.fn()
const saveCustomEndpoint = vi.fn()
const validateCustomEndpoint = vi.fn()

const captureCapabilityScope = vi.fn((scope?: unknown) =>
  scope && typeof scope === 'object' ? scope : { profile: scope ?? 'default' }
)

vi.mock('@/lemon', () => ({
  activateCustomEndpoint: vi.fn(),
  captureCapabilityScope: (scope?: unknown) => captureCapabilityScope(scope),
  getCustomEndpoints: (scope?: unknown) => getCustomEndpoints(scope),
  profileScopeKey: (scope?: unknown) => (typeof scope === 'string' ? scope : JSON.stringify(scope ?? 'default')),
  saveCustomEndpoint: (payload: CustomEndpointUpdate, scope?: unknown) => saveCustomEndpoint(payload, scope),
  validateCustomEndpoint: (payload: CustomEndpointUpdate, scope?: unknown) => validateCustomEndpoint(payload, scope)
}))

vi.mock('@/store/profile', () => ({
  $activeGatewayProfile: { get: () => 'default', listen: () => () => {}, subscribe: () => () => {} },
  $profileColors: { get: () => ({}), listen: () => () => {}, subscribe: () => () => {} },
  $profileOrder: { get: () => [], listen: () => () => {}, subscribe: () => () => {} },
  $profiles: { get: () => [], listen: () => () => {}, subscribe: () => () => {} },
  normalizeProfileKey: (value?: null | string) => value?.trim() || 'default',
  refreshProfiles: vi.fn(async () => ({ profiles: [] }))
}))

function endpoint(patch: Partial<CustomEndpoint> = {}): CustomEndpoint {
  return {
    base_url: 'https://ai.company.test/v1',
    discover_models: true,
    has_api_key: true,
    id: 'company-ai',
    is_current: true,
    model: 'company-default',
    models: ['company-default', 'company-fast'],
    name: 'AI company',
    ...patch
  }
}

async function renderAiConnectionSettings(props: { onConfigSaved?: () => void; onMainModelChanged?: (provider: string, model: string) => void } = {}) {
  const { AiConnectionSettings } = await import('./ai-connection-settings')

  render(<AiConnectionSettings {...props} />)
}

beforeEach(() => {
  getCustomEndpoints.mockResolvedValue({ current: { base_url: '', model: '', provider: '' }, endpoints: [endpoint()] })
  saveCustomEndpoint.mockResolvedValue({
    current: { base_url: 'https://next.example/v1', model: 'next-model', provider: 'company-ai' },
    endpoints: [endpoint({ base_url: 'https://next.example/v1', model: 'next-model' })],
    id: 'company-ai',
    ok: true
  })
  validateCustomEndpoint.mockResolvedValue({ message: '', models: ['next-model', 'company-fast'], ok: true, reachable: true })
})

afterEach(async () => {
  cleanup()
  const { $settingsScopeOverride } = await import('@/store/settings-scope')
  $settingsScopeOverride.set(null)
  vi.clearAllMocks()
})

describe('AiConnectionSettings', () => {
  it('surfaces the custom provider form and primary actions immediately', async () => {
    getCustomEndpoints.mockResolvedValueOnce({ current: { base_url: '', model: '', provider: '' }, endpoints: [] })

    await renderAiConnectionSettings()

    expect(await screen.findByRole('button', { name: 'Add connection' })).toBeTruthy()
    expect(screen.getByLabelText('Connection name')).toBeTruthy()
    expect(screen.getByLabelText('Server address')).toBeTruthy()
    expect(screen.getByLabelText('API key')).toBeTruthy()
    expect(screen.getByLabelText('Model')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Test connection' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save and use' })).toBeTruthy()
  })

  it('clears editable state when a later scope fails to load', async () => {
    const { $settingsScopeOverride } = await import('@/store/settings-scope')
    getCustomEndpoints
      .mockResolvedValueOnce({ current: { base_url: '', model: '', provider: '' }, endpoints: [endpoint()] })
      .mockRejectedValueOnce(new Error('scope B offline'))
    await renderAiConnectionSettings()

    expect(await screen.findByText('AI company')).toBeTruthy()

    await act(async () => {
      $settingsScopeOverride.set('research')
    })

    expect(await screen.findByText('Could not load AI connections.')).toBeTruthy()
    expect(screen.queryByText('AI company')).toBeNull()
    expect((screen.getByLabelText('Connection name') as HTMLInputElement).value).toBe('')
    expect((screen.getByRole('button', { name: 'Save and use' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('ignores late rejected validation after the settings scope changes', async () => {
    const { $settingsScopeOverride } = await import('@/store/settings-scope')

    let rejectValidation: (error: Error) => void = () => {}
    validateCustomEndpoint.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectValidation = reject
      })
    )
    getCustomEndpoints
      .mockResolvedValueOnce({ current: { base_url: '', model: '', provider: '' }, endpoints: [endpoint()] })
      .mockResolvedValueOnce({ current: { base_url: '', model: '', provider: '' }, endpoints: [] })
    await renderAiConnectionSettings()

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))

    await act(async () => {
      $settingsScopeOverride.set('research')
    })
    await screen.findByRole('button', { name: 'Add connection' })

    await act(async () => {
      rejectValidation(new Error('old scope failure'))
    })

    expect(screen.queryByText('Could not reach the AI service. Check the address and key, then try again.')).toBeNull()
  })

  it('ignores late rejected save after the settings scope changes', async () => {
    const { $settingsScopeOverride } = await import('@/store/settings-scope')

    let rejectSave: (error: Error) => void = () => {}
    saveCustomEndpoint.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSave = reject
      })
    )
    getCustomEndpoints
      .mockResolvedValueOnce({ current: { base_url: '', model: '', provider: '' }, endpoints: [endpoint()] })
      .mockResolvedValueOnce({ current: { base_url: '', model: '', provider: '' }, endpoints: [] })
    await renderAiConnectionSettings()

    fireEvent.click(await screen.findByRole('button', { name: 'Save and use' }))

    await act(async () => {
      $settingsScopeOverride.set('research')
    })
    await screen.findByRole('button', { name: 'Add connection' })

    await act(async () => {
      rejectSave(new Error('old scope save failure'))
    })

    expect(screen.queryByText('Could not save this connection. Check the fields and try again.')).toBeNull()
  })

  it('shows accessible inline feedback for malformed server addresses', async () => {
    await renderAiConnectionSettings()

    fireEvent.change(await screen.findByLabelText('Server address'), { target: { value: 'example.com' } })

    const message = await screen.findByText('Enter a full server address starting with http:// or https://.')
    expect(message).toBeTruthy()
    const serverAddress = screen.getByLabelText('Server address')
    expect(serverAddress.getAttribute('aria-invalid')).toBe('true')
    const descriptionIds = serverAddress.getAttribute('aria-describedby')?.split(/\s+/) ?? []
    expect(descriptionIds.some(id => globalThis.document.getElementById(id)?.textContent === message.textContent)).toBe(true)
  })

  it('marks the selected saved connection without relying on color only', async () => {
    getCustomEndpoints.mockResolvedValue({
      current: { base_url: '', model: '', provider: '' },
      endpoints: [
        endpoint(),
        endpoint({ id: 'backup-ai', is_current: false, model: 'backup-model', name: 'Backup AI' })
      ]
    })
    await renderAiConnectionSettings()

    const selected = await screen.findByRole('button', { name: /AI company/ })
    const backup = screen.getByRole('button', { name: /Backup AI/ })

    expect(selected.getAttribute('aria-pressed')).toBe('true')
    expect(backup.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('Selected for editing')).toBeTruthy()

    fireEvent.click(backup)

    expect(backup.getAttribute('aria-pressed')).toBe('true')
  })

  it('saves edited connection values without sending a blank existing API key', async () => {
    const onConfigSaved = vi.fn()
    const onMainModelChanged = vi.fn()
    await renderAiConnectionSettings({ onConfigSaved, onMainModelChanged })

    fireEvent.change(await screen.findByLabelText('Server address'), { target: { value: 'https://next.example/v1' } })
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'next-model' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save and use' }))

    await waitFor(() =>
      expect(saveCustomEndpoint).toHaveBeenCalledWith(
        expect.not.objectContaining({ api_key: expect.any(String) }),
        { profile: 'default' }
      )
    )
    expect(saveCustomEndpoint.mock.calls[0][0]).toMatchObject({
      base_url: 'https://next.example/v1',
      id: 'company-ai',
      make_default: true,
      model: 'next-model',
      name: 'AI company'
    })
    expect(saveCustomEndpoint.mock.calls[0][0]).not.toHaveProperty('models')
    expect(onConfigSaved).toHaveBeenCalled()
    expect(onMainModelChanged).toHaveBeenCalledWith('company-ai', 'next-model')
    expect(await screen.findByText('Saved. New conversations will use this connection.')).toBeTruthy()
  })

  it('shows a friendly validation failure and clears it when the draft changes', async () => {
    validateCustomEndpoint.mockResolvedValue({ message: 'FetchError: bearer sk-test-secret failed', models: [], ok: false, reachable: false })
    await renderAiConnectionSettings()

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))

    expect(await screen.findByText('Could not reach the AI service. Check the address and key, then try again.')).toBeTruthy()
    expect(screen.queryByText(/sk-test-secret/)).toBeNull()

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'manual-model' } })

    expect(screen.queryByText('Could not reach the AI service. Check the address and key, then try again.')).toBeNull()
  })

  it('ignores a late validation result after the user starts a different draft', async () => {
    let resolveValidation: (value: { message: string; models: string[]; ok: boolean; reachable: boolean }) => void = () => {}
    validateCustomEndpoint.mockReturnValue(new Promise(resolve => {
      resolveValidation = resolve
    }))
    await renderAiConnectionSettings()

    const testButton = await screen.findByRole('button', { name: 'Test connection' })
    await act(async () => {
      fireEvent.click(testButton)
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    })

    await act(async () => {
      resolveValidation({ message: '', models: ['stale-model'], ok: true, reachable: true })
    })

    expect(screen.queryByText('Found 1 model. You can choose one or type a model name manually.')).toBeNull()
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('')
  })

  it('cancels edits without writing', async () => {
    await renderAiConnectionSettings()

    fireEvent.change(await screen.findByLabelText('Connection name'), { target: { value: 'Changed name' } })
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'new-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel changes' }))

    expect(saveCustomEndpoint).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Connection name') as HTMLInputElement).value).toBe('AI company')
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('')
  })

  it('allows another connection check after editing clears a stale result', async () => {
    validateCustomEndpoint
      .mockResolvedValueOnce({ message: '', models: ['first-model'], ok: true, reachable: true })
      .mockResolvedValueOnce({ message: '', models: ['second-model'], ok: true, reachable: true })
    await renderAiConnectionSettings()

    fireEvent.click(await screen.findByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Found 1 model. You can choose one or type a model name manually.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'manual-after-check' } })
    expect(screen.queryByText('Found 1 model. You can choose one or type a model name manually.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))

    await waitFor(() => expect(validateCustomEndpoint).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Found 1 model. You can choose one or type a model name manually.')).toBeTruthy()
  })
})
