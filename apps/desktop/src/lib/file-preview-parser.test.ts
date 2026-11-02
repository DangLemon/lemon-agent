import { FILE_PREVIEW_LIMITS } from '@lemon-ai/shared/file-preview-format'
import { zipSync } from 'fflate'
import { readSheet } from 'read-excel-file/browser'
import { describe, expect, it, vi } from 'vitest'

import {
  listZipEntries,
  parseDelimitedPreview,
  parseOfficePreview,
  parseXlsxPreview,
  type XlsxReader
} from './file-preview-parser'

const encode = (value: string) => new TextEncoder().encode(value)

function packageBytes(parts: Record<string, string | Uint8Array>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(parts).map(([name, value]) => [name, typeof value === 'string' ? encode(value) : value])
    )
  )
}

function storedPackageBytes(parts: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, encode(value)])), { level: 0 })
}

function zipLayout(bytes: Uint8Array): {
  centralOffsets: number[]
  data: DataView
  eocd: number
  localOffsets: number[]
} {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1

  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (data.getUint32(offset, true) === 0x06054b50) {
      eocd = offset

      break
    }
  }

  if (eocd < 0) {
    throw new Error('ZIP end record is missing')
  }

  const centralOffsets: number[] = []
  const localOffsets: number[] = []
  const count = data.getUint16(eocd + 10, true)
  let offset = data.getUint32(eocd + 16, true)

  for (let index = 0; index < count; index += 1) {
    centralOffsets.push(offset)
    localOffsets.push(data.getUint32(offset + 42, true))
    offset +=
      46 +
      data.getUint16(offset + 28, true) +
      data.getUint16(offset + 30, true) +
      data.getUint16(offset + 32, true)
  }

  return { centralOffsets, data, eocd, localOffsets }
}

function mutateZip(bytes: Uint8Array, mutate: (layout: ReturnType<typeof zipLayout>) => void): Uint8Array {
  const output = bytes.slice()

  mutate(zipLayout(output))

  return output
}

function lieAboutFirstEntrySize(bytes: Uint8Array, uncompressedSize: number): Uint8Array {
  return mutateZip(bytes, ({ centralOffsets, data }) => {
    data.setUint32(centralOffsets[0] + 24, uncompressedSize, true)
  })
}

function corruptFirstEntry(bytes: Uint8Array): Uint8Array {
  return mutateZip(bytes, ({ data, localOffsets }) => {
    const localOffset = localOffsets[0]
    const dataOffset = localOffset + 30 + data.getUint16(localOffset + 26, true) + data.getUint16(localOffset + 28, true)
    data.setUint8(dataOffset, data.getUint8(dataOffset) ^ 0xff)
  })
}

