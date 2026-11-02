import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { readDesktopFileDataUrl, readDesktopFileText, resolveMediaPlaybackSrc } = vi.hoisted(() => ({
  readDesktopFileDataUrl: vi.fn(),
  readDesktopFileText: vi.fn(),
  resolveMediaPlaybackSrc: vi.fn()
}))

vi.mock('@/components/assistant-ui/embeds', () => ({ RichCodeBlock: () => null }))
vi.mock('@/components/chat/code-editor', () => ({ CodeEditor: () => null }))
vi.mock('@/components/chat/diff-lines', () => ({ FileDiffPanel: () => null }))
vi.mock('@/components/chat/shiki-highlighter', () => ({ LazyShiki: () => null }))
vi.mock('@/components/page-loader', () => ({ PageLoader: ({ label }: { label: string }) => createElement('div', {}, label) }))
vi.mock('@/components/ui/tooltip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/lib/desktop-fs', () => ({
  desktopFileDiff: vi.fn(),
  desktopFsCacheKey: () => 'local',
  desktopGitRoot: vi.fn(),
  readDesktopFileDataUrl,
  readDesktopFileText,
  writeDesktopFileText: vi.fn()
}))
vi.mock('@/lib/katex-memo', () => ({ createMemoizedMathPlugin: () => ({}) }))
vi.mock('@/lib/media', () => ({ resolveMediaDisplaySrc: vi.fn(), resolveMediaPlaybackSrc }))
vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => createElement('pre', {}, children)
}))
vi.mock('@/store/preview-edit', () => ({ setPreviewDirty() {} }))
vi.mock('@/store/workspace-events', () => ({ notifyWorkspaceChanged() {} }))

import { LocalFilePreview } from './preview-file'

beforeEach(() => {
  resolveMediaPlaybackSrc.mockReset()
  readDesktopFileDataUrl.mockReset()
  readDesktopFileText.mockReset()
})

afterEach(cleanup)

describe('LocalFilePreview media', () => {
  it.each([
    ['audio', '/tmp/track.mp3', 'lemon-media://stream/track', 'audio'],
    ['video', '/tmp/clip.mp4', 'lemon-media://stream/clip', 'video']
  ] as const)('renders %s with native controls and the playback transport', async (previewKind, path, src, tag) => {
    resolveMediaPlaybackSrc.mockResolvedValue(src)

    const { container } = render(
      <LocalFilePreview
        reloadKey={0}
        target={{ kind: 'file', label: path, path, previewKind, source: path, url: `file://${path}` }}
      />
    )

    await waitFor(() => expect(container.querySelector(tag)).not.toBeNull())
    const media = container.querySelector(tag)
    expect(media?.hasAttribute('controls')).toBe(true)
    expect(media?.getAttribute('preload')).toBe('metadata')
    expect(media?.hasAttribute('autoplay')).toBe(false)
    expect(media?.getAttribute('src')).toBe(src)
    expect(resolveMediaPlaybackSrc).toHaveBeenCalledWith(path)
    expect(readDesktopFileDataUrl).not.toHaveBeenCalled()
    expect(readDesktopFileText).not.toHaveBeenCalled()
  })

  it('asks again before previewing a blocked file after the target changes', async () => {
    const oldTarget = {
      binary: true,
      kind: 'file' as const,
      label: 'old.bin',
      path: '/tmp/old.bin',
      previewKind: 'binary' as const,
      source: '/tmp/old.bin',
      url: 'file:///tmp/old.bin'
    }

    const newTarget = {
      ...oldTarget,
      label: 'new.bin',
      path: '/tmp/new.bin',
      source: '/tmp/new.bin',
      url: 'file:///tmp/new.bin'
    }

    const { getByRole, rerender } = render(<LocalFilePreview reloadKey={0} target={oldTarget} />)

    fireEvent.click(getByRole('button', { name: 'Preview anyway' }))
    await waitFor(() => expect(readDesktopFileText).toHaveBeenCalledWith('/tmp/old.bin', undefined))
    readDesktopFileText.mockClear()
    rerender(<LocalFilePreview reloadKey={0} target={newTarget} />)

    expect(getByRole('button', { name: 'Preview anyway' })).not.toBeNull()
    await Promise.resolve()
    expect(readDesktopFileText).not.toHaveBeenCalled()
  })

  it('does not publish a stale playback source after the target changes', async () => {
    let releaseFirst: (src: string) => void = () => {}
    resolveMediaPlaybackSrc
      .mockImplementationOnce(() => new Promise<string>(resolve => (releaseFirst = resolve)))
      .mockResolvedValueOnce('lemon-media://stream/new')

    const { container, rerender } = render(
      <LocalFilePreview
        reloadKey={0}
        target={{
          kind: 'file',
          label: 'old.mp3',
          path: '/tmp/old.mp3',
          previewKind: 'audio',
          source: '/tmp/old.mp3',
          url: 'file:///tmp/old.mp3'
        }}
      />
    )

    rerender(
      <LocalFilePreview
        reloadKey={0}
        target={{
          kind: 'file',
          label: 'new.mp3',
          path: '/tmp/new.mp3',
          previewKind: 'audio',
          source: '/tmp/new.mp3',
          url: 'file:///tmp/new.mp3'
        }}
      />
    )

    await waitFor(() => expect(container.querySelector('audio')?.getAttribute('src')).toBe('lemon-media://stream/new'))
    releaseFirst('lemon-media://stream/old')
    await waitFor(() => expect(container.querySelector('audio')?.getAttribute('src')).toBe('lemon-media://stream/new'))
  })
})
