import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'

import { zipSync } from 'fflate'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  type MockBackendFixture,
  type Sandbox,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig
} from './fixtures'
import { startMockServer } from './mock-server'
import { type ElectronApplication, expect, type Page, test } from './test'

const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..')
const REMOTE_ID = 'preview-remote'
const REMOTE_LABEL = 'Preview remote'
const REMOTE_TOKEN = 'e2e-preview-remote-token'

const encode = (value: string) => new TextEncoder().encode(value)

function writePackage(filePath: string, parts: Record<string, string>): void {
  fs.writeFileSync(
    filePath,
    zipSync(Object.fromEntries(Object.entries(parts).map(([name, value]) => [name, encode(value)])))
  )
}

function writeWav(filePath: string): void {
  const samples = 800
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(8_000, 24)
  buffer.writeUInt32LE(16_000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  fs.writeFileSync(filePath, buffer)
}

function writeLocalFixtures(root: string): Record<string, string> {
  const files = Object.fromEntries(
    ['csv', 'tsv', 'xlsx', 'zip', 'docx', 'pptx', 'wav', 'mp4'].map(extension => [
      extension,
      path.join(root, `preview.${extension}`)
    ])
  )

  fs.writeFileSync(files.csv, 'name,value\nCSV alpha,42\n', 'utf8')
  fs.writeFileSync(files.tsv, 'name\tvalue\nTSV beta\t7\n', 'utf8')
  writePackage(files.zip, { 'docs/runtime-entry.txt': 'runtime ZIP entry' })
  writePackage(files.docx, {
    'word/document.xml':
      '<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body><w:p><w:r><w:t>Runtime DOCX text</w:t></w:r></w:p></w:body></w:document>'
  })
  writePackage(files.pptx, {
    'ppt/slides/slide1.xml':
      '<?xml version="1.0"?><p:sld xmlns:p="urn:p" xmlns:a="urn:a"><p:cSld><a:p><a:r><a:t>Runtime PPTX text</a:t></a:r></a:p></p:cSld></p:sld>'
  })
  writePackage(files.xlsx, {
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet One" sheetId="1" r:id="rId1"/><sheet name="Sheet Two" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Runtime XLSX first</t></is></c></row></sheetData></worksheet>',
    'xl/worksheets/sheet2.xml':
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>',
    'xl/sharedStrings.xml':
      '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Runtime XLSX second</t></si></sst>'
  })
  writeWav(files.wav)
  fs.writeFileSync(
    files.mp4,
    Buffer.from(
      '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',
      'base64'
    )
  )

  return files
}

function findLemonBinary(): string {
  const venv = path.join(REPO_ROOT, '.venv', 'bin', 'lemon')

  if (fs.existsSync(venv)) {
    return venv
  }

  const result = spawnSync('which', ['lemon'], { encoding: 'utf8' })

  if (result.status === 0 && result.stdout.trim()) {
    return result.stdout.trim()
  }

  throw new Error('lemon binary not found')
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate a remote gateway port'))

        return
      }

      server.close(() => resolve(address.port))
    })
  })
}

