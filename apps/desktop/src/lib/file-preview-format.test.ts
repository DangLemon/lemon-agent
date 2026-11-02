import {
  FILE_PREVIEW_LIMITS,
  filePreviewFormat,
  type FilePreviewKind
} from '@lemon-ai/shared/file-preview-format'
import { describe, expect, it } from 'vitest'

describe('file preview formats', () => {
  it.each([
    ['report.csv', 'delimited'],
    ['report.tsv', 'delimited'],
    ['report.xlsx', 'xlsx'],
    ['archive.zip', 'zip'],
    ['brief.docx', 'docx'],
    ['slides.pptx', 'pptx'],
    ['track.mp3', 'audio'],
    ['clip.mp4', 'video'],
    ['photo.png', 'image'],
    ['spec.pdf', 'pdf'],
    ['page.html', 'html'],
    ['notes.md', 'text']
  ] satisfies Array<[string, FilePreviewKind]>)('classifies %s as %s', (path, kind) => {
    expect(filePreviewFormat(path).kind).toBe(kind)
  })

  it('keeps structured packages out of the generic binary path', () => {
    expect(filePreviewFormat('/tmp/report.xlsx', { binary: true }).kind).toBe('xlsx')
    expect(filePreviewFormat('/tmp/brief.docx', { binary: true }).kind).toBe('docx')
  })

  it('uses sniffed metadata only when the extension has no stronger format', () => {
    expect(filePreviewFormat('/tmp/file', { binary: true }).kind).toBe('binary')
    expect(filePreviewFormat('/tmp/file', { mimeType: 'application/pdf' }).kind).toBe('pdf')
    expect(filePreviewFormat('/tmp/file', { mimeType: 'image/png' }).kind).toBe('image')
  })

  it('marks seekable media and raster images as streamable but keeps SVG non-streamable', () => {
    expect(filePreviewFormat('track.mp3').streamable).toBe(true)
    expect(filePreviewFormat('clip.mp4').streamable).toBe(true)
    expect(filePreviewFormat('photo.webp').streamable).toBe(true)
    expect(filePreviewFormat('drawing.svg').streamable).toBe(false)
  })

  it('publishes the parser admission ceilings', () => {
    expect(FILE_PREVIEW_LIMITS).toMatchObject({
      packageBytes: 8 * 1024 * 1024,
      tableColumns: 50,
      tableRows: 200,
      workbookInputRectangleCells: 100_000,
      zipEntries: 2_000
    })
  })
})
