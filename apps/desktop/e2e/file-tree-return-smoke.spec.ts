import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  type MockBackendFixture,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig
} from './fixtures'
import { startMockServer } from './mock-server'
import { expect, test } from './test'

test('Files tree reflects folders deleted outside Lemon AI when focus returns', async ({}, testInfo) => {
  test.setTimeout(120_000)
  const sandbox = createSandbox('file-tree-return')
  const root = path.join(sandbox.root, 'plain-folder')
  const keep = path.join(root, 'keep')
  const removed = path.join(root, 'removed')
  const nestedRemoved = path.join(keep, 'nested-removed')
  fs.mkdirSync(nestedRemoved, { recursive: true })
  fs.mkdirSync(removed)
  let app: MockBackendFixture['app'] | undefined
  let mock: Awaited<ReturnType<typeof startMockServer>> | undefined

  try {
    mock = await startMockServer()
    writeMockProviderConfig(sandbox.lemonHome, mock.url, undefined, `terminal:\n  cwd: ${root}`)
    writeEnvFile(sandbox.lemonHome)
    const launched = await launchDesktop(buildAppEnv(sandbox))
    app = launched.app
    const { page } = launched
    await waitForAppReady({ app, page } as MockBackendFixture, 90_000)

    const composer = page.locator('[contenteditable="true"]').first()
    await composer.click()
    await composer.type('Open the local folder in this chat', { delay: 2 })
    await page.keyboard.press('Enter')

    await page.keyboard.press('Meta+j')
    await expect(page.getByRole('button', { name: /Refresh tree|Làm mới cây/i })).toBeVisible({ timeout: 30_000 })

    const tree = page.getByRole('complementary', { name: 'Right sidebar' })
    const row = (folder: string) => tree.locator(`[title="${folder}"]`)
    await expect(row(removed)).toBeVisible()
    await row(keep).click()
    await expect(row(nestedRemoved)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('files-before.png') })

    fs.rmSync(removed, { recursive: true })
    fs.rmSync(nestedRemoved, { recursive: true })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(row(removed)).toHaveCount(0)
    await expect(row(nestedRemoved)).toHaveCount(0)
    await expect(row(keep)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('files-after.png') })
  } finally {
    await app?.close().catch(() => undefined)
    await mock?.close()
    sandbox.cleanup()
  }
})
