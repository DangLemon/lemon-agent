import { useStore } from '@nanostores/react'
import { useEffect, useRef, useState } from 'react'

import { useSessionView } from '@/app/chat/session-view'
import { useI18n } from '@/i18n'
import { desktopFsCacheKey, isDesktopFsRemoteMode } from '@/lib/desktop-fs'
import { Download, FolderOpen, MonitorPlay } from '@/lib/icons'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { downloadGatewayMediaFile } from '@/lib/media'
import { previewName } from '@/lib/preview-targets'
import { notifyError } from '@/store/notifications'
import { $previewTabSources, closePreviewForSource, openPreview, type PreviewRecordSource } from '@/store/preview'
import { $connection } from '@/store/session'

type LocalTargetState =
  | { path: string; type: 'directory' | 'file' }
  | { type: 'missing' }
  | null

async function classifyLocalTarget(rawTarget: string, cwd?: string | null): Promise<LocalTargetState> {
  const bridge = window.lemonDesktop

  if (!bridge?.normalizePreviewTarget || isDesktopFsRemoteMode()) {
    return null
  }

  const resolved = await bridge.normalizePreviewTarget(rawTarget, cwd || undefined)

  if (!resolved) {
    return { type: 'missing' }
  }

  if (resolved.previewKind === 'directory' && resolved.path) {
    return { path: resolved.path, type: 'directory' }
  }

  if (resolved.kind === 'file' && resolved.path) {
    return { path: resolved.path, type: 'file' }
  }

  return null
}

