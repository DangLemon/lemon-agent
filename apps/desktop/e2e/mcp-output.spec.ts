import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { ElectronApplication, Page } from '@playwright/test'

import {
  buildAppEnv,
  createSandbox,
  launchDesktop,
  waitForAppReady,
  writeEnvFile,
  writeMockProviderConfig
} from './fixtures'
import { startMockServer } from './mock-server'
import { expect, test } from './test'

const FAKE_MCP_MARKER = 'LEMON_E2E_MCP_START_MARKER'
const FAKE_MCP_TOOL = 'mcp__local_e2e__local_e2e_probe'
const fakeMcpPython = process.env.LEMON_E2E_PYTHON || ''
const TURN_PROMPT = 'Please call execute_code and create a simple E2E image.'
const FAKE_MCP_SOURCE = String.raw`
import argparse
from pathlib import Path
from mcp.server import MCPServer

parser = argparse.ArgumentParser()
parser.add_argument('--marker', required=True)
parser.add_argument('--log', required=True)
args = parser.parse_args()
Path(args.marker).write_text('started', encoding='utf-8')

server = MCPServer('local-e2e')

@server.tool()
def local_e2e_probe() -> str:
    with open(args.log, 'a', encoding='utf-8') as stream:
        stream.write('called\n')
    return 'local-only MCP probe'


if __name__ == '__main__':
    server.run(transport='stdio')
`

function denyExternalNetwork(page: Page, allowedOrigins: string[]): void {
  void page.route('**/*', async route => {
    const origin = new URL(route.request().url()).origin
    if (allowedOrigins.includes(origin)) {
      await route.continue()
      return
    }

    await route.abort('blockedbyclient')
  })
}

function installPythonNetworkGuard(root: string): void {
  fs.writeFileSync(
    path.join(root, 'sitecustomize.py'),
    String.raw`
import errno
import ipaddress
import os
import socket

_log = os.environ.get('LEMON_E2E_NETWORK_GUARD_LOG')
_original_getaddrinfo = socket.getaddrinfo
_original_connect = socket.socket.connect
_original_connect_ex = socket.socket.connect_ex
_original_sendto = socket.socket.sendto

def _record(host):
    if _log:
        with open(_log, 'a', encoding='utf-8') as stream:
            stream.write(f'{host}\n')

def _is_loopback(host):
    if host in (None, 'localhost'):
        return True
    try:
        return ipaddress.ip_address(str(host).split('%', 1)[0]).is_loopback
    except ValueError:
        return False

def _guard_getaddrinfo(host, *args, **kwargs):
    if not _is_loopback(host):
        _record(host)
        raise socket.gaierror(f'E2E blocked external DNS lookup: {host}')
    return _original_getaddrinfo(host, *args, **kwargs)

def _guard_connect(self, address):
    host = address[0] if isinstance(address, tuple) else address
    if not _is_loopback(host):
        _record(host)
        raise OSError(f'E2E blocked external network connection: {host}')
    return _original_connect(self, address)

def _guard_connect_ex(self, address):
    host = address[0] if isinstance(address, tuple) else address
    if not _is_loopback(host):
        _record(host)
        return errno.EACCES
    return _original_connect_ex(self, address)

def _guard_sendto(self, data, *args):
    address = args[-1]
    host = address[0] if isinstance(address, tuple) else address
    if not _is_loopback(host):
        _record(host)
        raise OSError(f'E2E blocked external network send: {host}')
    return _original_sendto(self, data, *args)

socket.getaddrinfo = _guard_getaddrinfo
socket.socket.connect = _guard_connect
socket.socket.connect_ex = _guard_connect_ex
socket.socket.sendto = _guard_sendto
`,
    'utf8'
  )
}

async function openMcpTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/skills?tab=mcp'
  })
  await expect(page.locator('#mcp-server-local-e2e')).toBeVisible({ timeout: 30_000 })
}

async function openFreshChat(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await page.locator('[data-slot="composer-root"] [contenteditable="true"]').first().waitFor({ state: 'visible' })
}

