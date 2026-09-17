import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { LEMON_AI_IDENTITY, resolveDesktopRuntimeIdentity, resolveInternalDesktopBuild } from './desktop-runtime-identity'
import type { InternalDesktopSeedExec } from './internal-desktop-harness'
import {
  buildInternalDesktopInitialProviderSeedInvocation,
  HARNESS_RESOURCE_FILENAME,
  initializeInternalDesktopHarness,
  loadInternalDesktopHarnessResource,
  materializeInternalDesktopManagedConfig,
  runInternalDesktopInitialProviderSeed,
  validateInternalDesktopHarnessResource
} from './internal-desktop-harness'

const validResource = {
  schemaVersion: 1,
  profile: 'internal',
  ui: {
    agents: false,
    cron: true,
    messaging: false,
    terminal: true,
    webhooks: false
  },
  managedConfig: {
    mcp_servers: {}
  },
  initialProvider: {
    id: '<COMPANY_PROVIDER_ID>',
    name: '<COMPANY_PROVIDER_NAME>',
    base_url: '<COMPANY_PROVIDER_BASE_URL>',
    model: '<COMPANY_MODEL_ID>',
    key_env: 'COMPANY_PROVIDER_API_KEY'
  },
  credentialRequirements: {
    provider: {
      label: '<PROVIDER_CREDENTIAL_LABEL>'
    }
  }
} as const

