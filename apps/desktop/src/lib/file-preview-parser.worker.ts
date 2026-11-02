import { readSheet } from 'read-excel-file/browser'

import { listZipEntries, parseOfficePreview, type ParseResult, parseXlsxPreview } from './file-preview-parser'

type WorkerRequest = {
  bytes: Uint8Array
  previewKind: 'docx' | 'pptx' | 'xlsx' | 'zip'
  selectedSheet: number
}

self.onmessage = async ({ data }: MessageEvent<WorkerRequest>) => {
  let result: ParseResult

  switch (data.previewKind) {
    case 'zip':
      result = await listZipEntries(data.bytes)

      break

    case 'docx':

    case 'pptx':
      result = await parseOfficePreview(data.bytes, data.previewKind)

      break

    case 'xlsx':
      result = await parseXlsxPreview(data.bytes, data.selectedSheet, async (bytes, sheet) => {
        const input = Uint8Array.from(bytes).buffer

        return readSheet(input, sheet, {})
      })

      break
  }

  self.postMessage(result)
}
