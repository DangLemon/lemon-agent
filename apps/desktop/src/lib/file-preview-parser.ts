import { FILE_PREVIEW_LIMITS } from '@lemon-ai/shared/file-preview-format'
import { Inflate, zipSync } from 'fflate'

export type PreviewRefusal = {
  detail: string
  reason: 'invalid' | 'limit' | 'unsupported'
  type: 'refused'
}

export type TablePreview = {
  clipped: Array<'cell-text' | 'columns' | 'rows'>
  rows: string[][]
  selectedSheet?: number
  sheets?: string[]
  type: 'table'
}

export type ArchivePreview = {
  clipped: boolean
  entries: Array<{ compressedSize: number; name: string; uncompressedSize: number }>
  totalEntries: number
  type: 'archive'
}

export type DocumentPreview = {
  clipped: boolean
  format: 'docx' | 'pptx'
  sections: Array<{ text: string; title?: string }>
  type: 'document'
}

export type ParseResult = ArchivePreview | DocumentPreview | PreviewRefusal | TablePreview
export type XlsxReader = (bytes: Uint8Array, sheet: number) => Promise<unknown[][]>

type ZipEntry = {
  compressedSize: number
  compression: 0 | 8
  dataOffset: number
  localOffset: number
  name: string
  uncompressedSize: number
}

type XmlHandlers = {
  close?: (name: string) => void
  open?: (name: string, attributes: Record<string, string>, selfClosing: boolean) => void
  text?: (value: string) => void
}

class PreviewParseError extends Error {
  constructor(
    readonly reason: PreviewRefusal['reason'],
    message: string
  ) {
    super(message)
  }
}

const utf8 = new TextDecoder('utf-8', { fatal: true })
const xmlUtf8 = new TextDecoder('utf-8', { fatal: true })

const cp437High =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■'

function decodeZipName(bytes: Uint8Array, flags: number): string {
  if ((flags & 0x0800) !== 0) {
    try {
      return utf8.decode(bytes)
    } catch {
      throw new PreviewParseError('invalid', 'ZIP entry name is not valid UTF-8')
    }
  }

  return Array.from(bytes, byte =>
    byte < 0x80 ? String.fromCharCode(byte) : cp437High[byte - 0x80]
  ).join('')
}

function refused(error: unknown): PreviewRefusal {
  return error instanceof PreviewParseError
    ? { detail: error.message, reason: error.reason, type: 'refused' }
    : { detail: error instanceof Error ? error.message : String(error), reason: 'invalid', type: 'refused' }
}

function limit(condition: boolean, detail: string): void {
  if (condition) {
    throw new PreviewParseError('limit', detail)
  }
}

