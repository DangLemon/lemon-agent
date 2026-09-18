import path from 'node:path'

import { loadHarnessConfigInput } from './internal-desktop-harness.mjs'

const INTERNAL_MODE = 'internal'
const ORDINARY_MODE = 'ordinary'
const DISABLED_AUTO_DISCOVERY_VALUES = new Set(['false', '0', 'no'])

const LEMON_MAC_COPY = {
  CFBundleDisplayName: 'Lemon AI',
  CFBundleExecutable: 'Lemon AI',
  CFBundleName: 'Lemon AI',
  NSHumanReadableCopyright: 'Copyright © 2026 Lemon Digital',
  NSAudioCaptureUsageDescription: 'Lemon AI uses audio capture for voice conversations.',
  NSCameraUsageDescription: 'Lemon AI uses the camera when a plugin or feature you enable requests it.',
  NSMicrophoneUsageDescription: 'Lemon AI uses the microphone for voice input and voice conversations.',
  NSCalendarsUsageDescription: 'Lemon AI needs access to Calendar to provide requested meeting and scheduling support.',
  NSCalendarsFullAccessUsageDescription:
    'Lemon AI needs full access to Calendar to read and manage events when explicitly requested.',
  NSRemindersUsageDescription:
    'Lemon AI needs access to Reminders to provide requested personal-assistant and scheduling support.',
  NSRemindersFullAccessUsageDescription:
    'Lemon AI needs full access to Reminders to read and manage reminders when explicitly requested.',
  NSScreenCaptureUsageDescription: 'Lemon AI captures the screen when you ask the agent to screenshot or record it.',
  NSLocalNetworkUsageDescription:
    'Lemon AI connects to devices on your local network when a plugin or feature you enable requests it.',
  NSAppleMusicUsageDescription: 'Lemon AI accesses your music library when a plugin or feature you enable requests it.'
}

export function resolveDesktopBuildMode({ env = process.env, harnessResource } = {}) {
  const resource = harnessResource === undefined ? loadHarnessConfigInput(env) : harnessResource
  return resource ? INTERNAL_MODE : ORDINARY_MODE
}

export function createDesktopPackageConfig(baseBuild, { env = process.env, harnessResource } = {}) {
  const config = structuredClone(baseBuild)

  if (resolveDesktopBuildMode({ env, harnessResource }) !== INTERNAL_MODE) {
    return config
  }

  config.productName = 'Lemon AI'
  config.appId = 'com.lemondigital.lemonai'
  config.executableName = 'Lemon AI'
  config.extraMetadata = {
    ...(config.extraMetadata || {}),
    name: 'lemon-ai',
    productName: 'Lemon AI',
    author: {
      name: 'Lemon Digital'
    },
    description: 'Native desktop shell for Lemon AI.',
    homepage: 'https://github.com/DangLemon/lemon-agent',
    bugs: {
      url: 'https://github.com/DangLemon/lemon-agent/issues'
    },
    repository: {
      type: 'git',
      url: 'git+https://github.com/DangLemon/lemon-agent.git'
    }
  }
  config.copyright = 'Copyright © 2026 Lemon Digital'
  config.artifactName = 'Lemon-AI-${version}-${os}-${arch}.${ext}'
  config.icon = 'assets/lemon-icon'
  config.extraResources = config.extraResources.map(entry =>
    entry?.from === 'assets/icon.ico' && entry?.to === 'icon.ico' ? { ...entry, from: 'assets/lemon-icon.ico' } : entry
  )
  config.mac = {
    ...config.mac,
    executableName: 'Lemon AI',
    extendInfo: {
      ...config.mac.extendInfo,
      ...LEMON_MAC_COPY
    }
  }
  applyMacSigningIdentity(config.mac, env)
  if (shouldUseAdhocMacIdentity(config.mac, env)) {
    config.mac.identity = '-'
  }
  config.dmg = {
    ...config.dmg,
    title: 'Install Lemon AI'
  }
  config.win = {
    ...config.win,
    legalTrademarks: 'Lemon AI'
  }
  config.linux = {
    ...config.linux,
    maintainer: 'Lemon Digital',
    synopsis: 'Native desktop shell for Lemon AI.'
  }
  config.nsis = {
    ...config.nsis,
    shortcutName: 'Lemon AI',
    uninstallDisplayName: 'Lemon AI'
  }
  config.protocols = config.protocols.map(protocol =>
    Array.isArray(protocol?.schemes) && protocol.schemes.includes('lemon')
      ? { ...protocol, name: 'Lemon AI Protocol' }
      : protocol
  )

  return config
}

export function applyMacSigningIdentity(macConfig = {}, env = process.env) {
  if (hasOwn(macConfig, 'identity')) return macConfig
  if (hasValue(env.CSC_NAME)) return macConfig
  if (hasValue(env.APPLE_SIGNING_IDENTITY)) {
    macConfig.identity = env.APPLE_SIGNING_IDENTITY.trim()
  }
  return macConfig
}

export function shouldUseAdhocMacIdentity(macConfig = {}, env = process.env) {
  if (hasOwn(macConfig, 'identity')) return false
  const autoDiscovery = String(env.CSC_IDENTITY_AUTO_DISCOVERY ?? '')
    .trim()
    .toLowerCase()
  if (!DISABLED_AUTO_DISCOVERY_VALUES.has(autoDiscovery)) return false
  return !hasValue(env.CSC_LINK) && !hasValue(env.CSC_NAME) && !hasValue(env.APPLE_SIGNING_IDENTITY)
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function exeIdentityForMode(_mode, desktopRoot) {
  return {
    icon: path.join(desktopRoot, 'assets', 'lemon-icon.ico'),
    productName: 'Lemon AI',
    fileDescription: 'Lemon AI',
    companyName: 'Lemon Digital',
    legalCopyright: 'Copyright (c) 2026 Lemon Digital'
  }
}

export { LEMON_MAC_COPY }
