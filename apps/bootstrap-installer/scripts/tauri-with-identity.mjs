#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'


export function internalDesktopBuild() {
  return true
}

export function withIdentityConfig(args, envInput = process.env) {
  return { args, env: { ...envInput, LEMON_INSTALLER_BRAND: 'lemon' } }
}

export function isDirectRun(metaUrl, argv1 = process.argv[1], {
  resolve = path.resolve,
  pathToFileURLHref = value => pathToFileURL(value).href
} = {}) {
  return Boolean(argv1) && metaUrl === pathToFileURLHref(resolve(argv1))
}

export function main() {
  const { args, env } = withIdentityConfig(process.argv.slice(2))
  const bin = process.platform === 'win32' ? 'tauri.cmd' : 'tauri'
  const result = spawnSync(bin, args, { env, stdio: 'inherit', shell: false })

  if (result.error) {
    console.error(`[tauri-with-identity] failed to launch ${bin}: ${result.error.message}`)
    process.exit(1)
  }

  process.exit(result.status ?? 1)
}

if (isDirectRun(import.meta.url)) {
  main()
}
