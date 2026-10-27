import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { ElectronApplication } from '@playwright/test'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig
} from './fixtures'
import { startMockServer } from './mock-server'
import { RealSessionBuilder } from './real-session-builder'
import { expect, test } from './test'

const SESSION_TITLE = 'E2E Provider Artifact Card'
const ARTIFACT_ID = '0123456789abcdef0123456789abcdef'
const ARTIFACT_BYTES = Buffer.from('provider artifact download fixture')

function seedProviderArtifact(lemonHome: string, sessionId: string): void {
  const artifactDir = path.join(lemonHome, 'cache', 'provider-artifacts')
  fs.mkdirSync(artifactDir, { recursive: true })
  fs.writeFileSync(path.join(artifactDir, ARTIFACT_ID), ARTIFACT_BYTES)

  const script = [
    'import json, sqlite3, sys',
    'from pathlib import Path',
    'home, sid, artifact_id = sys.argv[1:]',
    'db = sqlite3.connect(Path(home) / "state.db")',
    'row = db.execute("SELECT id, display_metadata FROM messages WHERE session_id=? AND role=\'assistant\' ORDER BY id DESC LIMIT 1", (sid,)).fetchone()',
    'assert row, "seeded assistant transcript row missing"',
    'meta = json.loads(row[1] or "{}")',
    'meta["provider_artifacts"] = [{"id": artifact_id, "filename": "report.zip", "content_type": "application/zip", "size_bytes": len(' + JSON.stringify(ARTIFACT_BYTES.toString('utf8')) + '), "sha256": "' + crypto.createHash('sha256').update(ARTIFACT_BYTES).digest('hex') + '", "expires_at": 2000000000}]',
    'db.execute("UPDATE messages SET display_metadata=? WHERE id=?", (json.dumps(meta), row[0]))',
    'db.commit()'
  ].join('\n')
  const result = spawnSync('uv', ['run', '--active', '--no-sync', 'python', '-c', script, lemonHome, sessionId, ARTIFACT_ID], {
    cwd: path.resolve(import.meta.dirname, '../..'),
    encoding: 'utf8'
  })

  if (result.status !== 0) {
    throw new Error(`Could not seed provider artifact transcript: ${result.stderr || result.stdout}`)
  }
}

test('renders a durable provider artifact card and downloads its bytes by ID', async ({}, testInfo) => {
  test.setTimeout(180_000)

  const sandbox = createSandbox('provider-artifact-card')
  const downloadedPath = path.join(sandbox.root, 'downloaded-provider-artifact.zip')
  const mock = await startMockServer()
  let app: ElectronApplication | undefined
  let builder: RealSessionBuilder | undefined

  try {
    writeMockProviderConfig(sandbox.lemonHome, mock.url)
    writeEnvFile(sandbox.lemonHome)
    builder = await RealSessionBuilder.start(sandbox.lemonHome)
    const session = await builder.createSession({ title: SESSION_TITLE, turns: ['seed artifact transcript'] })
    await builder.close()
    builder = undefined
    seedProviderArtifact(sandbox.lemonHome, session.sessionId)

    const launched = await launchDesktop(buildAppEnv(sandbox))
    app = launched.app
    const { page } = launched
    await waitForAppReady({ app, page, sandbox, cleanup: async () => undefined }, 90_000)

    const sessionRow = page.locator('[data-slot="sidebar"] button').filter({ hasText: SESSION_TITLE }).first()
    await expect(sessionRow).toBeVisible({ timeout: 60_000 })
    await sessionRow.click()

    const transcript = page.locator('[data-slot="aui_thread-viewport"]')
    const card = page.locator('[data-slot="provider-artifact-card"]')
    await expect(transcript).toContainText('Hello from the mock inference server', { timeout: 60_000 })
    await expect(card).toContainText('report.zip')
    await page.screenshot({ path: testInfo.outputPath('provider-artifact-card.png') })

    await app.evaluate(({ dialog }, targetPath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: targetPath })
    }, downloadedPath)
    await card.getByRole('button', { name: 'Download' }).click()
    await expect.poll(() => fs.existsSync(downloadedPath), { timeout: 30_000 }).toBe(true)
    expect(fs.readFileSync(downloadedPath)).toEqual(ARTIFACT_BYTES)
  } finally {
    await builder?.close().catch(() => undefined)
    await app?.close().catch(() => undefined)
    await mock.close()
    sandbox.cleanup()
  }
})
