import { afterEach, describe, expect, it, vi } from 'vitest'

import { $connection } from '@/store/session'

import { downloadProviderArtifact } from './provider-artifacts'

describe('downloadProviderArtifact', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    $connection.set(null)
  })

  it('uses the owning connection and passes only the opaque ID and session', async () => {
    const saveProviderArtifact = vi.fn(async () => ({ path: '/Downloads/report.zip', saved: true }))
    vi.stubGlobal('window', { lemonDesktop: { saveProviderArtifact } })
    $connection.set({ connectionId: 'conn-1', mode: 'remote', profile: 'work' } as never)

    await expect(downloadProviderArtifact('0'.repeat(32), 'session-1', 'report.zip', {
      connectionId: 'conn-1', profile: 'work'
    })).resolves.toEqual({
      path: '/Downloads/report.zip', saved: true
    })

    expect(saveProviderArtifact).toHaveBeenCalledWith({
      artifactId: '0'.repeat(32), connectionId: 'conn-1', profile: 'work',
      sessionId: 'session-1', suggestedName: 'report.zip'
    })
  })

  it('fails when the native bridge is unavailable', async () => {
    vi.stubGlobal('window', { lemonDesktop: {} })

    await expect(downloadProviderArtifact('0'.repeat(32), 'session-1', 'report.zip', 'default')).rejects.toThrow(
      'Desktop provider artifact bridge is unavailable'
    )
  })
})