function invalid(condition: boolean, detail: string): void {
  if (condition) {
    throw new PreviewParseError('invalid', detail)
  }
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function parseZip(bytes: Uint8Array): ZipEntry[] {
  limit(bytes.byteLength > FILE_PREVIEW_LIMITS.packageBytes, 'Package exceeds the preview byte limit')
  invalid(bytes.byteLength < 22, 'Invalid ZIP package')

  const data = view(bytes)
  const searchStart = Math.max(0, bytes.byteLength - 22 - 65_535)
  let eocd = -1

  for (let offset = bytes.byteLength - 22; offset >= searchStart; offset -= 1) {
    if (data.getUint32(offset, true) === 0x06054b50) {
      eocd = offset

      break
    }
  }

  invalid(eocd < 0, 'ZIP end record is missing')
  invalid(
    data.getUint16(eocd + 4, true) !== 0 || data.getUint16(eocd + 6, true) !== 0,
    'Split ZIP files are unsupported'
  )

  const entryCount = data.getUint16(eocd + 10, true)
  const directorySize = data.getUint32(eocd + 12, true)
  const directoryOffset = data.getUint32(eocd + 16, true)
  const commentLength = data.getUint16(eocd + 20, true)

  invalid(eocd + 22 + commentLength !== bytes.byteLength, 'Invalid ZIP end record')
  invalid(data.getUint16(eocd + 8, true) !== entryCount, 'Inconsistent ZIP entry count')

  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw new PreviewParseError('unsupported', 'ZIP64 packages are unsupported')
  }

  limit(entryCount > FILE_PREVIEW_LIMITS.zipEntries, 'ZIP contains too many entries')
  limit(directorySize > FILE_PREVIEW_LIMITS.zipDirectoryBytes, 'ZIP directory exceeds the preview limit')
  invalid(directoryOffset + directorySize !== eocd, 'Invalid ZIP directory bounds')

  const entries: ZipEntry[] = []
  const names = new Set<string>()
  let offset = directoryOffset

  for (let index = 0; index < entryCount; index += 1) {
    invalid(offset + 46 > eocd || data.getUint32(offset, true) !== 0x02014b50, 'Invalid ZIP directory entry')

    const flags = data.getUint16(offset + 8, true)
    const compression = data.getUint16(offset + 10, true)
    const compressedSize = data.getUint32(offset + 20, true)
    const uncompressedSize = data.getUint32(offset + 24, true)
    const nameLength = data.getUint16(offset + 28, true)
    const extraLength = data.getUint16(offset + 30, true)
    const entryCommentLength = data.getUint16(offset + 32, true)
    const diskStart = data.getUint16(offset + 34, true)
    const localOffset = data.getUint32(offset + 42, true)
    const next = offset + 46 + nameLength + extraLength + entryCommentLength

    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new PreviewParseError('unsupported', 'ZIP64 entries are unsupported')
    }

    if ((flags & 1) !== 0) {
      throw new PreviewParseError('unsupported', 'Encrypted ZIP entries are unsupported')
    }

    if (compression !== 0 && compression !== 8) {
      throw new PreviewParseError('unsupported', `ZIP compression method ${compression} is unsupported`)
    }

    invalid(diskStart !== 0 || next > eocd, 'Invalid ZIP directory entry bounds')
    limit(nameLength > FILE_PREVIEW_LIMITS.zipNameBytes, 'ZIP entry name exceeds the preview limit')

    const name = decodeZipName(bytes.subarray(offset + 46, offset + 46 + nameLength), flags).replace(/\\/g, '/')

    invalid(
      !name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').some(part => part === '..'),
      `Unsafe ZIP entry name: ${name || '(empty)'}`
    )
    invalid(names.has(name), `Duplicate ZIP entry name: ${name}`)
    names.add(name)

    invalid(
      localOffset + 30 > directoryOffset || data.getUint32(localOffset, true) !== 0x04034b50,
      'Invalid ZIP local header'
    )
    const localFlags = data.getUint16(localOffset + 6, true)
    const localCompression = data.getUint16(localOffset + 8, true)
    const localNameLength = data.getUint16(localOffset + 26, true)
    const localExtraLength = data.getUint16(localOffset + 28, true)
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength

    invalid(localFlags !== flags || localCompression !== compression, 'ZIP headers disagree')
    invalid(dataOffset + compressedSize > directoryOffset, 'ZIP member exceeds package bounds')

    entries.push({
      compressedSize,
      compression: compression as 0 | 8,
      dataOffset,
      localOffset,
      name,
      uncompressedSize
    })
    offset = next
  }

  invalid(offset !== eocd, 'ZIP directory size does not match its entries')

  const ranges = entries
    .map(entry => [entry.localOffset, entry.dataOffset + entry.compressedSize] as const)
    .sort((left, right) => left[0] - right[0])

  for (let index = 1; index < ranges.length; index += 1) {
    invalid(ranges[index][0] < ranges[index - 1][1], 'ZIP member ranges overlap')
  }

  return entries
}

