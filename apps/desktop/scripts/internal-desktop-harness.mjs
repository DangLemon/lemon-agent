import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const HARNESS_RESOURCE_FILENAME = 'lemon-ai-harness.json'
export const HARNESS_SEED_FILENAME = 'lemon-ai-harness-seed.py'
export const HARNESS_SEED_SOURCE_FILENAME = 'lemon-ai-harness-seed.py'
export const HARNESS_SCHEMA_VERSION = 1
export const HARNESS_CONFIG_ENV_KEYS = ['LEMON_DESKTOP_HARNESS_CONFIG']
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BUILD_DIR = path.join(APP_ROOT, 'build')
const UI_KEYS = ['agents', 'cron', 'messaging', 'terminal', 'webhooks']
const SOURCE_REPOSITORY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/
const SECRET_KEY_RE = /(^|[_-])(api[_-]?key|authorization|bearer|client[_-]?secret|password|secret|token)([_-]|$)|^(api[_-]?key|authorization|bearer|client[_-]?secret|password|secret|token)$/i
const SECRET_VALUE_RE = /\b(?:bearer\s+(?!\$\{)[a-z0-9._~+/=-]{12,}|sk-[a-z0-9_-]{12,}|[a-z0-9_]*token[a-z0-9_]*\s*[:=]\s*[a-z0-9._~+/=-]{12,})\b/i
const OPAQUE_SECRET_VALUE_RE = /^[A-Za-z0-9._~+/=-]{16,}$/
const AUTH_LIKE_KEY_RE = /(auth|authorization|token|secret|password|credential|api[-_]?key)/i

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(message) {
  throw new Error(`[internal-desktop-harness] ${message}`)
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string`)
  }
}

function isEnvironmentReference(value) {
  return typeof value === 'string' && (/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(value) || /^Bearer \$\{[A-Z_][A-Z0-9_]*\}$/.test(value))
}

function validateSourceRepository(value) {
  if (typeof value !== 'string' || !SOURCE_REPOSITORY_RE.test(value)) {
    fail('sourceRepository must be a GitHub owner/repo identity')
  }

  if (value.includes('..') || value.endsWith('.git') || value.startsWith('-') || /^(https?:|git@)/i.test(value)) {
    fail('sourceRepository must be a safe GitHub owner/repo identity')
  }
}

function validateInitialProvider(value) {
  if (!isPlainObject(value)) fail('initialProvider must be an object')

  for (const key of ['id', 'name', 'base_url', 'model', 'key_env']) {
    requireNonEmptyString(value[key], `initialProvider.${key}`)
  }

  for (const key of Object.keys(value)) {
    if (!['id', 'name', 'base_url', 'model', 'key_env', 'context_length', 'discover_models', 'models'].includes(key)) {
      fail(`initialProvider.${key} is not allowed`)
    }
  }

  if ('context_length' in value && (!Number.isInteger(value.context_length) || value.context_length <= 0)) {
    fail('initialProvider.context_length must be a positive integer')
  }
  if ('discover_models' in value && typeof value.discover_models !== 'boolean') {
    fail('initialProvider.discover_models must be boolean')
  }
  if ('models' in value) {
    if (!Array.isArray(value.models)) fail('initialProvider.models must be an array')
    value.models.forEach((item, index) => requireNonEmptyString(item, `initialProvider.models.${index}`))
  }
}


function validateCredentialRequirements(value, trail = ['credentialRequirements']) {
  if (!isPlainObject(value)) {
    fail(`${trail.join('.')} must be an object`)
  }

  for (const [key, child] of Object.entries(value)) {
    if (!['provider', 'mcpServers', 'mcp_servers'].includes(key) && !/^<[^>]+>$/.test(key)) {
      fail(`credentialRequirements contains unsupported key ${[...trail, key].join('.')}`)
    }

    validateCredentialRequirementNode(child, [...trail, key])
  }
}

function validateCredentialRequirementNode(value, trail) {
  if (typeof value === 'string') {
    const parentKey = trail[trail.length - 2]
    const metadataName = ['requiredEnv', 'required_env', 'name', 'names'].includes(parentKey)

    if (!metadataName && (SECRET_VALUE_RE.test(value) || OPAQUE_SECRET_VALUE_RE.test(value))) {
      fail(`secret-shaped value at ${trail.join('.')}`)
    }

    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateCredentialRequirementNode(item, [...trail, String(index)]))

    return
  }

  if (!isPlainObject(value)) {
    return
  }

  for (const [key, child] of Object.entries(value)) {
    const parentKey = trail[trail.length - 1]
    const metadataMap = ['mcpServers', 'mcp_servers', 'labels'].includes(parentKey)

    if (!metadataMap && !['requiredEnv', 'required_env', 'label', 'labels', 'name', 'names', 'login'].includes(key) && !/^<[^>]+>$/.test(key)) {
      fail(`credentialRequirements contains unsupported key ${[...trail, key].join('.')}`)
    }

    validateCredentialRequirementNode(child, [...trail, key])
  }
}

function scanNonSecret(value, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanNonSecret(item, [...trail, String(index)]))
    return
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (trail[0] !== 'credentialRequirements' && SECRET_KEY_RE.test(key) && !isEnvironmentReference(child)) {
        fail(`secret-shaped field at ${[...trail, key].join('.')}`)
      }

      if (trail[0] !== 'credentialRequirements' && AUTH_LIKE_KEY_RE.test(key) && typeof child === 'string' && !isEnvironmentReference(child) && OPAQUE_SECRET_VALUE_RE.test(child)) {
        fail(`secret-shaped value at ${[...trail, key].join('.')}`)
      }
      scanNonSecret(child, [...trail, key])
    }
    return
  }
  if (typeof value === 'string') {
    if (SECRET_VALUE_RE.test(value)) {
      fail(`secret-shaped value at ${trail.join('.') || '<root>'}`)
    }
  }
}

export function validateHarnessResource(input) {
  if (!isPlainObject(input)) fail('resource must be a JSON object')
  if (input.schemaVersion !== HARNESS_SCHEMA_VERSION) fail(`schemaVersion must be ${HARNESS_SCHEMA_VERSION}`)
  if (input.profile !== 'internal') fail('profile must be "internal"')
  if ('sourceRepository' in input) validateSourceRepository(input.sourceRepository)
  if (!isPlainObject(input.ui)) fail('ui must be an object')
  for (const key of UI_KEYS) {
    if (typeof input.ui[key] !== 'boolean') fail(`ui.${key} must be boolean`)
  }
  for (const key of Object.keys(input.ui)) {
    if (!UI_KEYS.includes(key)) fail(`ui.${key} is not part of the frozen schema`)
  }
  if ('managedConfig' in input && !isPlainObject(input.managedConfig)) fail('managedConfig must be an object when present')
  if ('initialProvider' in input) {
    validateInitialProvider(input.initialProvider)
  }
  if ('credentialRequirements' in input) {
    validateCredentialRequirements(input.credentialRequirements)
  }
  scanNonSecret(input)

  if (input.managedConfig) {
    for (const key of Object.keys(input.managedConfig)) {
      if (!['mcp_servers'].includes(key)) fail(`managedConfig.${key} is not allowed`)
    }
  }
  return input
}

export function selectedHarnessConfigInputPath(env = process.env) {
  return String(env.LEMON_DESKTOP_HARNESS_CONFIG || '').trim()
}

export function loadHarnessConfigInput(env = process.env) {
  const selected = selectedHarnessConfigInputPath(env)
  if (!selected) return null
  const resolved = path.resolve(selected)
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  return validateHarnessResource(parsed)
}

export function generateInternalDesktopHarnessResource({ env = process.env, buildDir = DEFAULT_BUILD_DIR } = {}) {
  const outPath = path.join(buildDir, HARNESS_RESOURCE_FILENAME)
  const seedOutPath = path.join(buildDir, HARNESS_SEED_FILENAME)
  const removeStale = () => {
    try {
      fs.rmSync(outPath, { force: true })
      fs.rmSync(seedOutPath, { force: true })
    } catch {
      // Best-effort cleanup; validation/build failures are reported separately.
    }
  }

  let resource
  try {
    resource = loadHarnessConfigInput(env)
  } catch (error) {
    removeStale()
    throw error
  }

  if (!resource) {
    removeStale()
    return { resourcePath: null, resource: null }
  }

  fs.mkdirSync(buildDir, { recursive: true })
  fs.writeFileSync(outPath, `${JSON.stringify(resource, null, 2)}\n`, 'utf8')
  fs.copyFileSync(path.join(APP_ROOT, 'electron', HARNESS_SEED_SOURCE_FILENAME), path.join(buildDir, HARNESS_SEED_FILENAME))
  return { resourcePath: outPath, resource }
}

export function resolveHarnessViteDefines(env = process.env) {
  const resource = loadHarnessConfigInput(env)
  if (!resource) return {}
  const defines = {
    'import.meta.env.VITE_LEMON_DESKTOP_HARNESS': JSON.stringify('internal')
  }
  for (const key of UI_KEYS) {
    defines[`import.meta.env.VITE_LEMON_HARNESS_SHOW_${key.toUpperCase()}`] = JSON.stringify(String(resource.ui[key]))
  }
  return defines
}

export function isDirectRun(metaUrl, argv1 = process.argv[1], {
  resolve = path.resolve,
  pathToFileURLHref = value => pathToFileURL(value).href
} = {}) {
  return Boolean(argv1) && metaUrl === pathToFileURLHref(resolve(argv1))
}

if (isDirectRun(import.meta.url)) {
  const result = generateInternalDesktopHarnessResource()
  if (result.resourcePath) {
    console.log(`[internal-desktop-harness] wrote ${result.resourcePath}`)
  } else {
    console.log('[internal-desktop-harness] no selector; stale resource removed')
  }
}
