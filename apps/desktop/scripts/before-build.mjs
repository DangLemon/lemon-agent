/**
 * Desktop bundles ship precompiled renderer assets. Returning false here tells
 * electron-builder to skip the node_modules collector/install step, which
 * avoids workspace dependency graph explosions and keeps packaging
 * deterministic across environments. The Lemon AI Python payload is no
 * longer bundled; the Electron app fetches it at first launch via
 * `install.ps1`'s stage protocol (Windows). See `electron/main.ts`.
 */
import { generateInternalDesktopHarnessResource } from './internal-desktop-harness.mjs'

export default async function beforeBuild() {
  generateInternalDesktopHarnessResource()
  return false
}
