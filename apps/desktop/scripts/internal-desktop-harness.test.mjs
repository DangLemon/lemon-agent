import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'

import {
  HARNESS_RESOURCE_FILENAME,
  generateInternalDesktopHarnessResource,
  loadHarnessConfigInput,
  resolveHarnessViteDefines,
  selectedHarnessConfigInputPath,
  validateHarnessResource,
  isDirectRun
} from './internal-desktop-harness.mjs'

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
    mcp_servers: {
      '<COMPANY_MCP_SERVER_ID>': {
        url: '<COMPANY_MCP_SERVER_URL_IF_HTTP>',
        auth: 'oauth'
      }
    }
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
      requiredEnv: ['<PROVIDER_REQUIRED_ENV_VAR>']
    }
  }
}

test('validateHarnessResource accepts the frozen nonsecret schema', () => {
  assert.deepEqual(validateHarnessResource(validResource), validResource)
})

test('validateHarnessResource permits credentialRequirements metadata and environment references in public MCP config', () => {
  const resource = {
    ...validResource,
    managedConfig: {
      mcp_servers: {
        '<COMPANY_MCP_SERVER_ID>': {
          url: '<COMPANY_MCP_SERVER_URL_IF_HTTP>',
          headers: {
            'X-Company-Auth': '${MCP_COMPANY_AUTH}'
          }
        }
      }
    },
    credentialRequirements: {
      provider: { requiredEnv: ['PROVIDER_API_KEY'], label: 'Provider API key' },
      mcpServers: { '<COMPANY_MCP_SERVER_ID>': { requiredEnv: ['MCP_COMPANY_AUTH'], label: 'Company MCP auth' } }
    }
  }

  assert.equal(validateHarnessResource(resource).managedConfig.mcp_servers['<COMPANY_MCP_SERVER_ID>'].headers['X-Company-Auth'], '${MCP_COMPANY_AUTH}')
})

test('validateHarnessResource accepts real nonsecret deployment identifiers in private build input', () => {
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

  assert.equal(validateHarnessResource(resource).initialProvider.id, 'lemon-ai-company')
  assert.equal(validateHarnessResource(resource).sourceRepository, 'DangLemon/lemon-agent')
})

test('validateHarnessResource rejects unsafe source repositories and literal model api keys', () => {
  assert.throws(
    () => validateHarnessResource({ ...validResource, sourceRepository: 'https://github.com/DangLemon/lemon-agent' }),
    /sourceRepository/i
  )
  assert.throws(
    () => validateHarnessResource({ ...validResource, sourceRepository: '../lemon-agent' }),
    /sourceRepository/i
  )
  assert.throws(
    () => validateHarnessResource({ ...validResource, initialProvider: { ...validResource.initialProvider, api_key: 'sk-live-secret-value' } }),
    /initialProvider\.api_key/i
  )
})

test('configured internal manifest pins approved repo, model, and MCP env refs', () => {
  const manifestPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'lemon-ai-desktop.config.json')
  const resource = loadHarnessConfigInput({ LEMON_DESKTOP_HARNESS_CONFIG: manifestPath })

  assert.equal(resource.sourceRepository, 'DangLemon/lemon-agent')
  assert.deepEqual(resource.ui, {
    agents: false,
    cron: true,
    messaging: false,
    terminal: true,
    webhooks: false
  })
  assert.equal(resource.managedConfig.model, undefined)
  assert.deepEqual(resource.initialProvider, {
    id: 'lemon-ai-company',
    name: 'AI công ty',
    base_url: 'http://127.0.0.1:5173/v1',
    model: 'openai-codex-gpt-5-5',
    key_env: 'LEMON_AI_COMPANY_API_KEY'
  })
  assert.deepEqual(Object.keys(resource.managedConfig.mcp_servers).sort(), ['algolia', 'amazon-ads', 'tiktok-ads'])
  assert.equal(resource.managedConfig.mcp_servers.algolia.enabled, false)
  assert.equal(resource.managedConfig.mcp_servers['amazon-ads'].oauth.client_id, '${AMAZON_ADS_CLIENT_ID}')
  assert.equal(resource.managedConfig.mcp_servers['amazon-ads'].oauth.client_secret, '${AMAZON_ADS_CLIENT_SECRET}')
  assert.equal(resource.managedConfig.mcp_servers['amazon-ads'].oauth.redirect_uri, 'http://localhost:8000/auth/callback')
  assert.equal(resource.managedConfig.mcp_servers['amazon-ads'].oauth.redirect_port, 8000)
})

