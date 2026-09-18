/**
 * Decide whether the desktop may fall back to a runtime discovered outside
 * its managed install.
 *
 * The internal Lemon AI harness owns its runtime and configuration. Allowing
 * an unrelated `lemon` command from PATH to win during first launch sends
 * the harness seed helper through a shell shim that has no discoverable Python
 * interpreter, and can also reopen the legacy ~/.lemon-ai installation. An
 * explicitly supplied command remains an intentional escape hatch for
 * development and deployment environments.
 */
export function shouldAllowExternalRuntime({
  explicitCommand,
  internalHarnessActive
}: {
  explicitCommand?: string | null
  internalHarnessActive: boolean
}): boolean {
  if (!internalHarnessActive) {
    return true
  }

  return typeof explicitCommand === 'string' && explicitCommand.trim().length > 0
}