export function PreviewAttachment({ source = 'manual', target }: { source?: PreviewRecordSource; target: string }) {
  const { t } = useI18n()
  // This link lives in one session's transcript; resolve it against THAT
  // session's cwd, not the primary chat's.
  const cwd = useStore(useSessionView().$cwd)
  const connection = useStore($connection)
  const connectionKey = desktopFsCacheKey(connection)
  const openSources = useStore($previewTabSources)
  const [opening, setOpening] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

  const [localTarget, setLocalTarget] = useState<LocalTargetState>(() =>
    !isDesktopFsRemoteMode() ? { type: 'missing' } : null
  )

  const cwdRef = useRef(cwd)
  const mountedRef = useRef(false)
  const requestTokenRef = useRef(0)
  const targetRef = useRef(target)
  const name = previewName(target)
  const isActive = openSources.includes(target)

  cwdRef.current = cwd
  targetRef.current = target

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      requestTokenRef.current += 1
    }
  }, [])

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    requestTokenRef.current += 1
    setOpening(false)
  }, [connectionKey, cwd, target])

  useEffect(() => {
    let current = true

    if (source === 'tool-result' || isDesktopFsRemoteMode()) {
      setLocalTarget(null)

      return () => {
        current = false
      }
    }

    setLocalTarget({ type: 'missing' })

    void classifyLocalTarget(target, cwd)
      .then(state => current && setLocalTarget(state))
      .catch(() => current && setLocalTarget(null))

    return () => {
      current = false
    }
  }, [connectionKey, cwd, source, target])

  async function openInFileManager(path: string, directory: boolean) {
    if (opening) {
      return
    }

    setOpening(true)

    try {
      if (directory) {
        const result = await window.lemonDesktop?.openDir?.(path)

        if (!result?.ok) {
          throw new Error(result?.error || `Could not open directory: ${path}`)
        }
      } else {
        const revealed = await window.lemonDesktop?.revealPath?.(path)

        if (revealed === false) {
          throw new Error(`Could not reveal file: ${path}`)
        }
      }
    } catch (error) {
      if (mountedRef.current) {
        notifyError(error, t.preview.unavailable)
      }
    } finally {
      if (mountedRef.current) {
        setOpening(false)
      }
    }
  }

  async function togglePreview() {
    if (opening) {
      return
    }

    if (isActive) {
      closePreviewForSource(target)

      return
    }

    if (localTarget?.type === 'missing') {
      notifyError(new Error(`Could not open preview target: ${target}`), t.preview.unavailable)

      return
    }

    const requestToken = ++requestTokenRef.current
    const requestTarget = target
    const requestCwd = cwd

    setOpening(true)

    try {
      const preview = await normalizeOrLocalPreviewTarget(requestTarget, requestCwd || undefined)

      if (
        !mountedRef.current ||
        requestTokenRef.current !== requestToken ||
        targetRef.current !== requestTarget ||
        cwdRef.current !== requestCwd
      ) {
        return
      }

      if (!preview) {
        throw new Error(`Could not open preview target: ${requestTarget}`)
      }

      openPreview(preview, source)
    } catch (error) {
      if (
        !mountedRef.current ||
        requestTokenRef.current !== requestToken ||
        targetRef.current !== requestTarget ||
        cwdRef.current !== requestCwd
      ) {
        return
      }

      notifyError(error, t.preview.unavailable)
    } finally {
      if (mountedRef.current && requestTokenRef.current === requestToken) {
        setOpening(false)
      }
    }
  }

  async function downloadFile() {
    if (downloading) {
      return
    }

    setDownloading(true)

    try {
      // Works in both modes: the Electron main process fetches the bytes
      // through the session's backend connection (local gateway or remote)
      // and prompts for a save location.
      const result = await downloadGatewayMediaFile(target)

      if (mountedRef.current && result.saved) {
        setDownloaded(true)
        setTimeout(() => mountedRef.current && setDownloaded(false), 2000)
      }
    } catch (error) {
      if (mountedRef.current) {
        notifyError(error, t.fileMenu.downloadFailed)
      }
    } finally {
      if (mountedRef.current) {
        setDownloading(false)
      }
    }
  }

  return (
    <div className="flex w-full max-w-160 items-center gap-2 rounded-lg border border-(--ui-stroke-tertiary) bg-card/55 px-2.5 py-1.5 text-sm">
      <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted/55 text-muted-foreground/85">
        <MonitorPlay className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-[0.78rem] font-medium text-foreground/90" title={target}>
        {name}
      </span>
      {localTarget?.type === 'file' || localTarget?.type === 'directory' ? (
        <button
          aria-label={localTarget.type === 'directory' ? t.rightSidebar.openFolder : t.fileMenu.revealFileManager}
          className="flex shrink-0 items-center gap-1 rounded-md border border-(--ui-stroke-tertiary) bg-background/40 px-2 py-1 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:bg-accent/55 hover:text-foreground disabled:opacity-50"
          disabled={opening}
          onClick={() => void openInFileManager(localTarget.path, localTarget.type === 'directory')}
          type="button"
        >
          <FolderOpen className="size-3" />
          {localTarget.type === 'directory' ? t.rightSidebar.openFolder : t.fileMenu.revealFileManager}
        </button>
      ) : localTarget?.type !== 'missing' ? (
        <button
          aria-label={t.fileMenu.download}
          className="flex shrink-0 items-center gap-1 rounded-md border border-(--ui-stroke-tertiary) bg-background/40 px-2 py-1 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:bg-accent/55 hover:text-foreground disabled:opacity-50"
          disabled={downloading}
          onClick={() => void downloadFile()}
          title={t.fileMenu.download}
          type="button"
        >
          <Download className="size-3" />
          {downloaded ? t.fileMenu.downloadSaved : t.fileMenu.download}
        </button>
      ) : null}
      {localTarget?.type !== 'directory' && (
        <button
          className="shrink-0 rounded-md border border-(--ui-stroke-tertiary) bg-background/40 px-2 py-1 text-[0.7rem] font-medium text-muted-foreground transition-colors hover:bg-accent/55 hover:text-foreground disabled:opacity-50"
          disabled={opening || (!isActive && localTarget?.type === 'missing')}
          onClick={() => void togglePreview()}
          type="button"
        >
          {opening
            ? t.preview.opening
            : isActive
              ? t.preview.hide
              : localTarget?.type === 'missing'
                ? t.preview.unavailable
                : t.preview.openPreview}
        </button>
      )}
    </div>
  )
}