async function inflateEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
  budget: { total: number },
  perEntryLimit = FILE_PREVIEW_LIMITS.officeEntryBytes
): Promise<Uint8Array> {
  limit(entry.uncompressedSize > perEntryLimit, `${entry.name} exceeds the inflated-entry limit`)
  limit(
    budget.total + entry.uncompressedSize > FILE_PREVIEW_LIMITS.officeInflatedBytes,
    'Package exceeds the inflated-byte limit'
  )

  const compressed = bytes.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize)

  if (entry.compression === 0) {
    invalid(compressed.byteLength !== entry.uncompressedSize, `Stored ZIP entry size mismatch: ${entry.name}`)
    budget.total += compressed.byteLength

    return compressed.slice()
  }

  const chunks: Uint8Array[] = []
  let outputSize = 0

  const inflater = new Inflate((chunk, _final) => {
    outputSize += chunk.byteLength
    limit(outputSize > perEntryLimit, `${entry.name} exceeds the inflated-entry limit`)
    limit(
      budget.total + outputSize > FILE_PREVIEW_LIMITS.officeInflatedBytes,
      'Package exceeds the inflated-byte limit'
    )
    chunks.push(chunk)
  })

  try {
    const inputChunkBytes = 1024

    for (let offset = 0; offset < compressed.byteLength; offset += inputChunkBytes) {
      const next = Math.min(offset + inputChunkBytes, compressed.byteLength)
      inflater.push(compressed.subarray(offset, next), next === compressed.byteLength)
    }
  } catch (error) {
    if (error instanceof PreviewParseError) {
      throw error
    }

    throw new PreviewParseError('invalid', `Could not inflate ${entry.name}`)
  }

  invalid(outputSize !== entry.uncompressedSize, `Inflated ZIP entry size mismatch: ${entry.name}`)
  budget.total += outputSize

  const output = new Uint8Array(outputSize)
  let outputOffset = 0

  for (const chunk of chunks) {
    output.set(chunk, outputOffset)
    outputOffset += chunk.byteLength
  }

  return output
}

function decodeXml(bytes: Uint8Array, name: string): string {
  try {
    return xmlUtf8.decode(bytes)
  } catch {
    throw new PreviewParseError('invalid', `${name} is not valid UTF-8 XML`)
  }
}

function decodeXmlText(value: string): string {
  return value.replace(/&(?:#x[0-9a-f]+|#[0-9]+|amp|apos|gt|lt|quot);/gi, entity => {
    if (entity[1] === '#') {
      const hex = entity[2]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10)

      if (!Number.isSafeInteger(codePoint) || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        throw new PreviewParseError('invalid', 'Invalid XML character reference')
      }

      return String.fromCodePoint(codePoint)
    }

    return { amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' }[entity.slice(1, -1).toLowerCase()] || entity
  })
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  let offset = 0

  while (offset < source.length) {
    while (/\s/.test(source[offset] || '')) {offset += 1}

    if (offset === source.length) {break}
    invalid(!/[A-Za-z_]/.test(source[offset]), 'Malformed XML attributes')
    const nameStart = offset
    offset += 1

    while (/[\w:.-]/.test(source[offset] || '')) {offset += 1}
    const name = source.slice(nameStart, offset)

    while (/\s/.test(source[offset] || '')) {offset += 1}
    invalid(source[offset] !== '=', 'Malformed XML attributes')
    offset += 1

    while (/\s/.test(source[offset] || '')) {offset += 1}
    const quote = source[offset]
    invalid(quote !== '"' && quote !== "'", 'Malformed XML attributes')
    offset += 1
    const valueStart = offset

    while (offset < source.length && source[offset] !== quote) {offset += 1}
    invalid(offset === source.length, 'Malformed XML attributes')
    attributes[name] = decodeXmlText(source.slice(valueStart, offset))
    offset += 1
  }

  return attributes
}

