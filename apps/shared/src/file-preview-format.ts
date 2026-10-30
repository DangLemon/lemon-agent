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
  presentationSlides: 100
} as const)

const FORMAT_BY_EXTENSION: Readonly<Record<string, FilePreviewFormat>> = Object.freeze({
  '.avi': format('video', 'text', 'video/x-msvideo', true),
  '.bmp': format('image', 'text', 'image/bmp', true),
  '.csv': { ...format('delimited', 'csv', 'text/csv'), delimiter: ',' },
  '.docx': format('docx'),
  '.flac': format('audio', 'text', 'audio/flac', true),
  '.gif': format('image', 'text', 'image/gif', true),
  '.htm': format('html', 'html', 'text/html'),
  '.html': format('html', 'html', 'text/html'),
  '.jpeg': format('image', 'text', 'image/jpeg', true),
  '.jpg': format('image', 'text', 'image/jpeg', true),
  '.m4a': format('audio', 'text', 'audio/mp4', true),
  '.mkv': format('video', 'text', 'video/x-matroska', true),
  '.mov': format('video', 'text', 'video/quicktime', true),
  '.mp3': format('audio', 'text', 'audio/mpeg', true),
  '.mp4': format('video', 'text', 'video/mp4', true),
  '.ogg': format('audio', 'text', 'audio/ogg', true),
  '.opus': format('audio', 'text', 'audio/ogg; codecs=opus', true),
  '.pdf': format('pdf', 'text', 'application/pdf'),
  '.png': format('image', 'text', 'image/png', true),
  '.pptx': format('pptx'),
  '.svg': format('image', 'xml', 'image/svg+xml'),
  '.tsv': { ...format('delimited', 'tsv', 'text/tab-separated-values'), delimiter: '\t' },
  '.wav': format('audio', 'text', 'audio/wav', true),
  '.webm': format('video', 'text', 'video/webm', true),
  '.webp': format('image', 'text', 'image/webp', true),
  '.xlsx': format('xlsx'),
  '.zip': format('zip', 'text', 'application/zip')
})

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  '.c': 'c',
  '.conf': 'ini',
  '.cpp': 'cpp',
  '.css': 'css',
  '.go': 'go',
  '.graphql': 'graphql',
  '.h': 'c',
  '.hpp': 'cpp',
  '.java': 'java',
  '.js': 'javascript',
  '.json': 'json',
  '.jsx': 'jsx',
  '.kt': 'kotlin',
  '.log': 'text',
  '.lua': 'lua',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.sh': 'shell',
  '.sql': 'sql',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.txt': 'text',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zsh': 'shell'
})

function format(
  kind: FilePreviewKind,
  language = 'text',
  mimeType?: string,
  streamable = false
): FilePreviewFormat {
  return { kind, language, mimeType, streamable }
}

function extension(value: string): string {
  const clean = value.split(/[?#]/, 1)[0] || value
  const index = clean.lastIndexOf('.')

  return index >= 0 ? clean.slice(index).toLowerCase() : ''
}

export function filePreviewFormat(
  path: string,
  metadata: { binary?: boolean; mimeType?: string } = {}
): FilePreviewFormat {
  const ext = extension(path)
  const known = FORMAT_BY_EXTENSION[ext]

  if (known) {
    return known
  }

  const mimeType = metadata.mimeType?.toLowerCase()

  if (mimeType === 'application/pdf') {
    return format('pdf', 'text', metadata.mimeType)
  }

  if (mimeType?.startsWith('image/')) {
    return format('image', mimeType === 'image/svg+xml' ? 'xml' : 'text', metadata.mimeType, mimeType !== 'image/svg+xml')
  }

  if (mimeType?.startsWith('audio/')) {
    return format('audio', 'text', metadata.mimeType, true)
  }

  if (mimeType?.startsWith('video/')) {
    return format('video', 'text', metadata.mimeType, true)
  }

  return format(metadata.binary ? 'binary' : 'text', LANGUAGE_BY_EXTENSION[ext] || 'text', metadata.mimeType)
}
