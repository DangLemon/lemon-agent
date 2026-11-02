import type { FilePreviewKind } from '@lemon-ai/shared/file-preview-format'
import { FILE_PREVIEW_LIMITS } from '@lemon-ai/shared/file-preview-format'
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'

import { PageLoader } from '@/components/page-loader'
import { useI18n } from '@/i18n'
import { desktopFsCacheKey, readDesktopFileBytes } from '@/lib/desktop-fs'
import { parseDelimitedPreview, type ParseResult } from '@/lib/file-preview-parser'
import { $connection } from '@/store/session'

type PreviewViewMode = 'rendered' | 'source'
type StructuredKind = Extract<FilePreviewKind, 'delimited' | 'docx' | 'pptx' | 'xlsx' | 'zip'>

type StructuredState =
  { type: 'loading' } | { detail: string; type: 'error' } | { result: ParseResult; source?: string; type: 'ready' }

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function EmptyState({ body, title, warning = false }: { body: string; title: string; warning?: boolean }) {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="grid max-w-sm gap-2">
        <div className="text-sm font-medium">{title}</div>
        <div className={warning ? 'text-xs text-amber-700 dark:text-amber-200' : 'text-xs text-muted-foreground'}>
          {body}
        </div>
      </div>
    </div>
  )
}

function ModeSwitcher({
  active,
  labels,
  onSelect
}: {
  active: PreviewViewMode
  labels: Record<PreviewViewMode, string>
  onSelect: (mode: PreviewViewMode) => void
}) {
  return (
    <div className="flex h-7 shrink-0 items-center justify-end gap-3">
      {(['rendered', 'source'] as const).map(mode => (
        <button
          className={
            mode === active
              ? 'text-[0.625rem] font-bold text-foreground underline'
              : 'text-[0.625rem] font-bold text-muted-foreground hover:text-foreground'
          }
          key={mode}
          onClick={() => onSelect(mode)}
          type="button"
        >
          {labels[mode]}
        </button>
      ))}
    </div>
  )
}

function SourcePreview({ source }: { source: string }) {
  return <pre className="h-full overflow-auto whitespace-pre p-3 font-mono text-xs">{source}</pre>
}