function scanXml(xml: string, handlers: XmlHandlers = {}): void {
  invalid(/<!DOCTYPE|<!ENTITY/i.test(xml), 'XML declarations with entities are unsupported')
  let offset = 0
  let depth = 0
  let nodes = 0
  const stack: string[] = []

  while (offset < xml.length) {
    const open = xml.indexOf('<', offset)

    if (open < 0) {
      if (offset < xml.length) {handlers.text?.(decodeXmlText(xml.slice(offset)))}

      break
    }

    if (open > offset) {handlers.text?.(decodeXmlText(xml.slice(offset, open)))}

    if (xml.startsWith('<!--', open)) {
      const end = xml.indexOf('-->', open + 4)
      invalid(end < 0, 'Unclosed XML comment')
      offset = end + 3

      continue
    }

    if (xml.startsWith('<?', open)) {
      const end = xml.indexOf('?>', open + 2)
      invalid(end < 0, 'Unclosed XML instruction')
      offset = end + 2

      continue
    }

    invalid(xml.startsWith('<!', open), 'Unsupported XML declaration')

    const end = xml.indexOf('>', open + 1)
    invalid(end < 0, 'Unclosed XML tag')
    let body = xml.slice(open + 1, end).trim()

    if (body.startsWith('/')) {
      const name = body.slice(1).trim()
      invalid(!/^[A-Za-z_][\w:.-]*$/.test(name) || stack.pop() !== name, 'Mismatched XML closing tag')
      handlers.close?.(name)
      depth -= 1
    } else {
      const selfClosing = body.endsWith('/')

      if (selfClosing) {body = body.slice(0, -1).trim()}
      const separator = body.search(/\s/)
      const name = separator < 0 ? body : body.slice(0, separator)
      const attributeSource = separator < 0 ? '' : body.slice(separator + 1)
      invalid(!/^[A-Za-z_][\w:.-]*$/.test(name), 'Malformed XML tag')
      nodes += 1
      limit(nodes > FILE_PREVIEW_LIMITS.officeXmlNodes, 'XML contains too many nodes')
      depth += 1
      limit(depth > FILE_PREVIEW_LIMITS.officeXmlDepth, 'XML nesting exceeds the preview limit')
      handlers.open?.(name, parseAttributes(attributeSource), selfClosing)

      if (selfClosing) {
        handlers.close?.(name)
        depth -= 1
      } else {
        stack.push(name)
      }
    }

    offset = end + 1
  }

  invalid(depth !== 0 || stack.length !== 0, 'Unclosed XML tag')
}

export function parseDelimitedPreview(source: string, delimiter: ',' | '\t'): ParseResult {
  try {
    const rows: string[][] = []
    const clipped = new Set<TablePreview['clipped'][number]>()
    let row: string[] = []
    let cell = ''
    let quoted = false
    let afterQuote = false
    let index = source.charCodeAt(0) === 0xfeff ? 1 : 0

    const pushCell = () => {
      if (cell.length > FILE_PREVIEW_LIMITS.tableCellCharacters) {clipped.add('cell-text')}

      if (row.length < FILE_PREVIEW_LIMITS.tableColumns) {
        row.push(cell.slice(0, FILE_PREVIEW_LIMITS.tableCellCharacters))
      } else {
        clipped.add('columns')
      }

      cell = ''
      afterQuote = false
    }

    const pushRow = () => {
      pushCell()

      if (rows.length < FILE_PREVIEW_LIMITS.tableRows) {rows.push(row)}
      else {clipped.add('rows')}

      row = []
    }

    while (index < source.length) {
      const char = source[index]

      if (quoted) {
        if (char === '"') {
          if (source[index + 1] === '"') {
            cell += '"'
            index += 2

            continue
          }

          quoted = false
          afterQuote = true
        } else {
          cell += char
        }

        index += 1

        continue
      }

      if (afterQuote && char !== delimiter && char !== '\r' && char !== '\n') {
        throw new PreviewParseError('invalid', 'Unexpected text after a closing quote')
      }

      if (char === '"' && cell.length === 0 && !afterQuote) {quoted = true}
      else if (char === delimiter) {pushCell()}
      else if (char === '\n') {pushRow()}
      else if (char === '\r') {
        if (source[index + 1] === '\n') {index += 1}
        pushRow()
      } else {cell += char}

      index += 1
    }

    invalid(quoted, 'Unclosed quoted field')

    if (cell.length > 0 || row.length > 0 || afterQuote || source.endsWith(delimiter)) {pushRow()}

    return { clipped: Array.from(clipped), rows, type: 'table' }
  } catch (error) {
    return refused(error)
  }
}

export async function listZipEntries(bytes: Uint8Array): Promise<ParseResult> {
  try {
    const entries = parseZip(bytes)

    return {
      clipped: entries.length > FILE_PREVIEW_LIMITS.zipVisibleEntries,
      entries: entries.slice(0, FILE_PREVIEW_LIMITS.zipVisibleEntries).map(entry => ({
        compressedSize: entry.compressedSize,
        name: entry.name,
        uncompressedSize: entry.uncompressedSize
      })),
      totalEntries: entries.length,
      type: 'archive'
    }
  } catch (error) {
    return refused(error)
  }
}