test('Windows Desktop MCP is prompt-driven and execute_code media renders', async () => {
  test.setTimeout(240_000)

  if (process.platform !== 'win32' && process.env.LEMON_E2E_RUN_CROSS_PLATFORM !== '1') {
    test.skip(true, 'set LEMON_E2E_RUN_CROSS_PLATFORM=1 to run this Windows-focused E2E locally')
  }
  if (!fakeMcpPython) {
    test.skip(true, 'LEMON_E2E_PYTHON must point to the uv dev interpreter with MCP installed')
  }

  const sandbox = createSandbox('mcp-output')
  const fakeMcpScript = path.join(sandbox.root, 'fake_mcp_server.py')
  const mcpStartMarker = path.join(sandbox.root, 'mcp-started.log')
  const mcpCallLog = path.join(sandbox.root, 'mcp-tool-calls.log')
  const configPath = path.join(sandbox.lemonHome, 'config.yaml')
  const managedDir = path.join(sandbox.root, 'managed')
  const bundledPluginsDir = path.join(sandbox.root, 'no-bundled-plugins')
  const externalAttemptsPath = path.join(sandbox.root, 'external-attempts.log')
  const guardProbeLogPath = path.join(sandbox.root, 'guard-probe.log')
  installPythonNetworkGuard(sandbox.root)
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') || 'PATH'
  const pythonPrefix = path.dirname(path.dirname(fakeMcpPython))
  const backendPath = [pythonPrefix, process.env[pathKey] || ''].filter(Boolean).join(path.delimiter)
  const runtimeEnv = {
    LEMON_HOME: sandbox.lemonHome,
    LEMON_E2E_NETWORK_GUARD_LOG: externalAttemptsPath,
    PATH: backendPath,
    PYTHONPATH: [sandbox.root, process.env.PYTHONPATH || ''].filter(Boolean).join(path.delimiter)
  }
  fs.mkdirSync(managedDir, { recursive: true })
  fs.mkdirSync(bundledPluginsDir, { recursive: true })
  const probeEnv = buildAppEnv(sandbox, {
    ...runtimeEnv,
    LEMON_E2E_MCP_START_MARKER: mcpStartMarker,
    LEMON_DESKTOP_PYTHON: fakeMcpPython,
    LEMON_MANAGED_DIR: managedDir,
    LEMON_BUNDLED_PLUGINS: bundledPluginsDir,
    LEMON_ENABLE_PROJECT_PLUGINS: '0'
  })
  const guardProbe = spawnSync(
    fakeMcpPython,
    [
      '-c',
      "import socket; assert socket.getaddrinfo.__name__ == '_guard_getaddrinfo'; socket.getaddrinfo('example.invalid', 80)"
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, ...probeEnv, LEMON_E2E_NETWORK_GUARD_LOG: guardProbeLogPath },
      timeout: 5_000
    }
  )
  if (guardProbe.status === 0) {
    throw new Error('Python egress guard allowed an external DNS lookup')
  }
  if (fs.readFileSync(guardProbeLogPath, 'utf8').trim() !== 'example.invalid') {
    throw new Error(
      `Python egress guard did not record the blocked DNS probe: ${guardProbe.stderr || guardProbe.stdout}`
    )
  }
  fs.rmSync(guardProbeLogPath, { force: true })
  const mock = await startMockServer({
    toolCallPrompt: TURN_PROMPT,
    toolCallAdvertisedTools: [FAKE_MCP_TOOL, 'execute_code'],
    toolCallScript: [
      { name: FAKE_MCP_TOOL, args: {} },
      {
        name: 'execute_code',
        args: {
          code: `from pathlib import Path\nPath('generated-e2e.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#f00"/></svg>')`,
          output_files: ['generated-e2e.svg']
        }
      }
    ],
    toolCallResultTools: [FAKE_MCP_TOOL, 'execute_code'],
    toolCallFinalMediaFromOutput: true
  })
  let app: ElectronApplication | null = null

  try {
    fs.writeFileSync(fakeMcpScript, FAKE_MCP_SOURCE, 'utf8')
    writeMockProviderConfig(
      sandbox.lemonHome,
      mock.url,
      undefined,
      `code_execution:\n  mode: project\n  kernel_idle_timeout: 20\n  max_session_kernels: 2\ntools:\n  tool_search:\n    enabled: off\nagent:\n  coding_context: auto\n  disabled_toolsets: []\n  project:\n    root: ${JSON.stringify(sandbox.root)}\n  coding_instructions: |\n    When asked to generate an SVG, use execute_code with output_files=['generated-e2e.svg'], create it in the session workspace, then answer with MEDIA: and the exact output_file returned by execute_code.\napprovals:\n  mode: off\ndisplay:\n  language: en\nterminal:\n  cwd: ${JSON.stringify(sandbox.root)}\nmcp_servers:\n  local-e2e:\n    command: ${JSON.stringify(fakeMcpPython)}\n    args: [${JSON.stringify(fakeMcpScript)}, --marker, ${JSON.stringify(mcpStartMarker)}, --log, ${JSON.stringify(mcpCallLog)}]\n    cwd: ${JSON.stringify(sandbox.root)}\n    enabled: true\n`
    )
    fs.writeFileSync(
      path.join(sandbox.root, 'pyproject.toml'),
      '[project]\nname = "desktop-mcp-e2e"\nversion = "0.0.0"\n\n[tool.uv]\npackage = false\n',
      'utf8'
    )
    const config = fs.readFileSync(configPath, 'utf8')
    if (!config.includes('local-e2e') || !config.includes('enabled: true') || /tiktok-ads|amazon-ads/i.test(config)) {
      throw new Error('E2E fake MCP config is missing the local server or contains an external ad server')
    }
    writeEnvFile(sandbox.lemonHome)

    const env = buildAppEnv(sandbox, {
      ...runtimeEnv,
      LEMON_E2E_MCP_START_MARKER: mcpStartMarker,
      LEMON_DESKTOP_PYTHON: fakeMcpPython,
      LEMON_MANAGED_DIR: managedDir,
      LEMON_BUNDLED_PLUGINS: bundledPluginsDir,
      LEMON_ENABLE_PROJECT_PLUGINS: '0'
    })
    delete env.LEMON_DESKTOP_HARNESS_CONFIG
    delete env.LEMON_DESKTOP_BAKE_HARNESS_ENV
    delete env.LEMON_AI_COMPANY_API_KEY
    delete env.AMAZON_ADS_CLIENT_ID
    delete env.AMAZON_ADS_CLIENT_SECRET
    delete env.TIKTOK_ADS_ACCESS_TOKEN
    ;({ app } = await launchDesktop(env))
    const page = await app.firstWindow()
    denyExternalNetwork(page, [mock.url])
    await waitForAppReady({ app, page, sandbox, cleanup: async () => undefined }, 120_000)
    await page.evaluate(() => localStorage.setItem('lemon-desktop-theme-v2', 'nous'))
    const effectiveConfig = await page.evaluate(async () => {
      const desktop = (
        window as unknown as { lemonDesktop: { api: <T>(request: { path: string; method?: string }) => Promise<T> } }
      ).lemonDesktop
      const response = await desktop.api<{ mcp_servers?: Record<string, unknown> }>({
        path: '/api/config',
        method: 'GET'
      })
      return response.mcp_servers ?? {}
    })
    expect(Object.keys(effectiveConfig)).toEqual(['local-e2e'])
    await expect.poll(() => fs.existsSync(mcpStartMarker)).toBe(false)
    const externalAttempts = fs.existsSync(externalAttemptsPath) ? fs.readFileSync(externalAttemptsPath, 'utf8') : ''
    if (externalAttempts) {
      const unexpected = externalAttempts
        .split(/\r?\n/)
        .filter(
          host =>
            host &&
            ![
              'example.invalid',
              'models.dev',
              'danglemon.github.io',
              'raw.githubusercontent.com',
              'api.github.com'
            ].includes(host)
        )
      expect(unexpected, 'TikTok/Amazon MCP egress must remain blocked and unattempted').toEqual([])
    }

    await openMcpTab(page)
    await expect.poll(() => fs.existsSync(mcpStartMarker)).toBe(false)

    await expect(page.locator('#mcp-server-local-e2e')).toBeVisible()
    await page.locator('#mcp-server-local-e2e').getByRole('button', { name: 'Reload MCP' }).click()
    await expect.poll(() => fs.existsSync(mcpStartMarker), { timeout: 30_000 }).toBe(true)
    await expect.poll(() => fs.readFileSync(mcpStartMarker, 'utf8').trim()).toBe('started')
    await expect.poll(() => fs.existsSync(mcpCallLog)).toBe(false)

    await openFreshChat(page)
    const composer = page.locator('[data-slot="composer-root"] [contenteditable="true"]').first()
    await composer.fill(TURN_PROMPT)
    await page.keyboard.press('Enter')
    await expect
      .poll(() => mock.receivedPrompts.some(prompt => prompt.includes(TURN_PROMPT)), { timeout: 90_000 })
      .toBe(true)
    const advertisedAfterPrompt =
      mock.receivedToolNames[mock.receivedPrompts.findIndex(prompt => prompt.includes(TURN_PROMPT))]
    expect(advertisedAfterPrompt, `tools advertised: ${JSON.stringify(mock.receivedToolNames)}`).toContain(
      FAKE_MCP_TOOL
    )
    expect(advertisedAfterPrompt).toContain('execute_code')
    await expect.poll(() => fs.existsSync(mcpCallLog), { timeout: 90_000 }).toBe(true)
    await expect
      .poll(() => fs.readFileSync(mcpCallLog, 'utf8').split(/\r?\n/).filter(Boolean), { timeout: 90_000 })
      .toHaveLength(1)
    await expect(page.getByRole('img', { name: 'generated-e2e.svg' })).toBeVisible({ timeout: 90_000 })
  } finally {
    await app?.close().catch(() => undefined)
    await mock.close()
    sandbox.cleanup()
  }
})
