import { act, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderMessageStream } from './test-harness'

afterEach(cleanup)

describe('message.complete provider artifacts', () => {
  it('attaches artifact metadata to the final assistant bubble without changing its text', () => {
    const stream = renderMessageStream('runtime-1')
    const artifacts = [{
      content_type: 'application/zip', expires_at: 2_000_000_000,
      filename: 'report.zip', id: '0123456789abcdef0123456789abcdef', sha256: 'a'.repeat(64), size_bytes: 64
    }]

    act(() => stream.handleEvent({
      session_id: 'runtime-1', type: 'message.complete',
      payload: { text: 'Answer stays as written.', artifacts }
    }))

    const assistant = stream.state('runtime-1').messages.at(-1)
    expect(assistant?.parts).toEqual([
      expect.objectContaining({ text: 'Answer stays as written.', type: 'text' })
    ])
    expect(assistant?.providerArtifacts).toEqual(artifacts)
  })

  it('does not attach artifacts from a failed terminal event', () => {
    const stream = renderMessageStream('runtime-1')

    act(() => stream.handleEvent({
      session_id: 'runtime-1', type: 'message.complete',
      payload: {
        status: 'error', text: 'failed', error: 'failed',
        artifacts: [{ id: '0123456789abcdef0123456789abcdef', filename: 'report.zip' }]
      }
    }))

    expect(stream.state('runtime-1').messages.at(-1)?.providerArtifacts).toBeUndefined()
  })
})
