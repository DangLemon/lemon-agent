import fs from 'node:fs'
import path from 'node:path'

export type PackagedAppProductName = 'Lemon AI'

interface PackagedAppIdentity {
  binaryPath: string
  productName: PackagedAppProductName
}

interface ResolvePackagedAppIdentityOptions {
  arch?: string
  exists?: (candidate: string) => boolean
  platform?: NodeJS.Platform
  releaseRoot: string
}

export function resolvePackagedAppIdentity({
  arch = process.arch,
  exists = candidate => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  platform = process.platform,
  releaseRoot
}: ResolvePackagedAppIdentityOptions): PackagedAppIdentity {
  const candidates: PackagedAppIdentity[] = []

  if (platform === 'darwin') {
    const normalizedArch = arch === 'arm64' ? 'arm64' : 'x64'
    for (const directory of [`mac-${normalizedArch}`, 'mac']) {
      candidates.push({
        binaryPath: path.join(releaseRoot, directory, 'Lemon AI.app', 'Contents', 'MacOS', 'Lemon AI'),
        productName: 'Lemon AI'
      })
    }
  } else if (platform === 'win32') {
    for (const directory of ['win-unpacked', 'win-arm64-unpacked']) {
      candidates.push({
        binaryPath: path.join(releaseRoot, directory, 'Lemon AI.exe'),
        productName: 'Lemon AI'
      })
    }
  } else {
    for (const executable of ['Lemon AI', 'lemon-ai']) {
      candidates.push({
        binaryPath: path.join(releaseRoot, 'linux-unpacked', executable),
        productName: 'Lemon AI'
      })
    }
  }

  return candidates.find(candidate => exists(candidate.binaryPath)) ?? candidates[0]
}
