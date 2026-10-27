import { describe, expect, it } from 'vitest'

import { toChatMessages } from './hydration'

const artifact = {
  content_type: 'application/zip',
  expires_at: 1_800_000_000,
  filename: 'report.zip',
  id: '0123456789abcdef0123456789abcdef',
  sha256: 'a'.repeat(64),
  size_bytes: 128
}

describe('provider artifact hydration', () => {
  it('keeps card metadata from durable history beside assistant text', () => {
    const messages = toChatMessages([{
      role: 'assistant', content: 'Answer remains intact.', timestamp: 1,
      display_metadata: { provider_artifacts: [artifact] }
    }])

    expect(messages).toHaveLength(1)
    expect(messages[0].parts).toEqual([expect.objectContaining({ text: 'Answer remains intact.', type: 'text' })])
    expect(messages[0].providerArtifacts).toEqual([artifact])
  })

  it('retains an artifact-only assistant row as a visible card carrier', () => {
    const messages = toChatMessages([{
      role: 'assistant', content: '', timestamp: 1,
      display_metadata: { provider_artifacts: [artifact] }
    }])

    expect(messages).toHaveLength(1)
    expect(messages[0].providerArtifacts).toEqual([artifact])
  })

  it('keeps artifact metadata when final text merges into an existing tool-call bubble', () => {
    const messages = toChatMessages([
      { role: 'assistant', content: '', timestamp: 1, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'run', arguments: '{}' } }] },
      { role: 'assistant', content: 'Done.', timestamp: 2, display_metadata: { provider_artifacts: [artifact] } }
    ])

    expect(messages).toHaveLength(1)
    expect(messages[0].providerArtifacts).toEqual([artifact])
    expect(messages[0].parts).toContainEqual(expect.objectContaining({ text: 'Done.', type: 'text' }))
  })

  it('drops malformed descriptors', () => {
    const messages = toChatMessages([{
      role: 'assistant', content: '', timestamp: 1,
      display_metadata: { provider_artifacts: [{ ...artifact, id: '../escape' }] }
    }])

    expect(messages).toHaveLength(0)
  })
})