test('validateHarnessResource rejects secret-shaped keys and values anywhere', () => {
  assert.throws(
    () =>
      validateHarnessResource({
        ...validResource,
        managedConfig: {
          headers: {
            Authorization: 'Bearer sk-live-secret'
          }
        }
      }),
    /secret-shaped/i
  )
})

test('loadHarnessConfigInput reads only the explicit selector', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-input-'))
  try {
    const input = path.join(tempRoot, 'input.json')
    fs.writeFileSync(input, JSON.stringify(validResource), 'utf8')

    assert.equal(loadHarnessConfigInput({ LEMON_DESKTOP_HARNESS_CONFIG: input })?.profile, 'internal')
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('loadHarnessConfigInput stays ordinary when no selector is set', () => {
  assert.equal(selectedHarnessConfigInputPath({}), '')
  assert.equal(loadHarnessConfigInput({}), null)
  assert.equal(selectedHarnessConfigInputPath({ LEMON_DESKTOP_HARNESS_CONFIG: '  ' }), '')
  assert.throws(() => loadHarnessConfigInput({ LEMON_DESKTOP_HARNESS_CONFIG: '/missing/lemon.json' }), /ENOENT/)
})

test('Lemon selector remains active for Lemon installer builds', () => {
  const selected = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'lemon-ai-desktop.config.json')
  assert.equal(
    selectedHarnessConfigInputPath({
      LEMON_INSTALLER_BRAND: 'lemon',
      LEMON_DESKTOP_HARNESS_CONFIG: selected
    }),
    selected
  )
  assert.equal(
    loadHarnessConfigInput({
      LEMON_INSTALLER_BRAND: 'lemon',
      LEMON_DESKTOP_HARNESS_CONFIG: selected
    })?.profile,
    'internal'
  )
})

test('generateInternalDesktopHarnessResource writes selected input and removes stale output when absent or invalid', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-generate-'))
  try {
    const buildDir = path.join(tempRoot, 'build')
    const input = path.join(tempRoot, 'input.json')
    fs.writeFileSync(input, JSON.stringify(validResource), 'utf8')

    const written = generateInternalDesktopHarnessResource({
      env: { LEMON_DESKTOP_HARNESS_CONFIG: input },
      buildDir
    })
    assert.equal(written.resourcePath, path.join(buildDir, HARNESS_RESOURCE_FILENAME))
    assert.equal(JSON.parse(fs.readFileSync(written.resourcePath, 'utf8')).profile, 'internal')
    assert.equal(fs.existsSync(path.join(buildDir, 'lemon-ai-harness-seed.py')), true)

    const absent = generateInternalDesktopHarnessResource({ env: {}, buildDir })
    assert.equal(absent.resourcePath, null)
    assert.equal(fs.existsSync(path.join(buildDir, HARNESS_RESOURCE_FILENAME)), false)
    assert.equal(fs.existsSync(path.join(buildDir, 'lemon-ai-harness-seed.py')), false)

    fs.writeFileSync(path.join(buildDir, HARNESS_RESOURCE_FILENAME), JSON.stringify(validResource), 'utf8')
    const invalidInput = path.join(tempRoot, 'invalid.json')
    fs.writeFileSync(invalidInput, JSON.stringify({ ...validResource, schemaVersion: 2 }), 'utf8')
    assert.throws(
      () => generateInternalDesktopHarnessResource({ env: { LEMON_DESKTOP_HARNESS_CONFIG: invalidInput }, buildDir }),
      /schemaVersion/
    )
    assert.equal(fs.existsSync(path.join(buildDir, HARNESS_RESOURCE_FILENAME)), false)
    assert.equal(fs.existsSync(path.join(buildDir, 'lemon-ai-harness-seed.py')), false)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('resolveHarnessViteDefines emits internal flags only for a valid selected input', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-harness-vite-'))
  try {
    const input = path.join(tempRoot, 'input.json')
    fs.writeFileSync(input, JSON.stringify(validResource), 'utf8')

    assert.deepEqual(resolveHarnessViteDefines({ LEMON_DESKTOP_HARNESS_CONFIG: input }), {
      'import.meta.env.VITE_LEMON_DESKTOP_HARNESS': JSON.stringify('internal'),
      'import.meta.env.VITE_LEMON_HARNESS_SHOW_AGENTS': JSON.stringify('false'),
      'import.meta.env.VITE_LEMON_HARNESS_SHOW_CRON': JSON.stringify('true'),
      'import.meta.env.VITE_LEMON_HARNESS_SHOW_MESSAGING': JSON.stringify('false'),
      'import.meta.env.VITE_LEMON_HARNESS_SHOW_TERMINAL': JSON.stringify('true'),
      'import.meta.env.VITE_LEMON_HARNESS_SHOW_WEBHOOKS': JSON.stringify('false')
    })
    assert.deepEqual(resolveHarnessViteDefines({}), {})
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})


test('validateHarnessResource allows stdio MCP command fields and Authorization env references', () => {
  const resource = {
    ...validResource,
    managedConfig: {
      mcp_servers: {
        company_stdio: { command: 'company-mcp', args: ['--profile', 'internal'], env: { COMPANY_MCP_TOKEN: '${COMPANY_MCP_TOKEN}' } },
        company_http: { url: 'https://mcp.company.example/sse', headers: { Authorization: 'Bearer ${COMPANY_MCP_OAUTH}' } }
      }
    }
  }

  assert.equal(validateHarnessResource(resource).managedConfig.mcp_servers.company_stdio.command, 'company-mcp')
})

test('validateHarnessResource rejects literal secrets in MCP config and credentialRequirements metadata', () => {
  assert.throws(
    () => validateHarnessResource({ ...validResource, managedConfig: { mcp_servers: { a: { headers: { Authorization: 'Bearer literal-secret-value' } } } } }),
    /secret-shaped/i
  )
  assert.throws(
    () => validateHarnessResource({ ...validResource, credentialRequirements: { provider: { label: 'sk-live-secret-value' } } }),
    /secret-shaped/i
  )
})


test('isDirectRun uses platform-correct file URL comparison for Windows paths', () => {
  const href = 'file:///C:/repo/apps/desktop/scripts/internal-desktop-harness.mjs'
  assert.equal(
    isDirectRun(href, String.raw`C:\repo\apps\desktop\scripts\internal-desktop-harness.mjs`, {
      resolve: value => value.replace(/\\/g, '/').replace(/^C:/, '/C:'),
      pathToFileURLHref: value => `file://${value}`
    }),
    true
  )
})


test('validateHarnessResource rejects opaque auth header literals and credentialRequirements password keys', () => {
  assert.throws(
    () => validateHarnessResource({ ...validResource, managedConfig: { ...validResource.managedConfig, mcp_servers: { company_http: { headers: { 'X-Company-Auth': 'abcdefghijklmnop' } } } } }),
    /secret-shaped/i
  )
  assert.throws(
    () => validateHarnessResource({ ...validResource, credentialRequirements: { provider: { password: 'hunter2hunter2' } } }),
    /credentialRequirements/i
  )
})
