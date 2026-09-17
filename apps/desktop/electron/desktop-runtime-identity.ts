import path from 'node:path'

export interface DesktopRuntimeIdentity {
  appId: string
  appName: string
  bootstrapMarkerName: string
  desktopLogName: string
  handoffResultName: string
  legacyBootstrapMarkerNames: string[]
  legacyDesktopLogNames: string[]
  legacyHandoffResultNames: string[]
  legacyPosixHomeDirNames: string[]
  legacyRuntimeRootDirNames: string[]
  legacyUpdateMarkerNames: string[]
  legacyWindowsLocalAppDataDirNames: string[]
  posixHomeDirName: string
  runtimeRootDirName: string
  stagedUpdaterNames: string[]
  updateHandoffLogName: string
  updateTempPrefix: string
  updateMarkerName: string
  userDataHomeDirName: string
  windowsLocalAppDataDirName: string
}

const LEMON_IDENTITY: DesktopRuntimeIdentity = Object.freeze({
  appId: 'com.lemondigital.lemonai',
  appName: 'Lemon AI',
  bootstrapMarkerName: '.lemon-ai-bootstrap-complete',
  desktopLogName: 'lemon-ai-desktop.log',
  handoffResultName: '.lemon-ai-update-result.json',
  legacyBootstrapMarkerNames: ['.hermes-bootstrap-complete'],
  legacyDesktopLogNames: ['desktop.log'],
  legacyHandoffResultNames: ['.hermes-update-result.json'],
  legacyPosixHomeDirNames: ['.hermes'],
  legacyRuntimeRootDirNames: ['hermes-agent'],
  legacyUpdateMarkerNames: ['.hermes-update-in-progress'],
  legacyWindowsLocalAppDataDirNames: ['hermes'],
  posixHomeDirName: '.lemon-ai',
  runtimeRootDirName: 'lemon-agent',
  stagedUpdaterNames: ['lemon-ai-setup.exe', 'lemon-setup.exe', 'hermes-setup.exe'],
  updateHandoffLogName: 'lemon-ai-desktop-update-handoff.log',
  updateTempPrefix: 'lemon-ai-update',
  updateMarkerName: '.lemon-ai-update-in-progress',
  userDataHomeDirName: 'lemon-ai-home',
  windowsLocalAppDataDirName: 'Lemon AI'
})

// Retained as a source-level alias while callers are cut over in this branch.
const LEMON_AI_IDENTITY = LEMON_IDENTITY

export function resolveDesktopRuntimeIdentity(_options: { internalHarnessRequested?: boolean } = {}): DesktopRuntimeIdentity {
  return LEMON_IDENTITY
}

export function runtimeDisplayCopy(identity: DesktopRuntimeIdentity) {
  const backendName = `${identity.appName} backend`
  const envPath = `~/${identity.posixHomeDirName}/.env`
  const homePath = `~/${identity.posixHomeDirName}/`
  const gatewayName = `${identity.appName} gateway`

  function rewriteUserText(value: string): string {
    return value
      .replaceAll('~/.hermes/', homePath)
      .replaceAll('hermes backend', backendName)
      .replaceAll('hermes gateway', gatewayName)
      .replaceAll('Hermes backend', backendName)
      .replaceAll('Hermes gateway', gatewayName)
      .replaceAll('Hermes Desktop', identity.appName)
      .replaceAll('Hermes Agent', identity.appName)
      .replace(/\bHermes\b/g, identity.appName)
  }

  return { backendName, envPath, gatewayName, rewriteUserText }
}

export function resolveInternalDesktopBuild({
  internalPackage = false,
  internalHarnessRequested = false
}: {
  internalPackage?: boolean
  internalHarnessRequested?: boolean
} = {}): boolean {
  return internalPackage || internalHarnessRequested
}

export function resolveDefaultDesktopHome({
  homeDir,
  identity,
  isWindows = false,
  localAppData
}: {
  homeDir: string
  identity: DesktopRuntimeIdentity
  isWindows?: boolean
  localAppData?: string | null
}): string {
  if (isWindows && localAppData) {
    return path.join(localAppData, identity.windowsLocalAppDataDirName)
  }

  return path.join(homeDir, identity.posixHomeDirName)
}

export function shouldReadWindowsLemonHomeRegistry(identity: DesktopRuntimeIdentity): boolean {
  return Boolean(resolveDesktopHomeRegistryEnvVarName(identity))
}

export function resolveDesktopHomeRegistryEnvVarName(_identity: DesktopRuntimeIdentity): 'LEMON_HOME' {
  return 'LEMON_HOME'
}

export function shouldPreferWindowsDesktopRegistry(_identity: DesktopRuntimeIdentity): boolean {
  return true
}

export function resolveDesktopRuntimeDirNameRegistryEnvVarName(
  _identity: DesktopRuntimeIdentity
): 'LEMON_INSTALL_RUNTIME_DIR_NAME' {
  return 'LEMON_INSTALL_RUNTIME_DIR_NAME'
}

function envValue(env: Record<string, string | undefined>, name: string): string {
  return (env[name] || '').trim()
}

function identityHomeEnvOverride(env: Record<string, string | undefined>, _identity: DesktopRuntimeIdentity): string {
  return envValue(env, 'LEMON_HOME')
}

export function resolveDesktopHomeOverride(
  env: Record<string, string | undefined>,
  identity: DesktopRuntimeIdentity
): string {
  const desktopOverride = envValue(env, 'LEMON_DESKTOP_HOME_OVERRIDE')

  return desktopOverride || identityHomeEnvOverride(env, identity)
}