function PreviewTable({ rows }: { rows: string[][] }) {
  return (
    <div className="h-full overflow-auto p-3">
      <table className="min-w-full border-collapse text-left text-xs">
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr className="border-b border-border last:border-0" key={rowIndex}>
              {row.map((cell, columnIndex) => (
                <td className="max-w-96 border-r border-border px-3 py-2 align-top last:border-r-0" key={columnIndex}>
                  <span className="whitespace-pre-wrap break-words">{cell}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResultNotice({ message, result }: { message: string; result: ParseResult }) {
  if (result.type === 'table' && result.clipped.length > 0) {
    return (
      <div className="border-b border-border bg-muted/35 px-3 py-1.5 text-xs text-muted-foreground">
        {message}
      </div>
    )
  }

  if ((result.type === 'archive' || result.type === 'document') && result.clipped) {
    return (
      <div className="border-b border-border bg-muted/35 px-3 py-1.5 text-xs text-muted-foreground">
        {message}
      </div>
    )
  }

  return null
}

function StructuredResult({
  archiveLabels,
  result,
  unavailable
}: {
  archiveLabels: { compressed: string; name: string; size: string }
  result: ParseResult
  unavailable: string
}) {
  if (result.type === 'refused') {
    return <EmptyState body={result.detail} title={unavailable} warning />
  }

  if (result.type === 'table') {
    return <PreviewTable rows={result.rows} />
  }

  if (result.type === 'archive') {
    return (
      <div className="h-full overflow-auto p-3">
        <table className="min-w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-background text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">{archiveLabels.name}</th>
              <th className="px-3 py-2 text-right font-medium">{archiveLabels.size}</th>
              <th className="px-3 py-2 text-right font-medium">{archiveLabels.compressed}</th>
            </tr>
          </thead>
          <tbody>
            {result.entries.map(entry => (
              <tr className="border-b border-border last:border-0" key={entry.name}>
                <td className="px-3 py-2 font-mono">{entry.name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBytes(entry.uncompressedSize)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatBytes(entry.compressedSize)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-4" data-selectable-text="true">
      <div className="mx-auto grid max-w-3xl gap-5">
        {result.sections.map((section, index) => (
          <section className="grid gap-2" key={`${section.title || result.format}-${index}`}>
            {section.title && <h2 className="text-sm font-semibold">{section.title}</h2>}
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{section.text}</div>
          </section>
        ))}
      </div>
    </div>
  )
}

function workerRequest(
  worker: Worker,
  bytes: Uint8Array,
  previewKind: Exclude<StructuredKind, 'delimited'>,
  selectedSheet: number
) {
  worker.postMessage({ bytes, previewKind, selectedSheet }, [bytes.buffer])
}

export function StructuredFilePreview({
  filePath,
  previewKind,
  reloadKey
}: {
  filePath: string
  previewKind: StructuredKind
  reloadKey: number
}) {
  const { t } = useI18n()
  const connection = useStore($connection)
  const connectionKey = desktopFsCacheKey(connection)
  const [state, setState] = useState<StructuredState>({ type: 'loading' })
  const [selectedSheet, setSelectedSheet] = useState(0)
  const [mode, setMode] = useState<PreviewViewMode>('rendered')
  const [bytes, setBytes] = useState<Uint8Array>()

  useEffect(() => {
    setSelectedSheet(0)
    setMode('rendered')
    setBytes(undefined)
  }, [connectionKey, filePath, previewKind, reloadKey])

  useEffect(() => {
    let active = true
    setState({ type: 'loading' })

    void readDesktopFileBytes(
      filePath,
      previewKind === 'delimited' ? FILE_PREVIEW_LIMITS.textBytes : FILE_PREVIEW_LIMITS.packageBytes
    )
      .then(fileBytes => {
        if (!active) {
          return
        }

        setBytes(fileBytes)

        if (previewKind === 'delimited') {
          const source = new TextDecoder('utf-8', { fatal: true }).decode(fileBytes)
          setState({
            result: parseDelimitedPreview(source, filePath.toLowerCase().endsWith('.tsv') ? '\t' : ','),
            source,
            type: 'ready'
          })
        }
      })
      .catch(error => {
        if (active) {
          setState({ detail: error instanceof Error ? error.message : String(error), type: 'error' })
        }
      })

    return () => {
      active = false
    }
  }, [connectionKey, filePath, previewKind, reloadKey])

  useEffect(() => {
    if (!bytes || previewKind === 'delimited') {
      return
    }

    let active = true

    const worker = new Worker(new URL('../../../lib/file-preview-parser.worker.ts', import.meta.url), {
      type: 'module'
    })

    setState({ type: 'loading' })

    worker.onmessage = event => {
      if (active) {
        setState({ result: event.data as ParseResult, type: 'ready' })
      }

      worker.terminate()
    }

    worker.onerror = event => {
      if (active) {
        setState({ detail: event.message || 'Structured preview worker failed', type: 'error' })
      }

      worker.terminate()
    }

    workerRequest(worker, bytes.slice(), previewKind, selectedSheet)

    return () => {
      active = false
      worker.terminate()
    }
  }, [bytes, previewKind, selectedSheet])

  if (state.type === 'loading') {
    return <PageLoader label={t.preview.loading} />
  }

  if (state.type === 'error') {
    return <EmptyState body={state.detail} title={t.preview.unavailable} />
  }

  const { result } = state
  const sheets = result.type === 'table' ? result.sheets : undefined
  const modes: PreviewViewMode[] = previewKind === 'delimited' ? ['rendered', 'source'] : ['rendered']

  return (
    <div className="flex h-full flex-col overflow-hidden bg-transparent">
      {(sheets?.length || modes.length > 1) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3">
          {sheets && (
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-1">
              {sheets.map((sheet, index) => (
                <button
                  aria-pressed={index === selectedSheet}
                  className={
                    index === selectedSheet
                      ? 'rounded bg-accent px-2 py-1 text-xs font-medium'
                      : 'rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground'
                  }
                  key={`${sheet}-${index}`}
                  onClick={() => setSelectedSheet(index)}
                  type="button"
                >
                  {sheet}
                </button>
              ))}
            </div>
          )}
          {modes.length > 1 && (
            <ModeSwitcher
              active={mode}
              labels={{ rendered: t.preview.renderedPreview, source: t.preview.source }}
              onSelect={setMode}
            />
          )}
        </div>
      )}
      <ResultNotice message={t.preview.clippedToSafeLimits} result={result} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === 'source' && state.source !== undefined ? (
          <SourcePreview source={state.source} />
        ) : (
          <StructuredResult
            archiveLabels={{
              compressed: t.preview.archiveCompressed,
              name: t.preview.archiveName,
              size: t.preview.archiveSize
            }}
            result={result}
            unavailable={t.preview.unavailable}
          />
        )}
      </div>
    </div>
  )
}
