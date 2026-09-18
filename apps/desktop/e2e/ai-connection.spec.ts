/** Real Desktop integration for the internal Lemon AI connection editor. */
import fs from 'node:fs'
import path from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'

import { expect, test } from './test'
import { buildAppEnv, createSandbox, launchDesktop, waitForAppReady } from './fixtures'
import { startMockServer } from './mock-server'

const EVIDENCE_DIR = path.resolve(import.meta.dirname, '..', '..', '..', '..', 'plans', 'reports', 'ai-connection-evidence')
const HARNESS_RESOURCE = path.resolve(import.meta.dirname, '..', 'build', 'lemon-ai-harness.json')
const FIRST_PROMPT = 'E2E AI connection first launch'
const RELAUNCH_PROMPT = 'E2E AI connection after relaunch'

function isInternalHarnessBuild(): boolean {
  if (!fs.existsSync(HARNESS_RESOURCE)) return false

  try {
    return JSON.parse(fs.readFileSync(HARNESS_RESOURCE, 'utf8')).profile === 'internal'
  } catch {
    return false
  }
}

test.skip(!isInternalHarnessBuild(), 'requires an internal Desktop harness build')

function writeInitialConfig(home: string, mockUrl: string): void {
  fs.writeFileSync(path.join(home, 'config.yaml'), `model:
  provider: company-ai
  default: old-model
  base_url: ${mockUrl}/v1
providers:
  company-ai:
    name: AI công ty
    base_url: ${mockUrl}/v1
    model: old-model
    api_mode: chat_completions
    models:
      old-model: {}
display:
  language: vi
approvals:
  mode: "off"
auxiliary:
  title_generation:
    enabled: false
`, 'utf8')
}

function writeUnresolvedConfig(home: string): void {
  fs.writeFileSync(path.join(home, 'config.yaml'), `providers:
  user-endpoint:
    name: Kết nối cần chọn
    base_url: http://127.0.0.1:1/v1
    model: user-model
    api_mode: chat_completions
    models:
      user-model: {}
display:
  language: vi
`, 'utf8')
}

async function capture(app: ElectronApplication, page: Page, width: number, name: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      win.unmaximize()
      win.setMinimumSize(700, 600)
      win.setBounds({ x: 0, y: 0, width: size.width, height: 800 })
    }
  }, { width })
  await page.waitForTimeout(300)
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  await page.screenshot({ animations: 'disabled', caret: 'hide', path: path.join(EVIDENCE_DIR, name) })
}

async function openConnectionSettings(page: Page): Promise<void> {
  await page.evaluate(() => { window.location.hash = '#/settings?tab=providers' })
  await expect(page.getByRole('heading', { name: 'Kết nối AI' })).toBeVisible({ timeout: 30_000 })
}

async function submitFromNewChat(page: Page, prompt: string): Promise<void> {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur() })
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+N' : 'Control+N')
  await page.waitForFunction(() => !window.location.hash.includes('/settings'))
  const composer = page.locator('[data-slot="composer-root"] [contenteditable="true"]').first()
  await composer.waitFor({ state: 'visible', timeout: 30_000 })
  await composer.fill(prompt)
  await page.keyboard.press('Enter')
}

async function closeBeforeRelaunch(app: ElectronApplication): Promise<void> {
  const child = app.process()
  await app.close()

  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Electron did not exit before relaunch')), 15_000)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

}

test('Vietnamese AI connection routes new chats and survives relaunch', async () => {
  test.setTimeout(180_000)
  const initialMock = await startMockServer()
  const replacementMock = await startMockServer()
  const sandbox = createSandbox('ai-connection')
  let app: ElectronApplication | null = null

  writeInitialConfig(sandbox.lemonHome, initialMock.url)
  const launchValues = buildAppEnv(sandbox, {
    LEMON_AI_COMPANY_API_KEY: 'synthetic-company-key',
    LEMON_DESKTOP_HARNESS_CONFIG: path.resolve(import.meta.dirname, '..', 'lemon-ai-desktop.config.json')
  })

  try {
    ;({ app } = await launchDesktop(launchValues))
    let page = await app.firstWindow()
    await waitForAppReady({ app, page, sandbox, cleanup: async () => undefined }, 120_000)
    await openConnectionSettings(page)

    await expect(page.getByLabel('Tên kết nối')).toHaveValue('AI công ty')
    await page.getByLabel('Địa chỉ máy chủ').fill(`${replacementMock.url}/v1`)
    await page.getByLabel('Model').fill('mock-model')
    await page.getByRole('button', { name: 'Kiểm tra kết nối' }).click()
    await expect(page.getByText(/Tìm thấy 1 model|kết nối được tới dịch vụ AI/i)).toBeVisible()
    await page.getByRole('button', { name: 'Lưu và sử dụng' }).click()
    await expect(page.getByText(/cuộc trò chuyện mới sẽ dùng kết nối này/i)).toBeVisible()
    await capture(app, page, 1280, 'ai-connection-1280x800.png')

    await submitFromNewChat(page, FIRST_PROMPT)
    await expect.poll(() => replacementMock.receivedPrompts.includes(FIRST_PROMPT), { timeout: 60_000 }).toBe(true)
    expect(initialMock.receivedPrompts).not.toContain(FIRST_PROMPT)

    await closeBeforeRelaunch(app)
    app = null
    const relaunchValues = { ...launchValues }
    delete relaunchValues.LEMON_AI_COMPANY_API_KEY
    ;({ app, page } = await launchDesktop(relaunchValues))
    await waitForAppReady({ app, page, sandbox, cleanup: async () => undefined }, 120_000)
    await openConnectionSettings(page)
    await expect(page.getByLabel('Địa chỉ máy chủ')).toHaveValue(`${replacementMock.url}/v1`)
    await expect(page.getByLabel('Model')).toHaveValue('mock-model')
    await expect(page.getByText('Đang dùng')).toBeVisible()
    await capture(app, page, 900, 'ai-connection-900x800.png')

    await submitFromNewChat(page, RELAUNCH_PROMPT)
    await expect.poll(() => replacementMock.receivedPrompts.includes(RELAUNCH_PROMPT), { timeout: 60_000 }).toBe(true)
    const persisted = fs.readFileSync(path.join(sandbox.lemonHome, 'config.yaml'), 'utf8')
    expect(persisted).toContain(`${replacementMock.url}/v1`)
    expect(persisted).toContain('mock-model')
    expect(persisted).not.toContain('synthetic-company-key')
  } finally {
    await app?.close().catch(() => undefined)
    await Promise.all([initialMock.close(), replacementMock.close()])
    sandbox.cleanup()
  }
})

test('unresolved upgraded profile can still open AI connection settings', async () => {
  const sandbox = createSandbox('ai-connection-unresolved')
  let app: ElectronApplication | null = null
  writeUnresolvedConfig(sandbox.lemonHome)

  const launchValues = buildAppEnv(sandbox, {
    LEMON_DESKTOP_HARNESS_CONFIG: path.resolve(import.meta.dirname, '..', 'lemon-ai-desktop.config.json')
  })

  try {
    ;({ app } = await launchDesktop(launchValues))
    const page = await app.firstWindow()
    await waitForAppReady({ app, page, sandbox, cleanup: async () => undefined }, 120_000)
    await openConnectionSettings(page)
    await expect(page.getByText('Kết nối cần chọn')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Lưu và sử dụng' })).toBeVisible()
  } finally {
    await app?.close().catch(() => undefined)
    sandbox.cleanup()
  }
})
