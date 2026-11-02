import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { atom } from 'nanostores'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $previewTabSources, closeRightRail, openPreview } from '@/store/preview'
import { $connection } from '@/store/session'

import { PreviewAttachment } from './preview-attachment'

const cwd = atom('/workspace')
const normalizePreviewTarget = vi.fn()
const revealPath = vi.fn()
const openDir = vi.fn()
const saveGatewayFile = vi.fn()

vi.mock('@/app/chat/session-view', () => ({ useSessionView: () => ({ $cwd: cwd }) }))
vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      fileMenu: {
        download: 'Download',
        downloadFailed: 'Download failed',
        downloadSaved: 'Saved',
        revealFileManager: 'Open containing folder'
      },
      preview: {
        hide: 'Hide',
        openPreview: 'Open preview',
        opening: 'Opening',
        unavailable: 'Unavailable'
      },
      rightSidebar: {
        openFolder: 'Open folder'
      }
    }
  })
}))
vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))

beforeEach(() => {
  closeRightRail()
  cwd.set('/workspace')
  $connection.set({ mode: 'local' } as never)
  normalizePreviewTarget.mockReset()
  revealPath.mockReset().mockResolvedValue(true)
  openDir.mockReset().mockResolvedValue({ ok: true })
  saveGatewayFile.mockReset().mockResolvedValue({ saved: true })
  Object.defineProperty(window, 'lemonDesktop', {
    configurable: true,
    value: { normalizePreviewTarget, openDir, revealPath, saveGatewayFile }
  })
})

afterEach(() => {
  cleanup()
  closeRightRail()
  $connection.set(null)
})

describe('PreviewAttachment file actions', () => {
  it('reveals a local file instead of offering Download', async () => {
    normalizePreviewTarget.mockResolvedValue({
      kind: 'file',
      label: 'report.xlsx',
      path: '/workspace/report.xlsx',
      previewKind: 'binary',
      source: 'report.xlsx',
      url: 'file:///workspace/report.xlsx'
    })

    render(<PreviewAttachment target="report.xlsx" />)

    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    const reveal = await screen.findByRole('button', { name: 'Open containing folder' })
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()

    fireEvent.click(reveal)
    await waitFor(() => expect(revealPath).toHaveBeenCalledWith('/workspace/report.xlsx'))
  })

  it('opens a local directory without showing preview or Download actions', async () => {
    normalizePreviewTarget.mockResolvedValue({
      kind: 'file',
      label: 'output',
      path: '/workspace/output',
      previewKind: 'directory',
      source: 'output',
      url: 'file:///workspace/output'
    })

    render(<PreviewAttachment target="output" />)

    const open = await screen.findByRole('button', { name: 'Open folder' })
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open preview' })).toBeNull()

    fireEvent.click(open)
    await waitFor(() => expect(openDir).toHaveBeenCalledWith('/workspace/output'))
  })

  it('shows an unavailable action without Download for a missing local target', async () => {
    normalizePreviewTarget.mockResolvedValue(null)

    render(<PreviewAttachment target="missing.xlsx" />)

    expect((await screen.findByRole('button', { name: 'Unavailable' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
  })

  it('lets an active preview close after its local file disappears', async () => {
    normalizePreviewTarget.mockResolvedValue({
      kind: 'file',
      label: 'missing.xlsx',
      path: '/workspace/missing.xlsx',
      previewKind: 'binary',
      source: 'missing.xlsx',
      url: 'file:///workspace/missing.xlsx'
    })
    openPreview(
      {
        kind: 'file',
        label: 'missing.xlsx',
        path: '/workspace/missing.xlsx',
        previewKind: 'binary',
        source: 'missing.xlsx',
        url: 'file:///workspace/missing.xlsx'
      },
      'manual'
    )
    normalizePreviewTarget.mockResolvedValue(null)

    render(<PreviewAttachment target="missing.xlsx" />)

    const hide = await screen.findByRole('button', { name: 'Hide' })
    expect((hide as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(hide)
    expect($previewTabSources.get()).not.toContain('missing.xlsx')
  })

  it('keeps Download for a sandbox tool result', async () => {
    render(<PreviewAttachment source="tool-result" target="/sandbox/report.xlsx" />)

    expect(await screen.findByRole('button', { name: 'Download' })).toBeTruthy()
    expect(normalizePreviewTarget).not.toHaveBeenCalled()
  })

  it('keeps Download for a remote gateway target', async () => {
    $connection.set({ mode: 'remote', profile: 'work' } as never)

    render(<PreviewAttachment target="/srv/report.xlsx" />)

    expect(await screen.findByRole('button', { name: 'Download' })).toBeTruthy()
    expect(normalizePreviewTarget).not.toHaveBeenCalled()
  })

  it('reclassifies the same target when the active connection changes', async () => {
    normalizePreviewTarget.mockResolvedValue({
      kind: 'file',
      label: 'report.xlsx',
      path: '/workspace/report.xlsx',
      previewKind: 'binary',
      source: 'report.xlsx',
      url: 'file:///workspace/report.xlsx'
    })

    render(<PreviewAttachment target="report.xlsx" />)

    expect(await screen.findByRole('button', { name: 'Open containing folder' })).toBeTruthy()
    $connection.set({ connectionId: 'remote-a', mode: 'remote', profile: 'work' } as never)
    expect(await screen.findByRole('button', { name: 'Download' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open containing folder' })).toBeNull()
  })

  it('falls back to gateway actions when local classification fails', async () => {
    normalizePreviewTarget.mockRejectedValue(new Error('IPC unavailable'))

    render(<PreviewAttachment target="report.xlsx" />)

    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Download' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Open preview' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