export function resolveDesktopHomeOverrideWithRegistry({
  env,
  identity,
  preferRegistry = false,
  registryValue = ''
}: {
  env: Record<string, string | undefined>
  identity: DesktopRuntimeIdentity
  preferRegistry?: boolean
  registryValue?: string | null
}): string {
  const desktopOverride = envValue(env, 'LEMON_DESKTOP_HOME_OVERRIDE')

  if (desktopOverride) {
    return desktopOverride
  }

  const envOverride = identityHomeEnvOverride(env, identity)
  const registryOverride = (registryValue || '').trim()

  return preferRegistry ? registryOverride || envOverride : envOverride || registryOverride
}

export function resolveDesktopHomeOverrideFromWindowsRegistry({
  env,
  identity,
  isWindows = false,
  readRegistry = () => null
}: {
  env: Record<string, string | undefined>
  identity: DesktopRuntimeIdentity
  isWindows?: boolean
  readRegistry?: (name: string) => string | null
}): string {
  const desktopOverride = envValue(env, 'LEMON_DESKTOP_HOME_OVERRIDE')
  const envOverride = identityHomeEnvOverride(env, identity)
  const registryValue = isWindows && !desktopOverride ? readRegistry(resolveDesktopHomeRegistryEnvVarName(identity)) : ''

  return resolveDesktopHomeOverrideWithRegistry({
    env,
    identity,
    preferRegistry: isWindows,
    registryValue: registryValue || envOverride
  })
}

function identityRuntimeDirNameEnvOverride(
  env: Record<string, string | undefined>,
  _identity: DesktopRuntimeIdentity
): string {
  return envValue(env, 'LEMON_INSTALL_RUNTIME_DIR_NAME')
}

export function resolveDesktopRuntimeDirNameOverride(
  env: Record<string, string | undefined>,
  identity: DesktopRuntimeIdentity
): string {
  const desktopOverride = envValue(env, 'LEMON_DESKTOP_RUNTIME_DIR_NAME')

  return desktopOverride || identityRuntimeDirNameEnvOverride(env, identity)
}

export function resolveDesktopRuntimeDirNameOverrideWithRegistry({
  env,
  identity,
  preferRegistry = false,
  registryValue = ''
}: {
  env: Record<string, string | undefined>
  identity: DesktopRuntimeIdentity
  preferRegistry?: boolean
  registryValue?: string | null
}): string {
  const desktopOverride = envValue(env, 'LEMON_DESKTOP_RUNTIME_DIR_NAME')

  if (desktopOverride) {
    return desktopOverride
  }

  const envOverride = identityRuntimeDirNameEnvOverride(env, identity)
  const registryOverride = (registryValue || '').trim()

  return preferRegistry ? registryOverride || envOverride : envOverride || registryOverride
}

export function resolveDesktopRuntimeDirNameOverrideFromWindowsRegistry({
  env,
  identity,
  isWindows = false,
  readRegistry = () => null
}: {
  env: Record<string, string | undefined>
  identity: DesktopRuntimeIdentity
  isWindows?: boolean
  readRegistry?: (name: string) => string | null
}): string {
  const desktopOverride = envValue(env, 'LEMON_DESKTOP_RUNTIME_DIR_NAME')
  const envOverride = identityRuntimeDirNameEnvOverride(env, identity)

  const registryValue = isWindows && !desktopOverride
    ? readRegistry(resolveDesktopRuntimeDirNameRegistryEnvVarName(identity))
    : ''

  return resolveDesktopRuntimeDirNameOverrideWithRegistry({
    env,
    identity,
    preferRegistry: isWindows,
    registryValue: registryValue || envOverride
  })
}

export function resolveDesktopRuntimeRoot(
  lemonHome: string,
  identity: DesktopRuntimeIdentity,
  runtimeDirNameOverride = ''
): string {
  const runtimeDirName = runtimeDirNameOverride.trim() || identity.runtimeRootDirName

  if (runtimeDirName === '.' || runtimeDirName === '..' || runtimeDirName.includes('/') || runtimeDirName.includes('\\')) {
    throw new Error('runtime directory override must be a directory name')
  }

  return path.join(lemonHome, runtimeDirName)
}

export function buildDesktopRuntimeEnv({
  activeRuntimeRoot,
  harnessResourcePath,
  lemonHome,
  identity,
  internalBuild = false,
  legacyHarnessConfigPath,
  updateRepository
}: {
  activeRuntimeRoot: string
  harnessResourcePath?: string | null
  lemonHome: string
  identity: DesktopRuntimeIdentity
  internalBuild?: boolean
  legacyHarnessConfigPath?: string
  updateRepository?: string | null
}): Record<string, string | undefined> {
  const runtimeDirName = path.basename(activeRuntimeRoot)

  return {
    LEMON_BOOTSTRAP_MARKER_NAME: identity.bootstrapMarkerName,
    LEMON_DESKTOP_HARNESS_CONFIG: harnessResourcePath || legacyHarnessConfigPath || undefined,
    LEMON_DESKTOP_HOME_OVERRIDE: lemonHome,
    LEMON_DESKTOP_INTERNAL: internalBuild ? '1' : undefined,
    LEMON_DESKTOP_RUNTIME_DIR_NAME: runtimeDirName,
    LEMON_HOME: lemonHome,
    LEMON_INSTALL_RUNTIME_DIR_NAME: runtimeDirName,
    LEMON_UPDATE_HANDOFF_LOG_NAME: identity.updateHandoffLogName,
    LEMON_UPDATE_MARKER_NAME: identity.updateMarkerName,
    LEMON_UPDATE_PRODUCT_NAME: identity.appName,
    LEMON_UPDATE_REPOSITORY: updateRepository || undefined,
    LEMON_UPDATE_TEMP_PREFIX: identity.updateTempPrefix,
    LEMON_UPDATE_RESULT_NAME: identity.handoffResultName
  }
}

export { LEMON_AI_IDENTITY, LEMON_IDENTITY }
