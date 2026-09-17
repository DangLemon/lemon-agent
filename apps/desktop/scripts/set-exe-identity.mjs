#!/usr/bin/env node
// set-exe-identity.mjs - stamp the selected icon + version metadata onto the
// built Lemon AI.exe using rcedit, completely decoupled from electron-builder's
// signing path.
//
// WHY THIS EXISTS
// ---------------
// apps/desktop/package.json sets build.win.signAndEditExecutable=false. That
// flag is load-bearing: turning electron-builder's own exe-editing ON also
// re-enables its signtool step, which fetches winCodeSign-2.6.0.7z, whose
// macOS symlinks crash 7-Zip on non-admin Windows (no Developer Mode = no
// SeCreateSymbolicLinkPrivilege). That is an unfixable dead end — we do NOT
// try to extract winCodeSign.
//
// The cost of disabling signAndEditExecutable is that electron-builder also
// skips rcedit, so the unpacked Lemon AI.exe keeps the stock Electron icon and
// "Electron" taskbar name. This script restores the icon + identity by calling
// rcedit DIRECTLY. rcedit is a pure PE resource editor: no signing, no certs,
// no winCodeSign, no symlinks.
//
// HOW IT RUNS
// -----------
// Primarily as an electron-builder `afterPack` hook (scripts/after-pack.mjs),
// so EVERY packed build — first install, `lemon desktop`, the installer's
// --update rebuild, or a dev's manual `npm run pack` — gets a branded exe from
// one place. Previously this stamp lived only in install.ps1, so the update
// path (which rebuilds via `lemon desktop --build-only`, never install.ps1)
// shipped a stock "Electron" exe. Keeping it in afterPack closes that gap.
//
// Also runnable standalone for ad-hoc re-stamping:
//   node scripts/set-exe-identity.mjs <path-to-Lemon AI.exe>
//
// Exits 0 on success, non-zero on failure when run as a CLI. As a hook,
// stampExeIdentity() resolves on success and rejects on failure; the caller
// (after-pack.mjs) swallows the rejection so a stamp failure never fails an
// otherwise-good build (worst case: stock icon, not a broken app).

import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { rcedit } from 'rcedit'

import { isMain } from './utils.mjs'
import { exeIdentityForMode, resolveDesktopBuildMode } from './desktop-build-identity.mjs'

function stampOptions(options) {
  if (typeof options === 'string') {
    return { desktopRoot: options }
  }
  return options ?? {}
}

export function resolveExeIdentity({ desktopRoot = resolve(import.meta.dirname, '..'), env = process.env, harnessResource } = {}) {
  return exeIdentityForMode(resolveDesktopBuildMode({ env, harnessResource }), desktopRoot)
}

// Stamp the selected icon + identity onto `exe`. Resolves on success, throws on
// failure. `desktopRoot` defaults to this script's package root so the icon and
// the rcedit dependency resolve regardless of cwd.
async function stampExeIdentity(exe, options) {
  const {
    desktopRoot = resolve(import.meta.dirname, '..'),
    env = process.env,
    harnessResource,
    rcedit: editExecutable = rcedit
  } = stampOptions(options)

  if (!exe || !existsSync(exe)) {
    throw new Error(`target exe not found: ${exe}`)
  }

  const identity = resolveExeIdentity({ desktopRoot, env, harnessResource })
  if (!existsSync(identity.icon)) {
    throw new Error(`icon not found: ${identity.icon}`)
  }

  console.log(`[set-exe-identity] stamping ${exe}`)
  console.log(`[set-exe-identity] icon: ${identity.icon}`)

  await editExecutable(exe, {
    icon: identity.icon,
    'version-string': {
      ProductName: identity.productName,
      FileDescription: identity.fileDescription,
      CompanyName: identity.companyName,
      LegalCopyright: identity.legalCopyright
    }
  })

  console.log(`[set-exe-identity] done - ${identity.productName} icon + identity stamped`)
}

export { stampExeIdentity }

// CLI entry point: `node scripts/set-exe-identity.mjs <exe>`.
if (isMain(import.meta.url)) {
  const exe = process.argv[2]
  if (!exe) {
    console.error('[set-exe-identity] usage: set-exe-identity.mjs <path-to-exe>')
    process.exit(2)
  }
  stampExeIdentity(exe).catch(err => {
    console.error(`[set-exe-identity] ${err.message}`)
    process.exit(1)
  })
}
