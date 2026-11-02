# Bounded desktop file preview

## Usage

Callers keep the existing entry point. They normalize a path, then open one `PreviewTarget`. Callers do not select parsers or handle ZIP entries.

```ts
const target = await normalizeOrLocalPreviewTarget(path, cwd)
if (target) openPreview(target, 'tool-result')
```

`LocalFilePreview` remains the file router. Audio and video use `resolveMediaPlaybackSrc()`. Structured formats receive bounded data and return display-only models.

## Chosen design

Candidate 2 is the base. It is the only candidate that addresses sparse XLSX coordinates, bounded actual reads, selected-sheet admission before `read-excel-file`, and equivalent local and remote acquisition.

Two ideas are grafted into it:

- Candidate 3 keeps CSV and TSV parsing synchronous under the existing 512 KiB text ceiling. ZIP and Office parsing use a worker because decompression and XML parsing are controlled by the file.
- Candidate 1 keeps the existing local card behavior. A local file offers Reveal and Preview. A directory offers Open Folder. A missing local path is unavailable. Remote paths keep Download.

The implementation must not replace existing text, image, PDF, or HTML paths with a new preview service. It must not parse Office files in Electron's privileged main process.

## Domain shape

One dependency-free module owns classification and limits:

```ts
export type FilePreviewKind =
  | 'audio'
  | 'binary'
  | 'delimited'
  | 'docx'
  | 'html'
  | 'image'
  | 'pdf'
  | 'pptx'
  | 'text'
  | 'video'
  | 'xlsx'
  | 'zip'

export interface FilePreviewFormat {
  readonly delimiter?: ',' | '\t'
  readonly kind: FilePreviewKind
  readonly language: string
  readonly mimeType?: string
  readonly streamable: boolean
}

export const FILE_PREVIEW_LIMITS = Object.freeze({
  textBytes: 512 * 1024,
  packageBytes: 8 * 1024 * 1024,
  zipEntries: 2_000,
  zipDirectoryBytes: 1024 * 1024,
  zipNameBytes: 1_024,
  zipVisibleEntries: 500,
  officeEntryBytes: 4 * 1024 * 1024,
  officeInflatedBytes: 16 * 1024 * 1024,
  officeXmlDepth: 64,
  officeXmlNodes: 200_000,
  workbookSheets: 32,
  workbookInputRows: 2_000,
  workbookInputColumns: 128,
  workbookInputRectangleCells: 100_000,
  tableRows: 200,
  tableColumns: 50,
  tableCellCharacters: 2_000,
  sharedStrings: 50_000,
  documentCharacters: 100_000,
  presentationSlides: 100,
  parseMilliseconds: 5_000
} as const)

export function filePreviewFormat(
  path: string,
  metadata?: { binary?: boolean; mimeType?: string }
): FilePreviewFormat
```

`PreviewTarget` stores only identity and `previewKind`. Parsed rows, archive entries, and Office text remain runtime component state.

The parser returns bounded domain models:

```ts
type ParseResult =
  | {
      type: 'table'
      rows: readonly (readonly string[])[]
      sheets?: readonly string[]
      selectedSheet?: number
      clipped: readonly ('rows' | 'columns' | 'cell-text')[]
    }
  | {
      type: 'archive'
      entries: readonly ArchiveRow[]
      totalEntries: number
      clipped: boolean
    }
  | {
      type: 'document'
      sections: readonly TextSection[]
      clipped: boolean
      format: 'docx' | 'pptx'
    }
  | {
      type: 'refused'
      reason: 'limit' | 'unsupported' | 'invalid'
      detail: string
    }
```

## Module ownership

- `apps/desktop/shared/file-preview-format.ts` owns extension-to-family facts and every preview ceiling. Electron and renderer import the same table.
- `apps/desktop/src/app/chat/right-rail/preview-file-formats.tsx` owns structured-format loading, worker lifecycle, sheet selection, and safe React rendering. It exports one `StructuredFilePreview` component.
- `apps/desktop/src/lib/file-preview-parser.worker.ts` owns ZIP directory validation, bounded inflation, XML parsing, and structured output. Parser internals stay private.
- `apps/desktop/src/app/chat/right-rail/preview-file.tsx` keeps existing renderers. It adds only structured dispatch plus native audio and video elements.
- `apps/desktop/src/lib/desktop-fs.ts` carries a caller-supplied `maxBytes` through existing local and remote reads. The limit can narrow endpoint ceilings but cannot raise them.
- `apps/desktop/src/components/chat/preview-attachment.tsx` keeps card actions. It does not create a second filesystem inspection API.

