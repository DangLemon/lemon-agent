import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@/app/chat/composer/focus', () => ({ requestComposerFocus() {}, requestComposerInsertRefs() {} }))
vi.mock('@/app/chat/composer/inline-refs', () => ({ droppedFileInlineRef: () => '' }))
vi.mock('@/app/chat/hooks/use-composer-actions', () => ({ LEMON_PATHS_MIME: 'fixture' }))
vi.mock('@/components/assistant-ui/embeds', () => ({ RichCodeBlock: () => null }))
vi.mock('@/components/chat/code-editor', () => ({
  CodeEditor: ({ initialValue, onChange }: { initialValue: string; onChange: (value: string) => void }) =>
    createElement('textarea', {
      'aria-label': 'editor',
      defaultValue: initialValue,
      onChange: (event: { target: { value: string } }) => onChange(event.target.value)
    })
}))
vi.mock('@/components/chat/diff-lines', () => ({ FileDiffPanel: () => null }))
vi.mock('@/components/chat/shiki-highlighter', () => ({ LazyShiki: () => null }))
vi.mock('@/components/page-loader', () => ({ PageLoader: () => null }))
vi.mock('@/components/ui/tooltip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => children }))
vi.mock('@/lib/katex-memo', () => ({ createMemoizedMathPlugin: () => ({}) }))
vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: React.ReactNode }) => createElement('pre', {}, children)
}))
vi.mock('@/store/preview-edit', () => ({ setPreviewDirty() {} }))
vi.mock('@/store/workspace-events', () => ({ notifyWorkspaceChanged() {} }))

import { setApiRequestConnection } from '@/api/client'
import { $connection } from '@/store/session'

import { LocalFilePreview } from './preview-file'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'lemonDesktop')
  $connection.set(null)
  setApiRequestConnection(null)
})

it.each([
  [
    { connectionId: 'remote-A', mode: 'remote', profile: 'work' },
    { connectionId: 'remote-B', mode: 'remote', profile: 'work' }
  ],
  [
    { connectionId: 'local', mode: 'local', profile: 'work' },
    { connectionId: 'remote-B', mode: 'remote', profile: 'work' }
  ],
  [
    { connectionId: 'remote-A', mode: 'remote', profile: 'work' },
    { connectionId: 'local', mode: 'local', profile: 'work' }
  ],
  [
    { connectionId: 'remote-A', mode: 'remote', profile: 'work' },
    { connectionId: 'remote-A', mode: 'remote', profile: 'other' }
  ],
  [
    { connectionId: undefined, mode: 'remote', profile: 'default' },
    { connectionId: 'local', mode: 'local', profile: 'default' }
  ],
  [
    { connectionId: undefined, mode: 'remote', profile: 'default' },
    { connectionId: 'remote-B', mode: 'remote', profile: 'default' }
  ]
])('saves to captured scope %j after switching to %j during reread', async (initialConnection, nextConnection) => {
  const writes: unknown[] = []

  let releaseConflictRead: (value: unknown) => void = () => {}

  let reads = 0

  const readText = () => {
    reads += 1

    if (reads === 2) {
      return new Promise(resolve => {
        releaseConflictRead = resolve
      })
    }

    return Promise.resolve({ binary: false, text: 'baseline', truncated: false })
  }

  Object.defineProperty(window, 'lemonDesktop', {
    configurable: true,
    value: {
      api: vi.fn(async request => {
        if (request.path.startsWith('/api/fs/read-text')) {
          return readText()
        }

        if (request.path.startsWith('/api/fs/git-root')) {
          return { root: null }
        }

        if (request.path === '/api/fs/write-text') {
          writes.push(request)

          return { path: request.body.path }
        }

        return {}
      }),
      readFileText: vi.fn(readText),
      readFileDataUrl: vi.fn(),
      writeTextFile: vi.fn(async (path: string, content: string) => {
        writes.push({ local: true, path, content })

        return { path }
      })
    }
  })

  $connection.set(initialConnection as never)
  setApiRequestConnection(initialConnection.connectionId ?? null)

  render(
    <LocalFilePreview
      reloadKey={0}
      target={{
        kind: 'file',
        label: 'IDEA.md',
        path: '/workspace/IDEA.md',
        previewKind: 'text',
        source: '/workspace/IDEA.md',
        url: 'file:///workspace/IDEA.md'
      }}
    />
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'editor' }), {
    target: { value: 'draft intended for remote A' }
  })
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

  await waitFor(() => expect(reads).toBe(2))

  await act(async () => {
    $connection.set(nextConnection as never)
    setApiRequestConnection(nextConnection.connectionId)
  })

  await act(async () => {
    releaseConflictRead({ binary: false, text: 'baseline', truncated: false })
  })

  if (initialConnection.mode === 'remote' && !initialConnection.connectionId) {
    // Legacy descriptors cannot address their original backend after a switch;
    // a save must stop instead of sending to the mutable default connection.
    expect(writes).toHaveLength(0)

    return
  }

  await waitFor(() => expect(writes).toHaveLength(1))

  if (initialConnection.mode === 'local') {
    expect(writes[0]).toEqual({ local: true, path: '/workspace/IDEA.md', content: 'draft intended for remote A' })

    return
  }

  expect(writes[0]).toMatchObject({
    connectionId: initialConnection.connectionId,
    body: {
      content: 'draft intended for remote A',
      path: '/workspace/IDEA.md'
    },
    path: '/api/fs/write-text',
    profile: initialConnection.profile
  })
})

it('keeps a newer edit dirty when it arrives while the captured save is pending', async () => {
  const writes: unknown[] = []

  let releaseWrite: (value: unknown) => void = () => {}

  Object.defineProperty(window, 'lemonDesktop', {
    configurable: true,
    value: {
      api: vi.fn(async request => {
        if (request.path.startsWith('/api/fs/read-text')) {
          return { binary: false, text: 'baseline', truncated: false }
        }

        if (request.path.startsWith('/api/fs/git-root')) {
          return { root: null }
        }

        if (request.path === '/api/fs/write-text') {
          writes.push(request)

          return new Promise(resolve => {
            releaseWrite = resolve
          })
        }

        return {}
      }),
      readFileDataUrl: vi.fn(),
      writeTextFile: vi.fn()
    }
  })

  $connection.set({ connectionId: 'remote-A', mode: 'remote', profile: 'work' } as never)
  setApiRequestConnection('remote-A')

  render(
    <LocalFilePreview
      reloadKey={0}
      target={{
        kind: 'file',
        label: 'IDEA.md',
        path: '/workspace/IDEA.md',
        previewKind: 'text',
        source: '/workspace/IDEA.md',
        url: 'file:///workspace/IDEA.md'
      }}
    />
  )

  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const editor = screen.getByRole('textbox', { name: 'editor' })
  fireEvent.change(editor, { target: { value: 'first draft' } })
  fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

  await waitFor(() => expect(writes).toHaveLength(1))
  fireEvent.change(editor, { target: { value: 'newer draft typed during write' } })

  await act(async () => {
    releaseWrite({ path: '/workspace/IDEA.md' })
  })

  await waitFor(() => expect(screen.getByRole('textbox', { name: 'editor' })).toBe(editor))
  expect((editor as HTMLTextAreaElement).value).toBe('newer draft typed during write')
  expect(writes[0]).toMatchObject({
    body: {
      content: 'first draft',
      path: '/workspace/IDEA.md'
    },
    connectionId: 'remote-A'
  })
})