function xlsxFixture(
  sheetXml: string,
  options: {
    omit?: string[]
    relationshipTarget?: string
    secondSheetXml?: string
    sharedStrings?: string
  } = {}
): Uint8Array {
  const sheets = options.secondSheetXml
    ? '<sheet name="Sheet One" sheetId="1" r:id="rId1"/><sheet name="Sheet Two" sheetId="2" r:id="rId2"/>'
    : '<sheet name="Sheet One" sheetId="1" r:id="rId1"/>'
  const relationships = options.secondSheetXml
    ? '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
    : `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${options.relationshipTarget || 'worksheets/sheet1.xml'}"/>`
  const parts: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`,
    'xl/worksheets/sheet1.xml': sheetXml
  }

  if (options.secondSheetXml) {
    parts['xl/worksheets/sheet2.xml'] = options.secondSheetXml
  }

  if (options.sharedStrings) {
    parts['xl/sharedStrings.xml'] = options.sharedStrings
  }

  for (const name of options.omit || []) {
    delete parts[name]
  }

  return packageBytes(parts)
}

const smallSheet =
  '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello</t></is></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>'

describe('delimited previews', () => {
  it('parses quotes, escaped quotes, CRLF, embedded newlines, and trailing empty fields', () => {
    const result = parseDelimitedPreview(
      '\uFEFFname,note,empty\r\n"Ada","line 1\nline 2",\r\n"=SUM(1,2)","say ""hi""",',
      ','
    )

    expect(result).toMatchObject({
      clipped: [],
      rows: [
        ['name', 'note', 'empty'],
        ['Ada', 'line 1\nline 2', ''],
        ['=SUM(1,2)', 'say "hi"', '']
      ],
      type: 'table'
    })
  })

  it('clips displayed rows, columns, and cell text to shared ceilings', () => {
    const row = Array.from({ length: FILE_PREVIEW_LIMITS.tableColumns + 1 }, (_, index) =>
      index === 0 ? 'x'.repeat(FILE_PREVIEW_LIMITS.tableCellCharacters + 1) : String(index)
    ).join('\t')

    const source = Array.from({ length: FILE_PREVIEW_LIMITS.tableRows + 1 }, () => row).join('\n')
    const result = parseDelimitedPreview(source, '\t')

    expect(result.type).toBe('table')

    if (result.type === 'table') {
      expect(result.rows).toHaveLength(FILE_PREVIEW_LIMITS.tableRows)
      expect(result.rows[0]).toHaveLength(FILE_PREVIEW_LIMITS.tableColumns)
      expect(result.rows[0]?.[0]).toHaveLength(FILE_PREVIEW_LIMITS.tableCellCharacters)
      expect(result.clipped).toEqual(expect.arrayContaining(['rows', 'columns', 'cell-text']))
    }
  })

  it.each([
    ['an unclosed quote', 'name,note\nAda,"unfinished'],
    ['text after a closing quote', 'name,note\nAda,"done"oops']
  ])('refuses %s', (_name, source) => {
    expect(parseDelimitedPreview(source, ',')).toMatchObject({
      reason: 'invalid',
      type: 'refused'
    })
  })
})

describe('ZIP previews', () => {
  it('lists metadata without inflating members', async () => {
    const bytes = packageBytes({ 'docs/readme.txt': 'hello', 'image.bin': new Uint8Array(64).fill(7) })

    await expect(listZipEntries(bytes)).resolves.toMatchObject({
      entries: [
        { compressedSize: expect.any(Number), name: 'docs/readme.txt', uncompressedSize: 5 },
        { compressedSize: expect.any(Number), name: 'image.bin', uncompressedSize: 64 }
      ],
      totalEntries: 2,
      type: 'archive'
    })
  })

  it.each(['../escape.txt', '/absolute.txt', 'C:\\absolute.txt'])('rejects unsafe entry name %s', async name => {
    await expect(listZipEntries(packageBytes({ [name]: 'x' }))).resolves.toMatchObject({
      reason: 'invalid',
      type: 'refused'
    })
  })

  it('decodes legacy CP437 entry names when the UTF-8 flag is clear', async () => {
    const bytes = mutateZip(packageBytes({ 'a.txt': 'x' }), ({ centralOffsets, data, localOffsets }) => {
      data.setUint16(centralOffsets[0] + 8, data.getUint16(centralOffsets[0] + 8, true) & ~0x0800, true)
      data.setUint16(localOffsets[0] + 6, data.getUint16(localOffsets[0] + 6, true) & ~0x0800, true)
      data.setUint8(centralOffsets[0] + 46, 0x82)
      data.setUint8(localOffsets[0] + 30, 0x82)
    })

    await expect(listZipEntries(bytes)).resolves.toMatchObject({
      entries: [{ name: 'é.txt' }],
      type: 'archive'
    })
  })

  it('refuses invalid UTF-8 entry names when the UTF-8 flag is set', async () => {
    const bytes = mutateZip(packageBytes({ 'a.txt': 'x' }), ({ centralOffsets, data, localOffsets }) => {
      data.setUint16(centralOffsets[0] + 8, data.getUint16(centralOffsets[0] + 8, true) | 0x0800, true)
      data.setUint16(localOffsets[0] + 6, data.getUint16(localOffsets[0] + 6, true) | 0x0800, true)
      data.setUint8(centralOffsets[0] + 46, 0x82)
      data.setUint8(localOffsets[0] + 30, 0x82)
    })

    await expect(listZipEntries(bytes)).resolves.toMatchObject({
      reason: 'invalid',
      type: 'refused'
    })
  })

  it('refuses packages larger than the byte limit', async () => {
    await expect(
      listZipEntries(new Uint8Array(FILE_PREVIEW_LIMITS.packageBytes + 1))
    ).resolves.toMatchObject({ reason: 'limit', type: 'refused' })
  })

  it('clips visible entries without losing the total count', async () => {
    const bytes = packageBytes(
      Object.fromEntries(
        Array.from({ length: FILE_PREVIEW_LIMITS.zipVisibleEntries + 1 }, (_, index) => [`${index}.txt`, ''])
      )
    )

    const result = await listZipEntries(bytes)

    expect(result).toMatchObject({
      clipped: true,
      totalEntries: FILE_PREVIEW_LIMITS.zipVisibleEntries + 1,
      type: 'archive'
    })

    if (result.type === 'archive') {
      expect(result.entries).toHaveLength(FILE_PREVIEW_LIMITS.zipVisibleEntries)
      expect(result.entries[0]?.name).toBe('0.txt')
    }
  })

  it.each([
    [
      'too many entries',
      packageBytes(
        Object.fromEntries(Array.from({ length: FILE_PREVIEW_LIMITS.zipEntries + 1 }, (_, index) => [`${index}`, '']))
      ),
      'limit'
    ],
    [
      'an oversized central directory',
      mutateZip(packageBytes({ 'a.txt': 'a' }), ({ data, eocd }) => {
        data.setUint32(eocd + 12, FILE_PREVIEW_LIMITS.zipDirectoryBytes + 1, true)
      }),
      'limit'
    ],
    ['a long entry name', packageBytes({ ['a'.repeat(FILE_PREVIEW_LIMITS.zipNameBytes + 1)]: '' }), 'limit'],
    [
      'an encrypted entry',
      mutateZip(packageBytes({ 'secret.txt': 'secret' }), ({ centralOffsets, data, localOffsets }) => {
        data.setUint16(centralOffsets[0] + 8, data.getUint16(centralOffsets[0] + 8, true) | 1, true)
        data.setUint16(localOffsets[0] + 6, data.getUint16(localOffsets[0] + 6, true) | 1, true)
      }),
      'unsupported'
    ],
    [
      'ZIP64 metadata',
      mutateZip(packageBytes({ 'a.txt': 'a' }), ({ data, eocd }) => {
        data.setUint16(eocd + 8, 0xffff, true)
        data.setUint16(eocd + 10, 0xffff, true)
      }),
      'unsupported'
    ],
    [
      'a split archive',
      mutateZip(packageBytes({ 'a.txt': 'a' }), ({ data, eocd }) => data.setUint16(eocd + 4, 1, true)),
      'invalid'
    ],
    [
      'an unsupported compression method',
      mutateZip(packageBytes({ 'a.txt': 'a' }), ({ centralOffsets, data, localOffsets }) => {
        data.setUint16(centralOffsets[0] + 10, 99, true)
        data.setUint16(localOffsets[0] + 8, 99, true)
      }),
      'unsupported'
    ],
    [
      'a duplicate entry name',
      mutateZip(packageBytes({ 'a.txt': 'a', 'b.txt': 'b' }), ({ centralOffsets, data, localOffsets }) => {
        data.setUint8(centralOffsets[1] + 46, 'a'.charCodeAt(0))
        data.setUint8(localOffsets[1] + 30, 'a'.charCodeAt(0))
      }),
      'invalid'
    ],
    [
      'an invalid local header',
      mutateZip(packageBytes({ 'a.txt': 'a' }), ({ data, localOffsets }) => data.setUint32(localOffsets[0], 0, true)),
      'invalid'
    ]
  ] as const)('refuses %s', async (_name, bytes, reason) => {
    await expect(listZipEntries(bytes)).resolves.toMatchObject({ reason, type: 'refused' })
  })
})

describe('Office previews', () => {
  it('extracts DOCX text in document order and treats markup as text', async () => {
    const bytes = packageBytes({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml':
        '<?xml version="1.0"?><w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello &amp; &lt;script&gt;</w:t></w:r></w:p><w:p><w:r><w:t>World</w:t></w:r></w:p></w:body></w:document>'
    })

    await expect(parseOfficePreview(bytes, 'docx')).resolves.toMatchObject({
      format: 'docx',
      sections: [{ text: 'Hello & <script>\nWorld' }],
      type: 'document'
    })
  })

  it('preserves explicit tabs and line breaks in DOCX text', async () => {
    const bytes = packageBytes({
      'word/document.xml':
        '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br/><w:t>C</w:t></w:r></w:p></w:body></w:document>'
    })

    await expect(parseOfficePreview(bytes, 'docx')).resolves.toMatchObject({
      sections: [{ text: 'A\tB\nC' }],
      type: 'document'
    })
  })

  it('extracts PPTX slide text in presentation order', async () => {
    const bytes = packageBytes({
      '[Content_Types].xml': '<Types/>',
      'ppt/presentation.xml':
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
      'ppt/slides/slide2.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>First shown</a:t></a:r></a:p></p:sld>',
      'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Second shown</a:t></a:r></a:p></p:sld>'
    })

    await expect(parseOfficePreview(bytes, 'pptx')).resolves.toMatchObject({
      format: 'pptx',
      sections: [
        { title: 'Slide 1', text: 'First shown' },
        { title: 'Slide 2', text: 'Second shown' }
      ],
      type: 'document'
    })
  })

  it('preserves explicit line breaks in PPTX text', async () => {
    const bytes = packageBytes({
      'ppt/presentation.xml':
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels':
        '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>',
      'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>A</a:t><a:br/><a:t>B</a:t></a:r></a:p></p:sld>'
    })

    await expect(parseOfficePreview(bytes, 'pptx')).resolves.toMatchObject({
      sections: [{ title: 'Slide 1', text: 'A\nB' }],
      type: 'document'
    })
  })

  it.each([
    ['a missing relationship', '<Relationships/>'],
    ['an external relationship', '<Relationships><Relationship Id="rId1" Target="https://example.test/slide.xml" TargetMode="External"/></Relationships>'],
    ['an unsafe target', '<Relationships><Relationship Id="rId1" Target="../escape.xml"/></Relationships>'],
    ['a duplicate relationship', '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId1" Target="slides/slide2.xml"/></Relationships>']
  ])('refuses PPTX presentation metadata with %s', async (_name, relationships) => {
    const bytes = packageBytes({
      'ppt/presentation.xml':
        '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
      'ppt/_rels/presentation.xml.rels': relationships,
      'ppt/slides/slide1.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:t>One</a:t></p:sld>',
      'ppt/slides/slide2.xml': '<p:sld xmlns:p="p" xmlns:a="a"><a:t>Two</a:t></p:sld>'
    })

    await expect(parseOfficePreview(bytes, 'pptx')).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
  })

  it('rejects entity declarations before parsing Office XML', async () => {
    const bytes = packageBytes({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml':
        '<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]><w:document xmlns:w="w"><w:t>&ext;</w:t></w:document>'
    })

    await expect(parseOfficePreview(bytes, 'docx')).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
  })

  it('rejects a long malformed attribute without stalling the parser', async () => {
    const bytes = packageBytes({
      'word/document.xml': `<w:document ${'a'.repeat(100_000)}></w:document>`
    })

    await expect(parseOfficePreview(bytes, 'docx')).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
  }, 2_000)

  it('refuses inflated output that exceeds the entry limit even when metadata understates its size', async () => {
    const oversizedDocument = `<w:document xmlns:w="w"><w:p><w:r><w:t>${'a'.repeat(FILE_PREVIEW_LIMITS.officeEntryBytes + 1)}</w:t></w:r></w:p></w:document>`
    const bytes = lieAboutFirstEntrySize(packageBytes({ 'word/document.xml': oversizedDocument }), 1)

    await expect(parseOfficePreview(bytes, 'docx')).resolves.toMatchObject({ reason: 'limit', type: 'refused' })
  })

  it('enforces the cumulative inflated-byte limit across slides', async () => {
    const slide = `<p:sld xmlns:p="p" xmlns:a="a"><a:t>${'a'.repeat(3_500_000)}</a:t></p:sld>`
    const bytes = packageBytes(
      Object.fromEntries(Array.from({ length: 5 }, (_, index) => [`ppt/slides/slide${index + 1}.xml`, slide]))
    )

    await expect(parseOfficePreview(bytes, 'pptx')).resolves.toMatchObject({ reason: 'limit', type: 'refused' })
  })

  it.each([
    ['stored', corruptFirstEntry(storedPackageBytes({ 'word/document.xml': '<w:document xmlns:w="w"><w:t>Hello</w:t></w:document>' }))],
    ['deflated', corruptFirstEntry(packageBytes({ 'word/document.xml': '<w:document xmlns:w="w"><w:t>Hello</w:t></w:document>' }))]
  ])('refuses a corrupt %s Office member', async (_name, bytes) => {
    await expect(parseOfficePreview(bytes, 'docx')).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
  })

  it.each([
    ['a DOCX without its document part', packageBytes({ '[Content_Types].xml': '<Types/>' }), 'docx'],
    ['a PPTX without slides', packageBytes({ '[Content_Types].xml': '<Types/>' }), 'pptx']
  ] as const)('refuses %s', async (_name, bytes, format) => {
    await expect(parseOfficePreview(bytes, format)).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
  })

  it.each([
    [
      'XML nesting',
      `<w:document xmlns:w="w">${'<w:p>'.repeat(FILE_PREVIEW_LIMITS.officeXmlDepth)}</w:p></w:document>`
    ],
    [
      'XML nodes',
      `<w:document xmlns:w="w">${'<w:p/>'.repeat(FILE_PREVIEW_LIMITS.officeXmlNodes)}</w:document>`
    ]
  ])('enforces the %s limit', async (_name, documentXml) => {
    await expect(parseOfficePreview(packageBytes({ 'word/document.xml': documentXml }), 'docx')).resolves.toMatchObject({
      reason: 'limit',
      type: 'refused'
    })
  })

  it('clips document text at the character limit', async () => {
    const text = 'a'.repeat(FILE_PREVIEW_LIMITS.documentCharacters + 1)
    const bytes = packageBytes({ 'word/document.xml': `<w:document xmlns:w="w"><w:t>${text}</w:t></w:document>` })
    const result = await parseOfficePreview(bytes, 'docx')

    expect(result).toMatchObject({ clipped: true, format: 'docx', type: 'document' })

    if (result.type === 'document') {
      expect(result.sections[0]?.text).toHaveLength(FILE_PREVIEW_LIMITS.documentCharacters)
    }
  })

  it('refuses presentations over the slide limit', async () => {
    const bytes = packageBytes(
      Object.fromEntries(
        Array.from({ length: FILE_PREVIEW_LIMITS.presentationSlides + 1 }, (_, index) => [
          `ppt/slides/slide${index + 1}.xml`,
          '<p:sld xmlns:p="p" xmlns:a="a"><a:t>x</a:t></p:sld>'
        ])
      )
    )

    await expect(parseOfficePreview(bytes, 'pptx')).resolves.toMatchObject({ reason: 'limit', type: 'refused' })
  })

  it.each([
    ['invalid UTF-8', new Uint8Array([0xff])],
    ['mismatched tags', encode('<w:document xmlns:w="w"><w:p></w:document>')],
    ['an invalid character reference', encode('<w:document xmlns:w="w"><w:t>&#x110000;</w:t></w:document>')]
  ])('refuses %s Office XML', async (_name, documentXml) => {
    await expect(
      parseOfficePreview(packageBytes({ 'word/document.xml': documentXml }), 'docx')
    ).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
  })
})

describe('XLSX previews', () => {
  it('passes only a rebuilt validated package to the XLSX reader', async () => {
    const original = xlsxFixture(smallSheet)
    const reader = vi.fn<XlsxReader>(async bytes => [['Hello', 42]])

    const result = await parseXlsxPreview(original, 0, reader)

    expect(result).toMatchObject({ rows: [['Hello', '42']], selectedSheet: 0, sheets: ['Sheet One'], type: 'table' })
    expect(reader).toHaveBeenCalledOnce()
    expect(reader.mock.calls[0]?.[0]).not.toBe(original)
  })

  it('opens the rebuilt package with read-excel-file', async () => {
    const result = await parseXlsxPreview(xlsxFixture(smallSheet), 0, async (bytes, sheet) =>
      readSheet(Uint8Array.from(bytes).buffer, sheet, {})
    )

    expect(result).toMatchObject({ rows: [['Hello', '42']], selectedSheet: 0, sheets: ['Sheet One'], type: 'table' })
  })

  it('opens a second sheet with shared strings through read-excel-file', async () => {
    const sharedStrings =
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>First sheet</t></si><si><t>Second sheet</t></si></sst>'
    const firstSheet =
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'
    const secondSheet =
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c></row></sheetData></worksheet>'
    const result = await parseXlsxPreview(
      xlsxFixture(firstSheet, { secondSheetXml: secondSheet, sharedStrings }),
      1,
      async (bytes, sheet) => readSheet(Uint8Array.from(bytes).buffer, sheet, {})
    )

    expect(result).toMatchObject({
      rows: [['Second sheet']],
      selectedSheet: 1,
      sheets: ['Sheet One', 'Sheet Two'],
      type: 'table'
    })
  })

  it('refuses sparse far-away cells before entering the XLSX dependency', async () => {
    const reader = vi.fn<XlsxReader>(async () => [])

    const sparse = xlsxFixture(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="2001"><c r="A2001"><v>1</v></c></row></sheetData></worksheet>'
    )

    await expect(parseXlsxPreview(sparse, 0, reader)).resolves.toMatchObject({ reason: 'limit', type: 'refused' })
    expect(reader).not.toHaveBeenCalled()
  })

  it('refuses sparse far-away empty rows before entering the XLSX dependency', async () => {
    const reader = vi.fn<XlsxReader>(async () => [])
    const sparse = xlsxFixture(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1000000000"/></sheetData></worksheet>'
    )

    await expect(parseXlsxPreview(sparse, 0, reader)).resolves.toMatchObject({ reason: 'limit', type: 'refused' })
    expect(reader).not.toHaveBeenCalled()
  })

  it('refuses invalid cell references before entering the XLSX dependency', async () => {
    const reader = vi.fn<XlsxReader>(async () => [])
    const bytes = xlsxFixture(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A0"><v>1</v></c></row></sheetData></worksheet>'
    )

    await expect(parseXlsxPreview(bytes, 0, reader)).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
    expect(reader).not.toHaveBeenCalled()
  })

  it.each([
    ['column count', '<row r="1"><c r="DY1"><v>1</v></c></row>'],
    ['dense rectangle', '<row r="1"><c r="AY1"><v>1</v></c></row><row r="2000"><c r="A2000"><v>1</v></c></row>']
  ])('refuses worksheet %s beyond the input limits', async (_name, rows) => {
    const reader = vi.fn<XlsxReader>(async () => [])
    const bytes = xlsxFixture(
      `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`
    )

    await expect(parseXlsxPreview(bytes, 0, reader)).resolves.toMatchObject({ reason: 'limit', type: 'refused' })
    expect(reader).not.toHaveBeenCalled()
  })

  it('enforces workbook sheet and shared-string limits before reading cells', async () => {
    const reader = vi.fn<XlsxReader>(async () => [])
    const sheetTags = Array.from({ length: FILE_PREVIEW_LIMITS.workbookSheets + 1 }, (_, index) =>
      `<sheet name="S${index}" sheetId="${index + 1}" r:id="rId1"/>`
    ).join('')
    const oversizedWorkbook = xlsxFixture(smallSheet, {
      sharedStrings: `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${'<si><t>x</t></si>'.repeat(FILE_PREVIEW_LIMITS.sharedStrings + 1)}</sst>`
    })
    const workbookXml = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetTags}</sheets></workbook>`
    const sheetsPackage = packageBytes({
      '[Content_Types].xml': '<Types/>',
      '_rels/.rels': '<Relationships/>',
      'xl/workbook.xml': workbookXml,
      'xl/_rels/workbook.xml.rels': '<Relationships/>'
    })

    await expect(parseXlsxPreview(sheetsPackage, 0, reader)).resolves.toMatchObject({ reason: 'limit', type: 'refused' })
    await expect(parseXlsxPreview(oversizedWorkbook, 0, reader)).resolves.toMatchObject({ reason: 'limit', type: 'refused' })
    expect(reader).not.toHaveBeenCalled()
  })

  it.each([
    ['content types', xlsxFixture(smallSheet, { omit: ['[Content_Types].xml'] })],
    ['package relationships', xlsxFixture(smallSheet, { omit: ['_rels/.rels'] })],
    ['worksheet part', xlsxFixture(smallSheet, { omit: ['xl/worksheets/sheet1.xml'] })],
    ['unsafe worksheet target', xlsxFixture(smallSheet, { relationshipTarget: '../escape.xml' })]
  ])('refuses a package with missing or unsafe %s', async (_name, bytes) => {
    const reader = vi.fn<XlsxReader>(async () => [])

    await expect(parseXlsxPreview(bytes, 0, reader)).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
    expect(reader).not.toHaveBeenCalled()
  })

  it('refuses missing and external worksheet relationships', async () => {
    const reader = vi.fn<XlsxReader>(async () => [])
    const missing = xlsxFixture(smallSheet)
    const external = packageBytes({
      '[Content_Types].xml': '<Types/>',
      '_rels/.rels': '<Relationships/>',
      'xl/workbook.xml':
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet One" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels':
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="https://example.test/sheet.xml" TargetMode="External"/></Relationships>'
    })
    const withoutRelationships = packageBytes(
      Object.fromEntries(
        Object.entries({
          '[Content_Types].xml': '<Types/>',
          '_rels/.rels': '<Relationships/>',
          'xl/workbook.xml':
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets/></workbook>'
        })
      )
    )

    await expect(parseXlsxPreview(withoutRelationships, 0, reader)).resolves.toMatchObject({
      reason: 'invalid',
      type: 'refused'
    })
    await expect(parseXlsxPreview(external, 0, reader)).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
    await expect(parseXlsxPreview(missing, 1, reader)).resolves.toMatchObject({ reason: 'invalid', type: 'refused' })
    expect(reader).not.toHaveBeenCalled()
  })

  it('returns a refusal when the XLSX reader rejects the validated package', async () => {
    await expect(
      parseXlsxPreview(xlsxFixture(smallSheet), 0, async () => {
        throw new Error('reader failed')
      })
    ).resolves.toMatchObject({ detail: 'reader failed', reason: 'invalid', type: 'refused' })
  })

  it('clips XLSX reader rows, columns, and cell text', async () => {
    const oversizedRows = Array.from({ length: FILE_PREVIEW_LIMITS.tableRows + 1 }, () =>
      Array.from({ length: FILE_PREVIEW_LIMITS.tableColumns + 1 }, (_, index) =>
        index === 0 ? 'x'.repeat(FILE_PREVIEW_LIMITS.tableCellCharacters + 1) : index
      )
    )
    const result = await parseXlsxPreview(xlsxFixture(smallSheet), 0, async () => oversizedRows)

    expect(result.type).toBe('table')

    if (result.type === 'table') {
      expect(result.rows).toHaveLength(FILE_PREVIEW_LIMITS.tableRows)
      expect(result.rows[0]).toHaveLength(FILE_PREVIEW_LIMITS.tableColumns)
      expect(result.rows[0]?.[0]).toHaveLength(FILE_PREVIEW_LIMITS.tableCellCharacters)
      expect(result.clipped).toEqual(expect.arrayContaining(['rows', 'columns', 'cell-text']))
    }
  })
})
