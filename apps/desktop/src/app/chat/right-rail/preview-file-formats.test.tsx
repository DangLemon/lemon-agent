import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ParseResult } from '@/lib/file-preview-parser'
import { $connection } from '@/store/session'

const { readDesktopFileBytes } = vi.hoisted(() => ({
  readDesktopFileBytes: vi.fn()
}))

vi.mock('@/components/page-loader', () => ({
  PageLoader: ({ label }: { label: string }) => createElement('div', {}, label)
}))
vi.mock('@/lib/desktop-fs', () => ({
  desktopFsCacheKey: (value: { connectionId?: string; profile?: string } | null) =>
    `${value?.connectionId || ''}:${value?.profile || ''}`,
  readDesktopFileBytes
}))
import { StructuredFilePreview } from './preview-file-formats'

const workerResults: ParseResult[] = []

class PreviewWorker {
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessage: ((event: MessageEvent<ParseResult>) => void) | null = null

  postMessage() {
    const result = workerResults.shift()
    queueMicrotask(() => {
      if (result) {
        this.onmessage?.(new MessageEvent('message', { data: result }))
      } else {
        this.onerror?.(new ErrorEvent('error', { message: 'Missing worker result' }))
      }
    })
  }

  terminate() {}
}

beforeEach(() => {
  $connection.set({ connectionId: 'local-a', mode: 'local', profile: 'default' } as never)
  readDesktopFileBytes.mockReset()
  workerResults.length = 0
  vi.stubGlobal('Worker', PreviewWorker)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('StructuredFilePreview', () => {
  it('renders CSV as a table and preserves its source view', async () => {
    readDesktopFileBytes.mockResolvedValue(new TextEncoder().encode('name,score\nAda,42'))

    const { container, getByRole } = render(
      <StructuredFilePreview filePath="/tmp/report.csv" previewKind="delimited" reloadKey={0} />
    )

    await waitFor(() => expect(container.querySelector('table')).not.toBeNull())
    expect(container.textContent).toContain('Ada')
    fireEvent.click(getByRole('button', { name: 'SOURCE' }))

    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('name,score')
  })

  it.each<[previewKind: 'docx' | 'pptx' | 'zip', result: ParseResult, expected: string[]]>([
    [
      'zip',
      {
        clipped: false,
        entries: [{ compressedSize: 4, name: 'docs/readme.txt', uncompressedSize: 5 }],
        totalEntries: 1,
        type: 'archive'
      },
      ['docs/readme.txt']
    ],
    [
      'docx',
      { clipped: false, format: 'docx', sections: [{ text: 'Hello document' }], type: 'document' },
      ['Hello document']
    ],
    [
      'pptx',
      {
        clipped: false,
        format: 'pptx',
        sections: [{ text: 'Hello slide', title: 'Slide 1' }],
        type: 'document'
      },
      ['Slide 1', 'Hello slide']
    ]
  ])('renders bounded %s worker output', async (previewKind, result, expected) => {
    readDesktopFileBytes.mockResolvedValue(new Uint8Array([1]))
    workerResults.push(result)

    const { container } = render(
      <StructuredFilePreview filePath={`/tmp/file.${previewKind}`} previewKind={previewKind} reloadKey={0} />
    )

    for (const text of expected) {
      await waitFor(() => expect(container.textContent).toContain(text))
    }

    expect(readDesktopFileBytes).toHaveBeenCalledOnce()
  })

  it('loads another XLSX sheet when its tab is selected', async () => {
    readDesktopFileBytes.mockResolvedValue(new Uint8Array([1]))
    workerResults.push(
      {
        clipped: [],
        rows: [['First']],
        selectedSheet: 0,
        sheets: ['Sheet One', 'Sheet Two'],
        type: 'table'
      },
      {
        clipped: [],
        rows: [['Second']],
        selectedSheet: 1,
        sheets: ['Sheet One', 'Sheet Two'],
        type: 'table'
      }
    )

    const { container, getByRole } = render(
      <StructuredFilePreview filePath="/tmp/report.xlsx" previewKind="xlsx" reloadKey={0} />
    )

    await waitFor(() => expect(container.textContent).toContain('First'))
    expect(getByRole('button', { name: 'Sheet One' }).getAttribute('aria-pressed')).toBe('true')
    expect(getByRole('button', { name: 'Sheet Two' }).getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(getByRole('button', { name: 'Sheet Two' }))
    await waitFor(() => expect(container.textContent).toContain('Second'))
    expect(getByRole('button', { name: 'Sheet Two' }).getAttribute('aria-pressed')).toBe('true')
    expect(readDesktopFileBytes).toHaveBeenCalledOnce()
  })

  it('does not publish stale structured output after the target changes', async () => {
    let releaseFirst: (bytes: Uint8Array) => void = () => {}
    readDesktopFileBytes
      .mockImplementationOnce(() => new Promise<Uint8Array>(resolve => (releaseFirst = resolve)))
      .mockResolvedValueOnce(new TextEncoder().encode('new'))

    const { container, rerender } = render(
      <StructuredFilePreview filePath="/tmp/old.csv" previewKind="delimited" reloadKey={0} />
    )

    rerender(<StructuredFilePreview filePath="/tmp/new.csv" previewKind="delimited" reloadKey={0} />)
    await waitFor(() => expect(container.textContent).toContain('new'))
    releaseFirst(new TextEncoder().encode('old'))
    await waitFor(() => expect(container.textContent).not.toContain('old'))
  })

  it('reloads the same path when the active connection changes', async () => {
    readDesktopFileBytes
      .mockResolvedValueOnce(new TextEncoder().encode('local'))
      .mockResolvedValueOnce(new TextEncoder().encode('remote'))

    const { container } = render(
      <StructuredFilePreview filePath="/tmp/report.csv" previewKind="delimited" reloadKey={0} />
    )

    await waitFor(() => expect(container.textContent).toContain('local'))
    $connection.set({ connectionId: 'remote-a', mode: 'remote', profile: 'work' } as never)
    await waitFor(() => expect(container.textContent).toContain('remote'))
    expect(container.textContent).not.toContain('local')
    expect(readDesktopFileBytes).toHaveBeenCalledTimes(2)
  })
})
