export function buildLemonBackendSpawnEnv({
  processEnv = process.env,
  runtimeEnv = {},
  lemonHome,
  backendEnv = {},
  terminalCwd,
  sessionToken,
  parentIdentityEnv = {},
  webDist,
  readyFile
}: {
  processEnv?: NodeJS.ProcessEnv | Record<string, string | undefined>
  runtimeEnv?: Record<string, string | undefined>
  lemonHome: string
  backendEnv?: Record<string, string>
  terminalCwd: string
  sessionToken: string
  parentIdentityEnv?: Record<string, string>
  webDist: string
  readyFile?: string | null
}): Record<string, string | undefined> {
  return {
    ...processEnv,
    ...backendEnv,
    ...runtimeEnv,
    LEMON_HOME: lemonHome,
    TERMINAL_CWD: terminalCwd,
    LEMON_DASHBOARD_SESSION_TOKEN: sessionToken,
    LEMON_DESKTOP: '1',
    ...parentIdentityEnv,
    LEMON_WEB_DIST: webDist,
    ...(readyFile ? { LEMON_DESKTOP_READY_FILE: readyFile } : {})
  }
}