async function startRemoteGateway(root: string, fixtureRoot: string, mockUrl: string) {
  const home = path.join(root, 'remote-home')
  fs.mkdirSync(home, { recursive: true })
  writeMockProviderConfig(home, mockUrl, undefined, `terminal:\n  cwd: ${fixtureRoot}`)
  writeEnvFile(home)
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`

  const child: ChildProcess = spawn(
    findLemonBinary(),
    ['serve', '--host', '127.0.0.1', '--port', String(port), '--skip-build'],
    {
      cwd: REPO_ROOT,
      detached: true,
      env: {
        ...process.env,
        LEMON_DASHBOARD_FILES_ROOT: fixtureRoot,
        LEMON_DASHBOARD_SESSION_TOKEN: REMOTE_TOKEN,
        LEMON_HOME: home
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )

  const stop = () => {
    if (!child.pid || child.exitCode !== null) {
      return
    }

    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
  let log = ''
  child.stdout?.on('data', chunk => {
    log += String(chunk)
  })
  child.stderr?.on('data', chunk => {
    log += String(chunk)
  })
  const deadline = Date.now() + 90_000

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`remote lemon serve exited early (${child.exitCode}):\n${log}`)
    }

    try {
      const response = await fetch(`${url}/api/status`, {
        headers: { 'X-Lemon-Session-Token': REMOTE_TOKEN }
      })

      if (response.ok) {
        return {
          close: async () => stop(),
          url
        }
      }
    } catch {
      // The gateway has not bound its port yet.
    }

    await new Promise(resolve => setTimeout(resolve, 500))
  }

  stop()
  throw new Error(`remote lemon serve never became ready:\n${log}`)
}

function writeConnectionsRegistry(sandbox: Sandbox, remoteUrl: string): void {
  fs.writeFileSync(
    path.join(sandbox.userDataDir, 'connections.json'),
    JSON.stringify({
      connections: [
        { id: 'local', kind: 'local', label: 'This device' },
        {
          authMode: 'token',
          id: REMOTE_ID,
          kind: 'remote',
          label: REMOTE_LABEL,
          token: { encoding: 'plain', value: REMOTE_TOKEN },
          url: remoteUrl
        }
      ],
      lastUsed: REMOTE_ID,
      launchMode: 'primary',
      primary: REMOTE_ID,
      version: 2
    }),
    { encoding: 'utf8', mode: 0o600 }
  )
}

async function createWorkspace(page: Page, prompt: string): Promise<void> {
  const composer = page.locator('[contenteditable="true"]').first()
  await composer.click()
  await composer.fill(prompt)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Meta+j')
  await expect(page.getByRole('button', { name: /Refresh tree|Làm mới cây/i })).toBeVisible({ timeout: 30_000 })
}

async function openFile(page: Page, filePath: string): Promise<void> {
  const tree = page.getByRole('complementary', { name: 'Right sidebar' })
  await tree.getByText(path.basename(filePath), { exact: true }).dblclick()
  await expect(page.getByRole('tab', { name: path.basename(filePath) })).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 30_000 }
  )
}

// Electron specs launch their own browser process through launchDesktop.
// eslint-disable-next-line no-empty-pattern
test('opens every local structured and media preview in the built Electron renderer', async ({}, testInfo) => {
  test.setTimeout(240_000)
  const sandbox = createSandbox('preview-runtime')
  const fixtureRoot = path.join(sandbox.root, 'fixtures')
  fs.mkdirSync(fixtureRoot)
  const files = writeLocalFixtures(fixtureRoot)
  const runtimeErrors: string[] = []
  let app: ElectronApplication | undefined
  let mock: Awaited<ReturnType<typeof startMockServer>> | undefined

  try {
    mock = await startMockServer()
    writeMockProviderConfig(sandbox.lemonHome, mock.url, undefined, `terminal:\n  cwd: ${fixtureRoot}`)
    writeEnvFile(sandbox.lemonHome)
    const launched = await launchDesktop(buildAppEnv(sandbox))
    app = launched.app
    const { page } = launched
    const workerUrls: string[] = []
    page.on('worker', worker => workerUrls.push(worker.url()))
    page.on('pageerror', error => runtimeErrors.push(`page: ${error.message}`))
    page.on('console', message => {
      if (message.type() === 'error') {
        runtimeErrors.push(`console: ${message.text()}`)
      }
    })
    await waitForAppReady({ app, page } as MockBackendFixture, 90_000)
    await createWorkspace(page, 'Open the preview fixture folder')

    await openFile(page, files.csv)
    await expect(page.getByRole('cell', { name: 'CSV alpha' })).toBeVisible()
    await page.locator('button:visible').filter({ hasText: /source/i }).click()
    await expect(page.locator('pre:visible')).toContainText('CSV alpha,42')

    await openFile(page, files.tsv)
    await expect(page.getByRole('cell', { name: 'TSV beta' })).toBeVisible()

    await openFile(page, files.xlsx)
    await expect(page.getByRole('button', { name: 'Sheet One' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('cell', { name: 'Runtime XLSX first' })).toBeVisible()
    await page.getByRole('button', { name: 'Sheet Two' }).click()
    await expect(page.getByRole('button', { name: 'Sheet Two' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('cell', { name: 'Runtime XLSX second' })).toBeVisible()

    await openFile(page, files.zip)
    await expect(page.getByRole('cell', { name: 'docs/runtime-entry.txt' })).toBeVisible()

    await openFile(page, files.docx)
    await expect(page.getByText('Runtime DOCX text', { exact: true })).toBeVisible()

    await openFile(page, files.pptx)
    await expect(page.getByRole('heading', { name: 'Slide 1' })).toBeVisible()
    await expect(page.getByText('Runtime PPTX text', { exact: true })).toBeVisible()

    await openFile(page, files.wav)
    const audio = page.locator('audio:visible')
    await expect(audio).toHaveAttribute('src', /^lemon-media:\/\/stream\//)
    await expect(audio).toHaveAttribute('preload', 'metadata')
    await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1)

    await openFile(page, files.mp4)
    const video = page.locator('video:visible')
    await expect(video).toHaveAttribute('src', /^lemon-media:\/\/stream\//)
    await expect(video).toHaveAttribute('preload', 'metadata')
    await expect.poll(() => video.evaluate(element => (element as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(1)

    expect(workerUrls.some(url => url.includes('file-preview-parser.worker-'))).toBe(true)
    expect(runtimeErrors).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('local-file-previews.png') })
  } finally {
    await app?.close().catch(() => undefined)
    await mock?.close()
    sandbox.cleanup()
  }
})

// eslint-disable-next-line no-empty-pattern
test('opens a remote raster image through the scoped media protocol', async ({}, testInfo) => {
  test.setTimeout(240_000)
  const sandbox = createSandbox('preview-remote-runtime')
  const fixtureRoot = path.join(sandbox.root, 'remote-fixtures')
  fs.mkdirSync(fixtureRoot)
  const imagePath = path.join(fixtureRoot, 'remote.png')
  fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
  const runtimeErrors: string[] = []
  let app: ElectronApplication | undefined
  let mock: Awaited<ReturnType<typeof startMockServer>> | undefined
  let remote: Awaited<ReturnType<typeof startRemoteGateway>> | undefined

  try {
    mock = await startMockServer()
    writeMockProviderConfig(sandbox.lemonHome, mock.url)
    writeEnvFile(sandbox.lemonHome)
    remote = await startRemoteGateway(sandbox.root, fixtureRoot, mock.url)
    writeConnectionsRegistry(sandbox, remote.url)
    const env = buildAppEnv(sandbox)
    delete env.LEMON_DESKTOP_HARNESS_CONFIG
    const launched = await launchDesktop(env)
    app = launched.app
    const { page } = launched
    page.on('pageerror', error => runtimeErrors.push(`page: ${error.message}`))
    page.on('console', message => {
      if (message.type() === 'error') {
        runtimeErrors.push(`console: ${message.text()}`)
      }
    })
    await waitForAppReady({ app, page } as MockBackendFixture, 120_000)

    await createWorkspace(page, 'Open the remote preview fixture folder')
    await openFile(page, imagePath)
    const previewImage = page.locator('img[alt="remote.png"]:visible')
    await expect(previewImage).toHaveAttribute('src', /^lemon-media:\/\/remote\//)
    await expect.poll(() => previewImage.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const src = await previewImage.getAttribute('src')
    expect(src).not.toContain(REMOTE_TOKEN)
    expect(runtimeErrors).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('remote-raster-preview.png') })
  } finally {
    await app?.close().catch(() => undefined)
    await remote?.close()
    await mock?.close()
    sandbox.cleanup()
  }
})