test('loadInternalDesktopHarnessResource reads packaged resources before dev build output', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-electron-'))

  try {
    const resourcesPath = path.join(tempRoot, 'resources')
    const appRoot = path.join(tempRoot, 'app')
    fs.mkdirSync(resourcesPath, { recursive: true })
    fs.mkdirSync(path.join(appRoot, 'build'), { recursive: true })
    fs.writeFileSync(path.join(appRoot, 'build', HARNESS_RESOURCE_FILENAME), JSON.stringify({ ...validResource, profile: 'dev-wrong' }), 'utf8')
    fs.writeFileSync(path.join(resourcesPath, HARNESS_RESOURCE_FILENAME), JSON.stringify(validResource), 'utf8')

    const loaded = loadInternalDesktopHarnessResource({ resourcesPath, appRoot, allowBuildResource: true })
    assert.equal(loaded.active, true)
    assert.equal(loaded.resource?.profile, 'internal')
    assert.equal(loaded.path, path.join(resourcesPath, HARNESS_RESOURCE_FILENAME))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('loadInternalDesktopHarnessResource rejects malformed packaged resources without falling back to stale dev data', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-electron-'))

  try {
    const resourcesPath = path.join(tempRoot, 'resources')
    const appRoot = path.join(tempRoot, 'app')
    fs.mkdirSync(resourcesPath, { recursive: true })
    fs.mkdirSync(path.join(appRoot, 'build'), { recursive: true })
    fs.writeFileSync(path.join(resourcesPath, HARNESS_RESOURCE_FILENAME), '{ bad json', 'utf8')
    fs.writeFileSync(path.join(appRoot, 'build', HARNESS_RESOURCE_FILENAME), JSON.stringify(validResource), 'utf8')

    const loaded = loadInternalDesktopHarnessResource({ resourcesPath, appRoot })
    assert.equal(loaded.active, false)
    assert.match(loaded.diagnostic || '', /invalid/i)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('materializeInternalDesktopManagedConfig writes only managedConfig as JSON config.yaml', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-managed-'))

  try {
    const dir = materializeInternalDesktopManagedConfig(validResource, {
      userDataPath: tempRoot,
      pid: 1234,
      nonce: () => 'abcd'
    })

    assert.equal(path.basename(dir), '1234-abcd')
    assert.equal(path.basename(path.dirname(dir)), 'lemon-ai-managed-config')
    const config = JSON.parse(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf8'))
    assert.deepEqual(config, validResource.managedConfig)
    assert.equal(JSON.stringify(config).includes('credentialRequirements'), false)
    assert.equal(JSON.stringify(config).includes('ui'), false)
    assert.equal(JSON.stringify(config).includes('initialProvider'), false)
    assert.equal(JSON.stringify(config).includes('<COMPANY_MODEL_ID>'), false)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('initializeInternalDesktopHarness returns inactive instead of reusing stale data when no valid resource exists', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-init-'))

  try {
    const state = initializeInternalDesktopHarness({ resourcesPath: path.join(tempRoot, 'missing'), appRoot: tempRoot, userDataPath: tempRoot })
    assert.deepEqual(state, {
      active: false,
      managedDir: null,
      resourcePath: null,
      seedScriptPath: null,
      requested: false,
      resource: null,
      suppressRemoteBackends: false,
      diagnostic: null
    })
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('baked Lemon package identity survives missing and malformed packaged harness resources', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-package-identity-'))

  try {
    const missingState = initializeInternalDesktopHarness({ resourcesPath: path.join(tempRoot, 'missing'), appRoot: tempRoot, userDataPath: tempRoot })
    const malformedResources = path.join(tempRoot, 'malformed')
    fs.mkdirSync(malformedResources, { recursive: true })
    fs.writeFileSync(path.join(malformedResources, HARNESS_RESOURCE_FILENAME), '{ bad json', 'utf8')
    const malformedState = initializeInternalDesktopHarness({ resourcesPath: malformedResources, appRoot: tempRoot, userDataPath: tempRoot })

    for (const state of [missingState, malformedState]) {
      assert.equal(state.requested, false)
      const internalBuild = resolveInternalDesktopBuild({ internalPackage: true, internalHarnessRequested: state.requested })
      assert.equal(resolveDesktopRuntimeIdentity({ internalHarnessRequested: internalBuild }), LEMON_AI_IDENTITY)
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})


test('validateInternalDesktopHarnessResource permits credential metadata and environment references but rejects real secrets', () => {
  const withEnvRef = {
    ...validResource,
    managedConfig: {
      mcp_servers: {
        '<COMPANY_MCP_SERVER_ID>': {
          url: '<COMPANY_MCP_SERVER_URL_IF_HTTP>',
          headers: { 'X-Company-Auth': '${MCP_COMPANY_AUTH}' }
        }
      }
    },
    credentialRequirements: {
      provider: { requiredEnv: ['PROVIDER_API_KEY'], label: 'Provider API key' }
    }
  }

  assert.equal(validateInternalDesktopHarnessResource(withEnvRef).profile, 'internal')

  assert.throws(
    () =>
      validateInternalDesktopHarnessResource({
        ...validResource,
        managedConfig: { ...validResource.managedConfig, mcp_servers: { '<COMPANY_MCP_SERVER_ID>': { token: 'sk-live-secret-value' } } }
      }),
    /secret-shaped/i
  )
})


test('validateInternalDesktopHarnessResource accepts real nonsecret deployment identifiers in private build input', () => {
  const resource = {
    ...validResource,
    sourceRepository: 'DangLemon/lemon-agent',
    managedConfig: {
      mcp_servers: { company_search: { url: 'https://mcp.company.example/sse', headers: { 'X-Company-Auth': '${MCP_COMPANY_AUTH}' } } }
    },
    initialProvider: {
      id: 'lemon-ai-company',
      name: 'AI công ty',
      base_url: 'https://models.company.example/v1',
      model: 'company-approved-model',
      key_env: 'LEMON_AI_COMPANY_API_KEY'
    }
  }

  assert.equal(validateInternalDesktopHarnessResource(resource).initialProvider?.id, 'lemon-ai-company')
  assert.equal(validateInternalDesktopHarnessResource(resource).sourceRepository, 'DangLemon/lemon-agent')
})

test('validateInternalDesktopHarnessResource rejects unsafe source repositories and literal model api keys', () => {
  assert.throws(
    () => validateInternalDesktopHarnessResource({ ...validResource, sourceRepository: 'https://github.com/DangLemon/lemon-agent' }),
    /sourceRepository/i
  )
  assert.throws(
    () => validateInternalDesktopHarnessResource({ ...validResource, sourceRepository: '../lemon-agent' }),
    /sourceRepository/i
  )
  assert.throws(
    () => validateInternalDesktopHarnessResource({ ...validResource, initialProvider: { ...validResource.initialProvider, api_key: 'sk-live-secret-value' } }),
    /initialProvider\.api_key/i
  )
})


test('valid harness stays inactive on WSL instead of injecting an untranslated host managed path', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-wsl-'))

  try {
    fs.mkdirSync(path.join(tempRoot, 'build'), { recursive: true })
    fs.writeFileSync(path.join(tempRoot, 'build', HARNESS_RESOURCE_FILENAME), JSON.stringify(validResource), 'utf8')

    const state = initializeInternalDesktopHarness({ resourcesPath: null, appRoot: tempRoot, userDataPath: tempRoot, isWsl: true, allowBuildResource: true })
    assert.equal(state.active, false)
    assert.equal(state.managedDir, null)
    assert.match(state.diagnostic || '', /WSL/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})


test('ordinary development does not activate stale appRoot build resource without selector', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-stale-dev-'))

  try {
    fs.mkdirSync(path.join(tempRoot, 'build'), { recursive: true })
    fs.writeFileSync(path.join(tempRoot, 'build', HARNESS_RESOURCE_FILENAME), JSON.stringify(validResource), 'utf8')

    const state = loadInternalDesktopHarnessResource({ resourcesPath: null, appRoot: tempRoot, allowBuildResource: false })
    assert.equal(state.active, false)
    assert.equal(state.resource, null)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('validateInternalDesktopHarnessResource allows stdio MCP commands and Authorization env refs', () => {
  const resource = {
    ...validResource,
    managedConfig: {
      mcp_servers: {
        company_stdio: { cmd: 'company-mcp', argv: ['--stdio'], env: { COMPANY_MCP_TOKEN: '${COMPANY_MCP_TOKEN}' } },
        company_http: { url: 'https://mcp.company.example/sse', headers: { Authorization: 'Bearer ${COMPANY_MCP_OAUTH}' } }
      }
    }
  }

  assert.equal(validateInternalDesktopHarnessResource(resource).managedConfig?.mcp_servers, resource.managedConfig.mcp_servers)
})


test('validateInternalDesktopHarnessResource rejects opaque auth header literals and unknown credential requirement keys', () => {
  assert.throws(
    () =>
      validateInternalDesktopHarnessResource({
        ...validResource,
        managedConfig: {
          ...validResource.managedConfig,
          mcp_servers: { company_http: { headers: { 'X-Company-Auth': 'abcdefghijklmnop' } } }
        }
      }),
    /secret-shaped/i
  )
  assert.throws(
    () =>
      validateInternalDesktopHarnessResource({
        ...validResource,
        credentialRequirements: { provider: { password: 'hunter2hunter2' } }
      }),
    /credentialRequirements/i
  )
})

test('requested WSL harness is unavailable but still suppresses remote/profile fallback', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-wsl-requested-'))

  try {
    fs.mkdirSync(path.join(tempRoot, 'build'), { recursive: true })
    fs.writeFileSync(path.join(tempRoot, 'build', HARNESS_RESOURCE_FILENAME), JSON.stringify(validResource), 'utf8')

    const state = initializeInternalDesktopHarness({ resourcesPath: null, appRoot: tempRoot, userDataPath: tempRoot, isWsl: true, allowBuildResource: true })
    assert.equal(state.requested, true)
    assert.equal(state.active, false)
    assert.equal(state.suppressRemoteBackends, true)
    assert.equal(state.managedDir, null)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('runInternalDesktopInitialProviderSeed invokes the packaged seed helper before backend spawn', async () => {
  const calls: Array<{ command: string; args: string[]; options: Parameters<InternalDesktopSeedExec>[2] }> = []

  const run: InternalDesktopSeedExec = (command, args, options) => {
    calls.push({ command, args, options })

    return Promise.resolve('')
  }

  await runInternalDesktopInitialProviderSeed(validResource, {
    backend: {
      command: '/venv/bin/python',
      env: { PYTHONPATH: '/app' },
      root: '/runtime'
    },
    environment: { LEMON_AI_COMPANY_API_KEY: 'from-env' },
    execFile: run,
    lemonHome: '/tmp/lemon-home',
    profile: 'sales',
    resourcePath: '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness.json',
    seedScriptPath: '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness-seed.py'
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, '/venv/bin/python')
  assert.deepEqual(calls[0].args, [
    '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness-seed.py',
    '--resource',
    '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness.json',
    '--lemon-home',
    '/tmp/lemon-home',
    '--profile',
    'sales'
  ])
  assert.equal(calls[0].options.env['LEMON_HOME'], '/tmp/lemon-home')
  assert.equal(calls[0].options.env['LEMON_HOME'], '/tmp/lemon-home')
  assert.equal(calls[0].options.env['PYTHONPATH'], '/app')
  assert.equal(calls[0].options.env['LEMON_AI_COMPANY_API_KEY'], 'from-env')
  assert.equal(calls[0].options.timeout, 15_000)
  assert.equal(calls[0].options.shell, false)
})


test('buildInternalDesktopInitialProviderSeedInvocation replaces lemon module args without keeping serve args', () => {
  const invocation = buildInternalDesktopInitialProviderSeedInvocation(
    {
      command: 'wsl.exe',
      args: ['--distribution', 'Ubuntu', '--exec', '/opt/lemon/venv/bin/python', '-m', 'lemon_cli.main', '--profile', 'sales', 'serve', '--port', '0'],
      shell: false
    },
    '/mnt/c/Program Files/Lemon AI/resources/lemon-ai-harness-seed.py',
    {
      lemonHome: '/home/alex/.lemon-ai',
      profile: 'sales',
      resourcePath: '/mnt/c/Program Files/Lemon AI/resources/lemon-ai-harness.json'
    }
  )

  assert.equal(invocation.command, 'wsl.exe')
  assert.deepEqual(invocation.args, [
    '--distribution',
    'Ubuntu',
    '--exec',
    '/opt/lemon/venv/bin/python',
    '/mnt/c/Program Files/Lemon AI/resources/lemon-ai-harness-seed.py',
    '--resource',
    '/mnt/c/Program Files/Lemon AI/resources/lemon-ai-harness.json',
    '--lemon-home',
    '/home/alex/.lemon-ai',
    '--profile',
    'sales'
  ])
})

test('buildInternalDesktopInitialProviderSeedInvocation resolves sibling python for lemon shim commands', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-shim-'))

  try {
    const bin = path.join(tempRoot, 'venv', 'bin')
    fs.mkdirSync(bin, { recursive: true })
    fs.writeFileSync(path.join(bin, 'lemon'), '', 'utf8')
    fs.writeFileSync(path.join(bin, 'python'), '', 'utf8')

    const invocation = buildInternalDesktopInitialProviderSeedInvocation(
      { command: path.join(bin, 'lemon'), args: ['serve', '--port', '0'], shell: false },
      '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness-seed.py',
      {
        lemonHome: '/Users/alex/.lemon-ai',
        profile: null,
        resourcePath: '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness.json'
      }
    )

    assert.equal(invocation.command, path.join(bin, 'python'))
    assert.deepEqual(invocation.args, [
      '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness-seed.py',
      '--resource',
      '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness.json',
      '--lemon-home',
      '/Users/alex/.lemon-ai',
      '--profile',
      ''
    ])
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})


test('buildInternalDesktopInitialProviderSeedInvocation reads shebang python for plain lemon command backends', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-pipx-'))

  try {
    const bin = path.join(tempRoot, 'bin')
    fs.mkdirSync(bin, { recursive: true })
    const lemon = path.join(bin, 'lemon')
    fs.writeFileSync(lemon, '#!/usr/bin/env python3\nimport lemon_cli.main\n', 'utf8')

    const invocation = buildInternalDesktopInitialProviderSeedInvocation(
      { command: lemon, args: ['serve', '--port', '0'], kind: 'command', shell: false },
      '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness-seed.py',
      {
        lemonHome: '/Users/alex/.lemon-ai',
        profile: null,
        resourcePath: '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness.json'
      }
    )

    assert.equal(invocation.command, '/usr/bin/env')
    assert.deepEqual(invocation.args, [
      'python3',
      '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness-seed.py',
      '--resource',
      '/Applications/Lemon AI.app/Contents/Resources/lemon-ai-harness.json',
      '--lemon-home',
      '/Users/alex/.lemon-ai',
      '--profile',
      ''
    ])
    assert.equal(invocation.shell, false)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('buildInternalDesktopInitialProviderSeedInvocation reads Windows command script python for lemon command backends', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-cmd-'))

  try {
    const lemon = path.join(tempRoot, 'lemon.cmd')
    fs.writeFileSync(
      lemon,
      '@"C:\\Users\\alex\\.local\\pipx\\venvs\\lemon\\Scripts\\python.exe" "%~dp0lemon.exe" %*\r\n',
      'utf8'
    )

    const invocation = buildInternalDesktopInitialProviderSeedInvocation(
      { command: lemon, args: ['serve', '--port', '0'], kind: 'command', shell: true },
      'C:\\Program Files\\Lemon AI\\resources\\lemon-ai-harness-seed.py',
      {
        lemonHome: 'C:\\Users\\alex\\.lemon-ai',
        profile: null,
        resourcePath: 'C:\\Program Files\\Lemon AI\\resources\\lemon-ai-harness.json'
      }
    )

    assert.equal(invocation.command, 'C:\\Users\\alex\\.local\\pipx\\venvs\\lemon\\Scripts\\python.exe')
    assert.deepEqual(invocation.args, [
      'C:\\Program Files\\Lemon AI\\resources\\lemon-ai-harness-seed.py',
      '--resource',
      'C:\\Program Files\\Lemon AI\\resources\\lemon-ai-harness.json',
      '--lemon-home',
      'C:\\Users\\alex\\.lemon-ai',
      '--profile',
      ''
    ])
    assert.equal(invocation.shell, false)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('runInternalDesktopInitialProviderSeed skips when no initial provider is configured', async () => {
  const calls: Parameters<InternalDesktopSeedExec>[] = []

  const run: InternalDesktopSeedExec = (...args) => {
    calls.push(args)

    return Promise.resolve('')
  }

  await runInternalDesktopInitialProviderSeed({ ...validResource, initialProvider: undefined } as any, {
    backend: { command: '/venv/bin/python', env: {}, root: '/runtime' },
    execFile: run,
    lemonHome: '/tmp/lemon-home',
    profile: null,
    resourcePath: '/tmp/lemon-ai-harness.json',
    seedScriptPath: '/tmp/lemon-ai-harness-seed.py'
  })

  assert.equal(calls.length, 0)
})
