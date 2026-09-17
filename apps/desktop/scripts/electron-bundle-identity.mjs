import { generateInternalDesktopHarnessResource, loadHarnessConfigInput } from './internal-desktop-harness.mjs'

const DEFINE_PREFIX = 'process.env.'

export function resolveElectronBundleDefines({ env = process.env, isDev = false } = {}) {
  const internalPackage = Boolean(loadHarnessConfigInput(env))

  if (isDev) {
    return internalPackage
      ? { [`${DEFINE_PREFIX}LEMON_DESKTOP_INTERNAL_PACKAGE`]: JSON.stringify('1') }
      : {}
  }

  return {
    [`${DEFINE_PREFIX}LEMON_DESKTOP_IS_PACKAGED`]: JSON.stringify(true),
    [`${DEFINE_PREFIX}LEMON_DESKTOP_INTERNAL_PACKAGE`]: JSON.stringify(internalPackage ? '1' : '')
  }
}

export function prepareElectronBundleDefines({ env = process.env, isDev = false, buildDir } = {}) {
  if (isDev) {
    generateInternalDesktopHarnessResource({ env, buildDir })
  }

  return resolveElectronBundleDefines({ env, isDev })
}