function extractText(xml: string, format: 'docx' | 'pptx'): string {
  const textTag = format === 'docx' ? 'w:t' : 'a:t'
  const paragraphTag = format === 'docx' ? 'w:p' : 'a:p'
  let capturing = false
  let text = ''
  scanXml(xml, {
    close(name) {
      if (name === textTag) {capturing = false}

      if (name === paragraphTag && text && !text.endsWith('\n')) {text += '\n'}
    },
    open(name) {
      if (name === textTag) {capturing = true}
      else if (format === 'docx' && name === 'w:tab') {text += '\t'}
      else if ((format === 'docx' && name === 'w:br') || (format === 'pptx' && name === 'a:br')) {text += '\n'}
    },
    text(value) {
      if (capturing) {text += value}
    }
  })

  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function parsePresentationOrder(xml: string): string[] {
  const ids: string[] = []
  const seen = new Set<string>()

  scanXml(xml, {
    open(name, attributes) {
      if (name !== 'p:sldId') {return}
      const id = attributes['r:id']

      invalid(!id, 'PPTX slide metadata is incomplete')
      invalid(seen.has(id), `Duplicate PPTX slide relationship: ${id}`)
      seen.add(id)
      ids.push(id)
    }
  })
  invalid(ids.length === 0, 'PPTX contains no slides')
  limit(ids.length > FILE_PREVIEW_LIMITS.presentationSlides, 'PPTX contains too many slides')

  return ids
}

function parsePresentationRelationships(xml: string): Map<string, { external: boolean; target: string }> {
  const relationships = new Map<string, { external: boolean; target: string }>()

  scanXml(xml, {
    open(name, attributes) {
      if (name !== 'Relationship') {return}
      const id = attributes.Id
      const target = attributes.Target

      if (!id || !target) {return}
      invalid(relationships.has(id), `Duplicate PPTX relationship: ${id}`)
      relationships.set(id, {
        external: attributes.TargetMode?.toLowerCase() === 'external',
        target: target.replace(/\\/g, '/')
      })
    }
  })

  return relationships
}

export async function parseOfficePreview(bytes: Uint8Array, format: 'docx' | 'pptx'): Promise<ParseResult> {
  try {
    const entries = parseZip(bytes)
    const byName = new Map(entries.map(entry => [entry.name, entry]))
    const budget = { total: 0 }
    const sections: DocumentPreview['sections'] = []
    let clipped = false
    let characters = 0

    const addSection = async (entry: ZipEntry, title?: string) => {
      const xml = decodeXml(await inflateEntry(bytes, entry, budget), entry.name)
      let text = extractText(xml, format)

      if (characters + text.length > FILE_PREVIEW_LIMITS.documentCharacters) {
        text = text.slice(0, Math.max(0, FILE_PREVIEW_LIMITS.documentCharacters - characters))
        clipped = true
      }

      characters += text.length
      sections.push({ text, ...(title ? { title } : {}) })
    }

    if (format === 'docx') {
      const document = byName.get('word/document.xml')

      if (!document) {throw new PreviewParseError('invalid', 'DOCX document XML is missing')}
      await addSection(document)
    } else {
      const presentation = byName.get('ppt/presentation.xml')
      const relationshipPart = byName.get('ppt/_rels/presentation.xml.rels')
      let slides: ZipEntry[]

      if (presentation || relationshipPart) {
        if (!presentation || !relationshipPart) {
          throw new PreviewParseError('invalid', 'PPTX presentation metadata is incomplete')
        }
        const order = parsePresentationOrder(
          decodeXml(await inflateEntry(bytes, presentation, budget), presentation.name)
        )
        const relationships = parsePresentationRelationships(
          decodeXml(await inflateEntry(bytes, relationshipPart, budget), relationshipPart.name)
        )
        const seen = new Set<string>()

        slides = order.map(id => {
          const relationship = relationships.get(id)

          if (!relationship || relationship.external) {
            throw new PreviewParseError('invalid', `PPTX slide relationship is missing: ${id}`)
          }
          const target = relationship.target.replace(/^\.\//, '')
          invalid(
            target.startsWith('/') || target.split('/').some(part => part === '..') || !/^slides\/slide\d+\.xml$/.test(target),
            'Unsafe PPTX slide relationship target'
          )
          const name = `ppt/${target}`
          invalid(seen.has(name), `Duplicate PPTX slide target: ${name}`)
          seen.add(name)
          const entry = byName.get(name)

          if (!entry) {throw new PreviewParseError('invalid', `PPTX slide is missing: ${name}`)}

          return entry
        })
      } else {
        slides = entries
          .filter(entry => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
          .sort((left, right) => {
            const leftNumber = Number(/\d+/.exec(left.name)?.[0])
            const rightNumber = Number(/\d+/.exec(right.name)?.[0])

            return leftNumber - rightNumber
          })
        invalid(slides.length === 0, 'PPTX contains no slides')
        limit(slides.length > FILE_PREVIEW_LIMITS.presentationSlides, 'PPTX contains too many slides')
      }

      for (const [index, entry] of slides.entries()) {await addSection(entry, `Slide ${index + 1}`)}
    }

    return { clipped, format, sections, type: 'document' }
  } catch (error) {
    return refused(error)
  }
}

function columnNumber(reference: string): { column: number; row: number } {
  const match = /^([A-Z]{1,4})([1-9]\d*)$/.exec(reference)

  if (!match) {throw new PreviewParseError('invalid', `Invalid worksheet cell reference: ${reference}`)}
  let column = 0

  for (const char of match[1]) {column = column * 26 + char.charCodeAt(0) - 64}

  return { column, row: Number(match[2]) }
}

function validateWorksheet(xml: string): void {
  let cells = 0
  let maxColumn = 0
  let maxRow = 0
  const rows = new Set<number>()
  const columns = new Set<number>()

  scanXml(xml, {
    open(name, attributes) {
      if (name === 'row') {
        const row = Number(attributes.r)

        invalid(!Number.isSafeInteger(row) || row < 1, 'Invalid worksheet row reference')
        limit(row > FILE_PREVIEW_LIMITS.workbookInputRows, 'Worksheet row exceeds the preview limit')

        return
      }

      if (name !== 'c') {return}
      const { column, row } = columnNumber(attributes.r || '')
      cells += 1
      rows.add(row)
      columns.add(column)
      maxColumn = Math.max(maxColumn, column)
      maxRow = Math.max(maxRow, row)
      limit(row > FILE_PREVIEW_LIMITS.workbookInputRows, 'Worksheet row exceeds the preview limit')
      limit(column > FILE_PREVIEW_LIMITS.workbookInputColumns, 'Worksheet column exceeds the preview limit')
      limit(cells > FILE_PREVIEW_LIMITS.workbookInputRectangleCells, 'Worksheet contains too many cells')
      limit(
        maxRow * maxColumn > FILE_PREVIEW_LIMITS.workbookInputRectangleCells,
        'Worksheet dense rectangle exceeds the preview limit'
      )
    }
  })
  limit(rows.size > FILE_PREVIEW_LIMITS.workbookInputRows, 'Worksheet contains too many occupied rows')
  limit(columns.size > FILE_PREVIEW_LIMITS.workbookInputColumns, 'Worksheet contains too many occupied columns')
}

function parseWorkbook(xml: string): Array<{ id: string; name: string }> {
  const sheets: Array<{ id: string; name: string }> = []
  scanXml(xml, {
    open(name, attributes) {
      if (name === 'sheet') {
        invalid(!attributes.name || !attributes['r:id'], 'Workbook sheet metadata is incomplete')
        sheets.push({ id: attributes['r:id'], name: attributes.name })
      }
    }
  })
  invalid(sheets.length === 0, 'Workbook contains no sheets')
  limit(sheets.length > FILE_PREVIEW_LIMITS.workbookSheets, 'Workbook contains too many sheets')

  return sheets
}

function parseRelationships(xml: string): Map<string, string> {
  const relationships = new Map<string, string>()
  scanXml(xml, {
    open(name, attributes) {
      if (name !== 'Relationship') {return}

      if (attributes.TargetMode?.toLowerCase() === 'external') {return}
      const id = attributes.Id
      const target = attributes.Target?.replace(/\\/g, '/')

      if (!id || !target) {return}
      invalid(
        target.startsWith('/') || target.split('/').some(part => part === '..'),
        'Unsafe Office relationship target'
      )
      relationships.set(id, target)
    }
  })

  return relationships
}

function clipTableRows(rows: unknown[][]): Pick<TablePreview, 'clipped' | 'rows'> {
  const clipped = new Set<TablePreview['clipped'][number]>()

  if (rows.length > FILE_PREVIEW_LIMITS.tableRows) {clipped.add('rows')}

  const output = rows.slice(0, FILE_PREVIEW_LIMITS.tableRows).map(row => {
    if (row.length > FILE_PREVIEW_LIMITS.tableColumns) {clipped.add('columns')}

    return row.slice(0, FILE_PREVIEW_LIMITS.tableColumns).map(value => {
      const text = value == null ? '' : String(value)

      if (text.length > FILE_PREVIEW_LIMITS.tableCellCharacters) {clipped.add('cell-text')}

      return text.slice(0, FILE_PREVIEW_LIMITS.tableCellCharacters)
    })
  })

  return { clipped: Array.from(clipped), rows: output }
}

export async function parseXlsxPreview(
  bytes: Uint8Array,
  selectedSheet: number,
  reader: XlsxReader
): Promise<ParseResult> {
  try {
    const entries = parseZip(bytes)
    const byName = new Map(entries.map(entry => [entry.name, entry]))
    const budget = { total: 0 }

    const inflateXml = async (name: string): Promise<string> => {
      const entry = byName.get(name)

      if (!entry) {throw new PreviewParseError('invalid', `XLSX part is missing: ${name}`)}
      const xml = decodeXml(await inflateEntry(bytes, entry, budget), name)
      scanXml(xml)

      return xml
    }

    const workbookXml = await inflateXml('xl/workbook.xml')
    const relationshipsXml = await inflateXml('xl/_rels/workbook.xml.rels')
    const sheets = parseWorkbook(workbookXml)
    invalid(
      !Number.isInteger(selectedSheet) || selectedSheet < 0 || selectedSheet >= sheets.length,
      'Selected worksheet does not exist'
    )
    const relationships = parseRelationships(relationshipsXml)
    const target = relationships.get(sheets[selectedSheet].id)

    if (!target) {throw new PreviewParseError('invalid', 'Selected worksheet relationship is missing')}
    const worksheetName = `xl/${target.replace(/^\.\//, '')}`
    const worksheetXml = await inflateXml(worksheetName)
    validateWorksheet(worksheetXml)

    const validatedParts: Record<string, Uint8Array> = {}

    for (const name of ['[Content_Types].xml', '_rels/.rels']) {
      const entry = byName.get(name)

      if (!entry) {throw new PreviewParseError('invalid', `XLSX part is missing: ${name}`)}
      const part = await inflateEntry(bytes, entry, budget)
      scanXml(decodeXml(part, name))
      validatedParts[name] = part
    }

    validatedParts['xl/workbook.xml'] = encodeXml(workbookXml)
    validatedParts['xl/_rels/workbook.xml.rels'] = encodeXml(relationshipsXml)
    validatedParts[worksheetName] = encodeXml(worksheetXml)

    for (const optional of ['xl/sharedStrings.xml', 'xl/styles.xml']) {
      const entry = byName.get(optional)

      if (!entry) {continue}
      const part = await inflateEntry(bytes, entry, budget)
      const xml = decodeXml(part, optional)
      let sharedStrings = 0
      scanXml(xml, {
        open(name) {
          if (optional === 'xl/sharedStrings.xml' && name === 'si') {
            sharedStrings += 1
            limit(sharedStrings > FILE_PREVIEW_LIMITS.sharedStrings, 'Workbook contains too many shared strings')
          }
        }
      })
      validatedParts[optional] = part
    }

    const rebuilt = zipSync(validatedParts)
    const rows = await reader(rebuilt, selectedSheet + 1)
    const clipped = clipTableRows(rows)

    return { ...clipped, selectedSheet, sheets: sheets.map(sheet => sheet.name), type: 'table' }
  } catch (error) {
    return refused(error)
  }
}

function encodeXml(value: string): Uint8Array {
  return new TextEncoder().encode(value)
}
