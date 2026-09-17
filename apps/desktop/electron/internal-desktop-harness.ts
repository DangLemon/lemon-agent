import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

export const HARNESS_RESOURCE_FILENAME = 'lemon-ai-harness.json'
const LEGACY_HARNESS_RESOURCE_FILENAME = 'internal-desktop-harness.json'
const HARNESS_SEED_FILENAME = 'lemon-ai-harness-seed.py'
const LEGACY_HARNESS_SEED_FILENAME = 'internal-desktop-harness-seed.py'
const HARNESS_SCHEMA_VERSION = 1
const UI_KEYS = ['agents', 'cron', 'messaging', 'terminal', 'webhooks'] as const
const SOURCE_REPOSITORY_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/
const SECRET_KEY_RE = /(^|[_-])(api[_-]?key|authorization|bearer|client[_-]?secret|password|secret|token)([_-]|$)|^(api[_-]?key|authorization|bearer|client[_-]?secret|password|secret|token)$/i
const SECRET_VALUE_RE = /\b(?:bearer\s+(?!\$\{)[a-z0-9._~+/=-]{12,}|sk-[a-z0-9_-]{12,}|[a-z0-9_]*token[a-z0-9_]*\s*[:=]\s*[a-z0-9._~+/=-]{12,})\b/i
const OPAQUE_SECRET_VALUE_RE = /^[A-Za-z0-9._~+/=-]{16,}$/
const AUTH_LIKE_KEY_RE = /(auth|authorization|token|secret|password|credential|api[-_]?key)/i
const INITIAL_PROVIDER_SEED_TIMEOUT_MS = 15_000
const execFileAsync = promisify(execFile)

export interface InternalDesktopHarnessResource {
  schemaVersion: 1
  profile: 'internal'
  sourceRepository?: string
  ui: Record<(typeof UI_KEYS)[number], boolean>
  managedConfig?: Record<string, unknown>
  initialProvider?: {
    id: string
    name: string
    base_url: string
    model: string
    key_env: string
    context_length?: number
    discover_models?: boolean
    models?: string[]
  }
  credentialRequirements?: Record<string, unknown>
}

export interface InternalDesktopHarnessLoadResult {
  active: boolean
  diagnostic: string | null
  path: string | null
  resource: InternalDesktopHarnessResource | null
}

export type InternalDesktopSeedExec = (
  command: string,
  args: string[],
  options: {
    cwd: string
    env: Record<string, string | undefined>
    shell?: boolean
    timeout: number
  }
) => Promise<unknown>

export interface InternalDesktopHarnessState {
  active: boolean
  diagnostic: string | null
  managedDir: string | null
  resourcePath: string | null
  seedScriptPath: string | null
  requested: boolean
  resource: InternalDesktopHarnessResource | null
  suppressRemoteBackends: boolean
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function fail(message: string): never {
  throw new Error(`[internal-desktop-harness] ${message}`)
}

function requireNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${label} must be a non-empty string`)
  }
}

function isEnvironmentReference(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    (/^\$\{[A-Z_][A-Z0-9_]*\}$/.test(value) || /^Bearer \$\{[A-Z_][A-Z0-9_]*\}$/.test(value))
  )
}

function validateSourceRepository(value: unknown): void {
  if (typeof value !== 'string' || !SOURCE_REPOSITORY_RE.test(value)) {
    fail('sourceRepository must be a GitHub owner/repo identity')
  }

  if (value.includes('..') || value.endsWith('.git') || value.startsWith('-') || /^(https?:|git@)/i.test(value)) {
    fail('sourceRepository must be a safe GitHub owner/repo identity')
  }
}

function validateInitialProvider(value: unknown): void {
  if (!isPlainObject(value)) {fail('initialProvider must be an object')}

  for (const key of ['id', 'name', 'base_url', 'model', 'key_env']) {
    requireNonEmptyString(value[key], `initialProvider.${key}`)
  }

  for (const key of Object.keys(value)) {
    if (!['id', 'name', 'base_url', 'model', 'key_env', 'context_length', 'discover_models', 'models'].includes(key)) {
      fail(`initialProvider.${key} is not allowed`)
    }
  }

  if ('context_length' in value) {
    const contextLength = value.context_length

    if (!Number.isInteger(contextLength) || typeof contextLength !== 'number' || contextLength <= 0) {
      fail('initialProvider.context_length must be a positive integer')
    }
  }

  if ('discover_models' in value && typeof value.discover_models !== 'boolean') {
    fail('initialProvider.discover_models must be boolean')
  }

  if ('models' in value) {
    if (!Array.isArray(value.models)) {fail('initialProvider.models must be an array')}
    value.models.forEach((item, index) => requireNonEmptyString(item, `initialProvider.models.${index}`))
  }
}


function validateCredentialRequirements(value: unknown, trail: string[] = ['credentialRequirements']): void {
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

function validateCredentialRequirementNode(value: unknown, trail: string[]): void {
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

function scanNonSecret(value: unknown, trail: string[] = []): void {
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

export function validateInternalDesktopHarnessResource(input: unknown): InternalDesktopHarnessResource {
  if (!isPlainObject(input)) {fail('resource must be a JSON object')}

  if (input.schemaVersion !== HARNESS_SCHEMA_VERSION) {fail(`schemaVersion must be ${HARNESS_SCHEMA_VERSION}`)}

  if (input.profile !== 'internal') {fail('profile must be "internal"')}

  if ('sourceRepository' in input) {validateSourceRepository(input.sourceRepository)}

  if (!isPlainObject(input.ui)) {fail('ui must be an object')}

  for (const key of UI_KEYS) {
    if (typeof input.ui[key] !== 'boolean') {fail(`ui.${key} must be boolean`)}
  }

  for (const key of Object.keys(input.ui)) {
    if (!(UI_KEYS as readonly string[]).includes(key)) {fail(`ui.${key} is not part of the frozen schema`)}
  }

  if ('managedConfig' in input && !isPlainObject(input.managedConfig)) {fail('managedConfig must be an object when present')}

  if ('initialProvider' in input) {
    validateInitialProvider(input.initialProvider)
  }

  if ('credentialRequirements' in input) {
    validateCredentialRequirements(input.credentialRequirements)
  }

  scanNonSecret(input)

  if (isPlainObject(input.managedConfig)) {
    for (const key of Object.keys(input.managedConfig)) {
      if (!['mcp_servers'].includes(key)) {fail(`managedConfig.${key} is not allowed`)}
    }
  }

  return input as unknown as InternalDesktopHarnessResource
}

export function loadInternalDesktopHarnessResource({
  resourcesPath,
  appRoot,
  allowBuildResource = false
}: {
  resourcesPath?: string | null
  appRoot: string
  allowBuildResource?: boolean
}): InternalDesktopHarnessLoadResult {
  const candidates = [
    resourcesPath ? path.join(resourcesPath, HARNESS_RESOURCE_FILENAME) : null,
    resourcesPath ? path.join(resourcesPath, LEGACY_HARNESS_RESOURCE_FILENAME) : null,
    allowBuildResource ? path.join(appRoot, 'build', HARNESS_RESOURCE_FILENAME) : null,
    allowBuildResource ? path.join(appRoot, 'build', LEGACY_HARNESS_RESOURCE_FILENAME) : null
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {continue}

    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      const resource = validateInternalDesktopHarnessResource(parsed)

      return { active: true, diagnostic: null, path: candidate, resource }
    } catch (error) {
      return {
        active: false,
        diagnostic: `invalid ${HARNESS_RESOURCE_FILENAME} at ${candidate}: ${(error as Error).message}`,
        path: candidate,
        resource: null
      }
    }
  }

  return { active: false, diagnostic: null, path: null, resource: null }
}

export function materializeInternalDesktopManagedConfig(
  resource: InternalDesktopHarnessResource,
  {
    userDataPath,
    pid = process.pid,
    nonce = () => crypto.randomBytes(6).toString('hex')
  }: { userDataPath: string; pid?: number; nonce?: () => string }
): string {
  const managedDir = path.join(userDataPath, 'lemon-ai-managed-config', `${pid}-${nonce()}`)
  fs.mkdirSync(managedDir, { recursive: true })
  fs.writeFileSync(path.join(managedDir, 'config.yaml'), `${JSON.stringify(resource.managedConfig || {}, null, 2)}\n`, 'utf8')

  return managedDir
}

export function resolveInternalDesktopSeedScriptPath(resourcePath: string | null, appRoot: string): string | null {
  const candidates = [
    resourcePath ? path.join(path.dirname(resourcePath), HARNESS_SEED_FILENAME) : null,
    resourcePath ? path.join(path.dirname(resourcePath), LEGACY_HARNESS_SEED_FILENAME) : null,
    path.join(appRoot, 'build', HARNESS_SEED_FILENAME),
    path.join(appRoot, 'build', LEGACY_HARNESS_SEED_FILENAME),
    path.join(appRoot, 'electron', HARNESS_SEED_FILENAME),
    path.join(appRoot, 'electron', LEGACY_HARNESS_SEED_FILENAME)
  ].filter(Boolean) as string[]

  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}


function executableName(command: string): string {
  return command.split(/[\\/]+/).pop()?.toLowerCase() || command.toLowerCase()
}

function siblingPythonForCommand(command: string): string | null {
  const name = executableName(command)

  if (!/^lemon(?:\.exe|\.cmd|\.bat)?$/i.test(name)) {return null}

  const directory = path.dirname(command)

  for (const candidate of [path.join(directory, 'python.exe'), path.join(directory, 'python3'), path.join(directory, 'python')]) {
    if (fs.existsSync(candidate)) {return candidate}
  }

  return null
}


function splitShebang(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean)
}

function shebangPythonForCommand(command: string): { command: string; argsPrefix: string[] } | null {
  const name = executableName(command)

  if (!/^lemon(?:\.exe|\.cmd|\.bat)?$/i.test(name)) {return null}

  let script = command

  try {
    script = fs.realpathSync(command)
    const text = fs.readFileSync(script, 'utf8')
    const firstLine = text.split(/\r?\n/, 1)[0] || ''

    if (/\.(?:cmd|bat)$/i.test(name)) {
      const match = text.match(/@?(?:"([^"\r\n]*python(?:3(?:\.\d+)?)?\.exe)"|(\S*python(?:3(?:\.\d+)?)?\.exe))/i)
      const python = match?.[1] || match?.[2]

      return python ? { command: python, argsPrefix: [] } : null
    }

    if (!firstLine.startsWith('#!')) {return null}

    const parts = splitShebang(firstLine.slice(2))

    if (parts.length === 0) {return null}

    const interpreter = parts[0]
    const argsPrefix = parts.slice(1)
    const invokesPython = [interpreter, ...argsPrefix].some(part => /^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(executableName(part)))

    if (!invokesPython) {return null}

    return { command: interpreter, argsPrefix }
  } catch (_error) {
    return null
  }
}

function pythonFromBackendRoot(root: string | undefined): string | null {
  if (!root) {return null}

  const candidates = process.platform === 'win32'
    ? [path.join(root, 'venv', 'Scripts', 'python.exe'), path.join(root, '.venv', 'Scripts', 'python.exe')]
    : [path.join(root, 'venv', 'bin', 'python'), path.join(root, '.venv', 'bin', 'python'), path.join(root, 'venv', 'bin', 'python3'), path.join(root, '.venv', 'bin', 'python3')]

  return candidates.find(candidate => fs.existsSync(candidate)) ?? null
}

function seedArgs(seedScriptPath: string, { lemonHome, profile, resourcePath }: { lemonHome: string; profile?: null | string; resourcePath: string }): string[] {
  const homeFlag = path.basename(seedScriptPath) === LEGACY_HARNESS_SEED_FILENAME ? '--lemon-home' : '--lemon-home'

  return [seedScriptPath, '--resource', resourcePath, homeFlag, lemonHome, '--profile', String(profile || '')]
}

export function buildInternalDesktopInitialProviderSeedInvocation(
  backend: { args?: string[]; command?: string; kind?: string; root?: string; shell?: boolean },
  seedScriptPath: string,
  options: { lemonHome: string; profile?: null | string; resourcePath: string }
): { command: string; args: string[]; shell: boolean } {
  if (!backend.command) {fail('cannot seed initial provider without a backend command')}

  const backendArgs = Array.isArray(backend.args) ? backend.args : []
  const moduleIndex = backendArgs.findIndex((arg, index) => arg === '-m' && backendArgs[index + 1] === 'lemon_cli.main')

  if (moduleIndex >= 0) {
    return {
      command: backend.command,
      args: [...backendArgs.slice(0, moduleIndex), ...seedArgs(seedScriptPath, options)],
      shell: Boolean(backend.shell)
    }
  }

  if (/^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(executableName(backend.command))) {
    return { command: backend.command, args: seedArgs(seedScriptPath, options), shell: Boolean(backend.shell) }
  }

  const siblingPython = siblingPythonForCommand(backend.command)

  if (siblingPython) {
    return { command: siblingPython, args: seedArgs(seedScriptPath, options), shell: false }
  }

  const shebangPython = shebangPythonForCommand(backend.command)

  if (shebangPython) {
    return { command: shebangPython.command, args: [...shebangPython.argsPrefix, ...seedArgs(seedScriptPath, options)], shell: false }
  }

  const rootPython = pythonFromBackendRoot(backend.root)

  if (rootPython) {
    return { command: rootPython, args: seedArgs(seedScriptPath, options), shell: false }
  }

  fail(`cannot resolve Python interpreter for editable provider seed from backend command ${executableName(backend.command)}`)
}

export async function runInternalDesktopInitialProviderSeed(
  resource: InternalDesktopHarnessResource | null,
  {
    backend,
    environment = process['env'],
    execFile: run = execFileAsync,
    lemonHome,
    profile,
    resourcePath,
    seedScriptPath
  }: {
    backend: { args?: string[]; command?: string; env?: Record<string, string>; kind?: string; root?: string; shell?: boolean }
    environment?: NodeJS.ProcessEnv | Record<string, string | undefined>
    execFile?: InternalDesktopSeedExec
    lemonHome: string
    profile?: null | string
    resourcePath: string
    seedScriptPath: string | null
  }
): Promise<void> {
  if (!resource?.initialProvider) {return}

  if (!backend?.command) {fail('cannot seed initial provider without a backend command')}

  if (!seedScriptPath) {fail('initial provider seed helper is missing')}

  const invocation = buildInternalDesktopInitialProviderSeedInvocation(backend, seedScriptPath, {
    lemonHome,
    profile,
    resourcePath
  })

  await run(invocation.command, invocation.args, {
    cwd: backend.root || lemonHome,
    env: {
      ...environment,
      ...(backend['env'] || {}),
      LEMON_HOME: lemonHome,
    },
    shell: invocation.shell,
    timeout: INITIAL_PROVIDER_SEED_TIMEOUT_MS
  })
}

export function initializeInternalDesktopHarness({
  resourcesPath,
  appRoot,
  userDataPath,
  isWsl = false,
  allowBuildResource = false
}: {
  resourcesPath?: string | null
  appRoot: string
  userDataPath: string
  isWsl?: boolean
  allowBuildResource?: boolean
}): InternalDesktopHarnessState {
  const loaded = loadInternalDesktopHarnessResource({ resourcesPath, appRoot, allowBuildResource })

  if (loaded.active && isWsl) {
    return {
      active: false,
      managedDir: null,
      resourcePath: loaded.path,
      seedScriptPath: resolveInternalDesktopSeedScriptPath(loaded.path, appRoot),
      requested: true,
      resource: loaded.resource,
      suppressRemoteBackends: true,
      diagnostic: 'internal Desktop harness resource is ignored for WSL until explicit path translation is implemented'
    }
  }

  if (!loaded.active || !loaded.resource) {
    return {
      active: false,
      managedDir: null,
      resourcePath: null,
      seedScriptPath: null,
      requested: false,
      resource: null,
      suppressRemoteBackends: false,
      diagnostic: loaded.diagnostic
    }
  }

  try {
    return {
      active: true,
      managedDir: materializeInternalDesktopManagedConfig(loaded.resource, { userDataPath }),
      resourcePath: loaded.path,
      seedScriptPath: resolveInternalDesktopSeedScriptPath(loaded.path, appRoot),
      requested: true,
      resource: loaded.resource,
      suppressRemoteBackends: true,
      diagnostic: null
    }
  } catch (error) {
    return {
      active: false,
      managedDir: null,
      resourcePath: loaded.path,
      seedScriptPath: resolveInternalDesktopSeedScriptPath(loaded.path, appRoot),
      requested: true,
      resource: null,
      suppressRemoteBackends: true,
      diagnostic: `could not materialize ${HARNESS_RESOURCE_FILENAME}: ${(error as Error).message}`
    }
  }
}