## Bounded parsing rules

### Binary acquisition

The adapter requests at most 8 MiB. Local and remote boundaries read at most `limit + 1` bytes, then refuse extra input. A prior `stat` is only an early rejection. The implementation checks encoded data URL length before decoding, then checks decoded length and container signature again.

### ZIP

The parser reads the central directory without inflating members. It rejects ZIP64, split volumes, encryption, traversal or absolute names, duplicate normalized names, unsupported compression, inconsistent offsets, overlapping member ranges, and declared totals above the limits. ZIP listing never extracts or opens an entry.

### Office inflation

The worker inflates only required parts. It counts actual output per part and across the request. It aborts as soon as output exceeds a ceiling. A check performed only after a sync inflate does not satisfy this contract.

XML parsing rejects `DOCTYPE` and entities. It enforces byte, depth, node, and text limits. External relationships, macros, embeddings, images, and hyperlinks are ignored. UI rendering uses React text nodes, never raw Office HTML or XML.

### XLSX admission

Before `read-excel-file` receives bytes, the worker validates workbook relationships, shared strings, selected-sheet coordinates, occupied row and column counts, and the dense rectangle implied by the largest cell coordinate. Sparse far-away cells are refused.

Only a package rebuilt from validated parts may reach the dependency. A fixture must prove that `read-excel-file@9.3.12` accepts the rebuilt package and does not require unchecked sheets. If this cannot be proved, XLSX support remains blocked rather than calling `readSheet(originalBytes).slice(...)`.

### CSV and TSV

A bounded state machine parses quoted delimiters, escaped quotes, CRLF, embedded newlines, BOM, trailing empty fields, and truncated source. It retains at most 200 rows, 50 columns, and 2,000 characters per displayed cell. Formula-looking text remains text. Table view is read-only. Source editing remains available only when the complete source was read.

## Async lifecycle

Each active structured preview owns one short-lived worker. A target, connection, profile, sheet, or reload change increments a request generation and terminates the previous worker. Late reads and worker responses cannot publish state for a newer target. No worker pool or parsed-data cache is added.

Audio and video retain the same cancellation rule in the component effect. They use native controls, `preload="metadata"`, and no autoplay. They never use text or data-URL reads.

## Rejected alternatives

- Candidate 1 is too broad as one renderer-domain owner. Its initial limits do not stop XLSX allocation caused by sparse coordinates.
- Candidate 3 leaves XLSX admission unresolved. A worker protects responsiveness but does not impose a memory bound.
- Candidate 4 moves hostile parsing into Electron main. That risks the privileged process, widens IPC and remote routing, and replaces working preview paths without need.
- A full Office renderer is outside scope. Text-first output is the product ceiling.
- A utility process with hard quotas is deferred. Add it only if measured workloads exceed worker isolation and the bounded parser contract remains insufficient.

## Acceptance gates

1. Real CSV and TSV fixtures prove table and source behavior, quoting rules, clipping, and no formula execution.
2. Real XLSX fixtures prove sheet selection, sparse-coordinate refusal, shared-string limits, and rebuilt-package compatibility with `read-excel-file@9.3.12`.
3. ZIP fixtures prove metadata-only listing and rejection of malformed directories, unsafe names, encryption, ZIP64, count limits, and actual-output bombs.
4. DOCX and PPTX fixtures prove ordered text extraction, ignored external relationships, rejected entities, bounded text, and inert markup.
5. Audio and video tests prove native controls, seekable playback transport, no autoplay, no whole-file reads, and stale-request cancellation.
6. Local card tests prove Reveal, Open Folder, and unavailable missing paths. Remote cards prove Download without a local probe.
7. Backend tests prove raster streams, Range and HEAD behavior, sensitive-path checks, and continued HTTP 415 for SVG and arbitrary files.
8. Focused tests, renderer and Electron typechecks, lint, build, and a packaged Electron worker run pass before completion.

## Implementation order

1. Finish media and card cleanup because both use existing contracts.
2. Add the shared classifier and migrate duplicate classification.
3. Add bounded byte transport and hostile fixtures.
4. Prove ZIP directory scanning and bounded inflation.
5. Prove XLSX admission and rebuilt-package compatibility.
6. Add structured renderers only after parser gates pass.
7. Run broad verification and the real Electron flow.
