#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { resolveEnvironmentReferences, validateHarnessResource } from './internal-desktop-harness.mjs'
import PACKAGE_JSON from '../package.json' with { type: 'json' }
const DESKTOP_ROOT = path.resolve(import.meta.dirname, '..')
const REPO_ROOT = path.resolve(DESKTOP_ROOT, '..', '..')
const DEFAULT_RELEASE_ROOT = path.join(DESKTOP_ROOT, 'release')
const DEFAULT_CANONICAL_MANIFEST = path.join(DESKTOP_ROOT, 'lemon-ai-desktop.config.json')
const DEFAULT_GENERATED_CONFIG = path.join(DESKTOP_ROOT, 'build', 'electron-builder.generated.json')
const DEFAULT_SEED_HELPER = path.join(DESKTOP_ROOT, 'electron', 'lemon-ai-harness-seed.py')
const RECEIPT_FILENAME = 'installer-receipt.json'
const RENDERER_HARNESS_MARKER_FILENAME = 'lemon-ai-renderer-harness.json'

const EXPECTED_REPOSITORY = 'DangLemon/lemon-agent'
const EXPECTED_WINDOWS_VERSION = {
  ProductName: 'Lemon AI',
  FileDescription: 'Lemon AI',
  CompanyName: 'Lemon Digital',
  LegalCopyright: 'Copyright (c) 2026 Lemon Digital'
}
const EXPECTED_MAC_PLIST = {
  CFBundleDisplayName: 'Lemon AI',
  CFBundleName: 'Lemon AI',
  CFBundleExecutable: 'Lemon AI',
  NSHumanReadableCopyright: 'Copyright © 2026 Lemon Digital'
}
const MACHO_CPU_TYPES = {
  arm64: 0x0100000c,
  x64: 0x01000007
}
const PE_MACHINES = {
  x64: 0x8664,
  arm64: 0xaa64
}
const PLATFORM_TO_OS = {
  darwin: 'mac',
  win32: 'win'
}
const PLATFORM_TO_NODE_PTY = {
  darwin: 'darwin',
  win32: 'win32'
}
const WINDOWS_VERSION_INFO_TIMEOUT_MS = 30_000
const CODESIGN_TIMEOUT_MS = 30_000
const DEVELOPER_ID_REQUIREMENT = '=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists'

function fail(message) {
  throw new Error(`[verify-internal-installer] ${message}`)
}

function ensureFile(filePath, label = 'file') {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null
  if (!stat?.isFile()) fail(`missing ${label}: ${filePath}`)
  if (stat.size === 0) fail(`${label} is empty: ${filePath}`)
  return stat
}

function ensureDirectory(dirPath, label = 'directory') {
  const stat = fs.existsSync(dirPath) ? fs.statSync(dirPath) : null
  if (!stat?.isDirectory()) fail(`missing ${label}: ${dirPath}`)
  return stat
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON: ${filePath}: ${error.message}`)
  }
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) fail(`unexpected argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[i + 1]
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`)
    args[key] = value
    i += 1
  }

  return {
    platform: args.platform ?? env.LEMON_INSTALLER_PLATFORM ?? process.platform,
    arch: args.arch ?? env.LEMON_INSTALLER_ARCH ?? process.arch,
    expectedSha: args.sha ?? env.LEMON_INSTALLER_SHA ?? env.GITHUB_SHA,
    expectedRef: args.ref ?? env.LEMON_INSTALLER_REF ?? env.GITHUB_REF_NAME ?? env.GITHUB_HEAD_REF,
    appPath: args.app ?? env.LEMON_INSTALLER_APP,
    installerPath: args.installer ?? env.LEMON_INSTALLER_ARTIFACT,
    canonicalManifestPath: args.canonical ?? env.LEMON_INSTALLER_CANONICAL_MANIFEST ?? DEFAULT_CANONICAL_MANIFEST,
    generatedConfigPath: args['builder-config'] ?? env.LEMON_INSTALLER_BUILDER_CONFIG ?? DEFAULT_GENERATED_CONFIG,
    sourceSeedHelperPath: args['seed-helper'] ?? env.LEMON_INSTALLER_SEED_HELPER ?? DEFAULT_SEED_HELPER,
    outputDir: args.out ?? env.LEMON_INSTALLER_OUTPUT_DIR,
    releaseRoot: args['release-root'] ?? env.LEMON_INSTALLER_RELEASE_ROOT ?? DEFAULT_RELEASE_ROOT,
    repoRoot: args['repo-root'] ?? env.LEMON_INSTALLER_REPO_ROOT ?? REPO_ROOT
  }
}

export function resolveLayout({
  platform,
  arch,
  releaseRoot = DEFAULT_RELEASE_ROOT,
  appPath,
  installerPath,
  version = PACKAGE_JSON.version
}) {
  if (!['darwin', 'win32'].includes(platform)) {
    fail(`unsupported platform: ${platform}`)
  }
  if ((platform === 'darwin' && arch !== 'arm64') || (platform === 'win32' && arch !== 'x64')) {
    fail(`unsupported target: ${platform}-${arch}`)
  }

  const osName = PLATFORM_TO_OS[platform]
  const ext = platform === 'darwin' ? 'dmg' : 'exe'
  const resolvedAppPath = appPath
    ? path.resolve(appPath)
    : platform === 'darwin'
      ? path.join(releaseRoot, 'mac-arm64', 'Lemon AI.app')
      : path.join(releaseRoot, 'win-unpacked')
  const resolvedInstallerPath = installerPath
    ? path.resolve(installerPath)
    : path.join(releaseRoot, `Lemon-AI-${version}-${osName}-${arch}.${ext}`)
  const resourcesPath =
    platform === 'darwin'
      ? path.join(resolvedAppPath, 'Contents', 'Resources')
      : path.join(resolvedAppPath, 'resources')
  const binaryPath =
    platform === 'darwin'
      ? path.join(resolvedAppPath, 'Contents', 'MacOS', 'Lemon AI')
      : path.join(resolvedAppPath, 'Lemon AI.exe')

  return {
    appPath: resolvedAppPath,
    installerPath: resolvedInstallerPath,
    resourcesPath,
    binaryPath,
    packagedManifestPath: path.join(resourcesPath, 'lemon-ai-harness.json'),
    packagedSeedHelperPath: path.join(resourcesPath, 'lemon-ai-harness-seed.py'),
    stampPath: path.join(resourcesPath, 'install-stamp.json'),
    unpackedDistIndex: path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'index.html'),
    rendererHarnessMarkerPath: path.join(resourcesPath, 'app.asar.unpacked', 'dist', RENDERER_HARNESS_MARKER_FILENAME),
    nodePtyRoot: path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'node_modules', 'node-pty'),
    getWindowsRoot: path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'node_modules', 'get-windows'),
    osName,
    expectedInstallerName: `Lemon-AI-${version}-${osName}-${arch}.${ext}`
  }
}

export function assertCanonicalManifestBytes({ canonicalManifestPath, packagedManifestPath, allowBakedSecrets = false }) {
  if (!allowBakedSecrets) {
    const canonical = Buffer.from(`${JSON.stringify(readJson(canonicalManifestPath, 'canonical harness manifest'), null, 2)}\n`)
    const packaged = fs.readFileSync(packagedManifestPath)
    if (!canonical.equals(packaged)) {
      fail(`packaged harness manifest bytes differ from canonical generated bytes: ${packagedManifestPath}`)
    }
    return
  }

  const canonical = resolveEnvironmentReferences(readJson(canonicalManifestPath, 'canonical harness manifest'), process.env, { required: true })
  const packaged = readJson(packagedManifestPath, 'packaged harness manifest')
  const canonicalBytes = Buffer.from(`${JSON.stringify(canonical, null, 2)}\n`)
  const packagedBytes = Buffer.from(`${JSON.stringify(packaged, null, 2)}\n`)
  if (!canonicalBytes.equals(packagedBytes)) {
    fail(`packaged harness manifest differs from canonical generated bytes: ${packagedManifestPath}`)
  }
}

export function assertCanonicalSeedHelperBytes({ sourceSeedHelperPath, packagedSeedHelperPath }) {
  ensureFile(sourceSeedHelperPath, 'source seed helper')
  ensureFile(packagedSeedHelperPath, 'packaged seed helper')
  const source = fs.readFileSync(sourceSeedHelperPath)
  const packaged = fs.readFileSync(packagedSeedHelperPath)
  if (!source.equals(packaged)) {
    fail(`packaged seed helper bytes differ from source helper: ${packagedSeedHelperPath}`)
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

export function validateHarnessManifest(manifest, { allowBakedSecrets = false } = {}) {
  const resource = validateHarnessResource(manifest, { allowBakedSecrets })
  assertEqual(resource.sourceRepository, EXPECTED_REPOSITORY, 'harness sourceRepository')
  return resource
}

export function validateStamp(stamp, { expectedSha, expectedRef }) {
  if (!/^[0-9a-f]{40}$/i.test(expectedSha ?? ''))
    fail(`expected SHA must be a full 40-character commit: ${expectedSha ?? '<missing>'}`)
  if (!expectedRef) fail('expected ref is required')
  assertEqual(stamp.schemaVersion, 1, 'install stamp schemaVersion')
  assertEqual(stamp.commit, expectedSha, 'install stamp commit')
  assertEqual(stamp.branch, expectedRef, 'install stamp branch')
  assertEqual(stamp.dirty, false, 'install stamp dirty')
  assertEqual(stamp.source, 'ci', 'install stamp source')
}

export function validateGeneratedConfig(config) {
  assertEqual(config.artifactName, 'Lemon-AI-${version}-${os}-${arch}.${ext}', 'electron-builder artifactName')
  assertEqual(config.icon, 'assets/lemon-icon', 'electron-builder icon')
  assertEqual(config.dmg?.title, 'Install Lemon AI', 'electron-builder dmg.title')
  assertEqual(config.productName, 'Lemon AI', 'electron-builder productName')
  assertEqual(config.executableName, 'Lemon AI', 'electron-builder executableName')
  assertEqual(config.extraMetadata?.name, 'lemon-ai', 'electron-builder extraMetadata.name')
  assertEqual(config.extraMetadata?.productName, 'Lemon AI', 'electron-builder extraMetadata.productName')
  assertEqual(config.extraMetadata?.author?.name, 'Lemon Digital', 'electron-builder extraMetadata.author.name')
  assertEqual(
    config.extraMetadata?.description,
    'Native desktop shell for Lemon AI.',
    'electron-builder extraMetadata.description'
  )
  assertEqual(
    config.extraMetadata?.homepage,
    'https://github.com/DangLemon/lemon-agent',
    'electron-builder extraMetadata.homepage'
  )
  assertEqual(
    config.extraMetadata?.bugs?.url,
    'https://github.com/DangLemon/lemon-agent/issues',
    'electron-builder extraMetadata.bugs.url'
  )
  assertEqual(
    config.extraMetadata?.repository?.url,
    'git+https://github.com/DangLemon/lemon-agent.git',
    'electron-builder extraMetadata.repository.url'
  )
  assertEqual(config.copyright, 'Copyright © 2026 Lemon Digital', 'electron-builder copyright')
  if (Object.hasOwn(config, 'publish')) fail('electron-builder config must not publish installers directly')
  assertEqual(config.mac?.executableName, 'Lemon AI', 'electron-builder mac.executableName')
  assertEqual(
    config.mac?.extendInfo?.CFBundleExecutable,
    'Lemon AI',
    'electron-builder mac.extendInfo.CFBundleExecutable'
  )
  assertEqual(config.appId, 'com.lemondigital.lemonai', 'electron-builder appId')

  const serializedConfig = JSON.stringify(config)
  if (serializedConfig.includes('NousResearch/hermes-agent'))
    fail('electron-builder config contains upstream Hermes repository')
  if (serializedConfig.includes('lemon-updater'))
    fail('electron-builder config contains upstream Lemon AI updater cache name')
}

export function validateRendererHarnessMarker({ markerPath, manifest }) {
  ensureFile(markerPath, 'renderer harness marker')
  const marker = readJson(markerPath, 'renderer harness marker')
  assertEqual(marker.schemaVersion, 1, 'renderer harness schemaVersion')
  assertEqual(marker.profile, 'internal', 'renderer harness profile')

  for (const key of ['agents', 'cron', 'messaging', 'terminal', 'webhooks']) {
    assertEqual(marker.ui?.[key], manifest.ui?.[key], `renderer harness ui.${key}`)
  }

  return marker
}

export function readMachOArchitectures(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.length < 8) fail(`Mach-O file is too small: ${filePath}`)
  const magic = buffer.readUInt32BE(0)

  if (magic === 0xcafebabe || magic === 0xbebafeca) {
    const littleEndian = magic === 0xbebafeca
    const read32 = littleEndian ? buffer.readUInt32LE.bind(buffer) : buffer.readUInt32BE.bind(buffer)
    const count = read32(4)
    const archs = []
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * 20
      if (offset + 20 > buffer.length) fail(`fat Mach-O arch table is truncated: ${filePath}`)
      archs.push(read32(offset))
    }
    return archs
  }

  if (magic === 0xfeedface || magic === 0xfeedfacf) {
    return [buffer.readUInt32BE(4)]
  }
  if (magic === 0xcefaedfe || magic === 0xcffaedfe) {
    return [buffer.readUInt32LE(4)]
  }
  fail(`not a Mach-O binary: ${filePath}`)
}

export function readPEMachine(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.length < 0x40 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) fail(`not a PE binary: ${filePath}`)
  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 6 > buffer.length || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') {
    fail(`invalid PE header: ${filePath}`)
  }
  return buffer.readUInt16LE(peOffset + 4)
}

function cpuTypeName(cpuType) {
  for (const [name, value] of Object.entries(MACHO_CPU_TYPES)) {
    if (value === cpuType) return name
  }
  return `0x${cpuType.toString(16)}`
}

export function validateMachOArch(filePath, expectedArch) {
  const expected = MACHO_CPU_TYPES[expectedArch]
  const archs = readMachOArchitectures(filePath)
  if (archs.length !== 1 || archs[0] !== expected) {
    fail(`${path.basename(filePath)} must contain only ${expectedArch}; got ${archs.map(cpuTypeName).join(', ')}`)
  }
}

export function validatePEArch(filePath, expectedArch) {
  const expected = PE_MACHINES[expectedArch]
  const machine = readPEMachine(filePath)
  if (machine !== expected) {
    fail(
      `${path.basename(filePath)} must be ${expectedArch} PE machine 0x${expected.toString(16)}; got 0x${machine.toString(16)}`
    )
  }
}

function collectFiles(root, predicate) {
  const files = []
  function visit(dir) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(fullPath)
      } else if (predicate(fullPath, entry.name)) {
        files.push(fullPath)
      }
    }
  }
  visit(root)
  return files
}

export function validateNativePayload({ layout, platform, arch }) {
  ensureFile(layout.unpackedDistIndex, 'unpacked renderer index')
  ensureFile(path.join(layout.nodePtyRoot, 'package.json'), 'node-pty package.json')
  ensureFile(path.join(layout.nodePtyRoot, 'lib', 'index.js'), 'node-pty lib/index.js')

  const nodePlatform = PLATFORM_TO_NODE_PTY[platform]
  const selectedDirs = [
    path.join(layout.nodePtyRoot, 'prebuilds', `${nodePlatform}-${arch}`),
    path.join(layout.nodePtyRoot, 'build', 'Release')
  ].filter(dir => fs.existsSync(dir))
  const selectedNodeFiles = selectedDirs.flatMap(dir => collectFiles(dir, file => file.endsWith('.node')))
  if (selectedNodeFiles.length === 0) {
    fail(`missing node-pty native .node payload for ${nodePlatform}-${arch}`)
  }

  for (const file of selectedNodeFiles) {
    if (platform === 'darwin') validateMachOArch(file, arch)
    if (platform === 'win32') validatePEArch(file, arch)
  }

  let spawnHelper = null
  if (platform === 'darwin') {
    spawnHelper = selectedDirs.map(dir => path.join(dir, 'spawn-helper')).find(file => fs.existsSync(file))
    if (!spawnHelper) fail(`missing node-pty spawn-helper for ${nodePlatform}-${arch}`)
    const mode = fs.statSync(spawnHelper).mode
    if ((mode & 0o111) === 0) fail(`node-pty spawn-helper is not executable: ${spawnHelper}`)
    validateMachOArch(spawnHelper, arch)
  }

  let getWindowsBinding = null
  if (platform === 'win32') {
    const bindingRoot = path.join(layout.getWindowsRoot, 'lib', 'binding')
    const bindings = collectFiles(
      bindingRoot,
      (file, name) => name === 'node-get-windows.node' && file.includes(`-${platform}-`) && file.includes(`-${arch}`)
    )
    if (bindings.length === 0) fail(`missing get-windows native binding for ${platform}-${arch}`)
    bindings.forEach(file => validatePEArch(file, arch))
    getWindowsBinding = bindings[0]
  }

  return {
    nodePtyBinaries: selectedNodeFiles,
    spawnHelper,
    getWindowsBinding
  }
}

function readXmlPlistStrings(contents) {
  const values = {}
  const re = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g
  let match
  while ((match = re.exec(contents)) !== null) {
    values[match[1]] = match[2]
  }
  return values
}

export function readMacPlist(plistPath, { spawn = spawnSync } = {}) {
  if (process.platform === 'darwin') {
    const result = spawn('plutil', ['-convert', 'json', '-o', '-', plistPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    if (result.status === 0) {
      return JSON.parse(result.stdout)
    }
  }

  const contents = fs.readFileSync(plistPath, 'utf8')
  if (contents.trim().startsWith('{')) return JSON.parse(contents)
  return readXmlPlistStrings(contents)
}

export function validateMacIdentity(appPath, options) {
  const plist = readMacPlist(path.join(appPath, 'Contents', 'Info.plist'), options)
  for (const [key, expected] of Object.entries(EXPECTED_MAC_PLIST)) {
    assertEqual(plist[key], expected, `Info.plist ${key}`)
  }
}

export function validateMacCodeSignature(appPath, { spawn = spawnSync } = {}) {
  const codeResources = path.join(appPath, 'Contents', '_CodeSignature', 'CodeResources')
  ensureFile(codeResources, 'macOS code signature resources')

  const verify = spawn('codesign', ['--verify', '--deep', '--strict', appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: CODESIGN_TIMEOUT_MS
  })
  if (verify.status !== 0) {
    const detail =
      verify.stderr?.trim() || verify.stdout?.trim() || verify.error?.message || `exit status ${verify.status}`
    fail(`codesign verification failed for ${appPath}: ${detail}`)
  }

  const display = spawn('codesign', ['-dv', '--verbose=4', appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: CODESIGN_TIMEOUT_MS
  })
  if (display.status !== 0) {
    const detail =
      display.stderr?.trim() || display.stdout?.trim() || display.error?.message || `exit status ${display.status}`
    fail(`codesign signature detail failed for ${appPath}: ${detail}`)
  }

  const output = `${display.stdout ?? ''}\n${display.stderr ?? ''}`
  if (/Signature=adhoc\b/.test(output)) return { codeResources, signature: 'adhoc' }
  if (/Authority=Developer ID Application:/i.test(output)) {
    validateDeveloperIdRequirement(appPath, { spawn })
    return { codeResources, signature: 'developer-id' }
  }
  fail(`codesign signature identity is neither ad-hoc nor Developer ID for ${appPath}`)
}

export function validateDeveloperIdRequirement(appPath, { spawn = spawnSync } = {}) {
  const result = spawn('codesign', ['--verify', '--strict', '--test-requirement', DEVELOPER_ID_REQUIREMENT, appPath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: CODESIGN_TIMEOUT_MS
  })
  if (result.status !== 0) {
    const detail =
      result.stderr?.trim() || result.stdout?.trim() || result.error?.message || `exit status ${result.status}`
    fail(`Developer ID code requirement failed for ${appPath}: ${detail}`)
  }
}

export function readWindowsVersionInfo(exePath, { spawn = spawnSync } = {}) {
  if (process.platform !== 'win32') {
    fail(`Windows VersionInfo requires Windows: ${exePath}`)
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-versioninfo-'))
  const scriptPath = path.join(tempDir, 'read-versioninfo.ps1')
  try {
    fs.writeFileSync(
      scriptPath,
      [
        'param([Parameter(Mandatory=$true)][string]$Path)',
        "$ErrorActionPreference = 'Stop'",
        '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
        '$v = (Get-Item -LiteralPath $Path -ErrorAction Stop).VersionInfo',
        '$o = [ordered]@{',
        '  ProductName = $v.ProductName',
        '  FileDescription = $v.FileDescription',
        '  CompanyName = $v.CompanyName',
        '  LegalCopyright = $v.LegalCopyright',
        '}',
        '$o | ConvertTo-Json -Compress'
      ].join('\n'),
      'utf8'
    )
    const result = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, exePath],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: WINDOWS_VERSION_INFO_TIMEOUT_MS
      }
    )

    if (result.status !== 0) {
      const detail = result.stderr.trim() || result.error?.message || `exit status ${result.status}`
      fail(`PowerShell VersionInfo query failed for ${exePath}: ${detail}`)
    }

    let parsed
    try {
      parsed = JSON.parse(result.stdout)
    } catch (error) {
      fail(`PowerShell VersionInfo query returned invalid JSON for ${exePath}: ${error.message}`)
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      fail(`PowerShell VersionInfo query returned malformed JSON for ${exePath}`)
    }

    for (const key of Object.keys(EXPECTED_WINDOWS_VERSION)) {
      if (typeof parsed[key] !== 'string' || parsed[key].length === 0) {
        fail(`Windows executable VersionInfo ${key}: missing native VersionInfo value`)
      }
    }
    return parsed
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

export function validateWindowsIdentity(exePath, options) {
  const readVersionInfo = options?.readWindowsVersionInfo ?? readWindowsVersionInfo
  const versionInfo = readVersionInfo(exePath)
  for (const [key, expected] of Object.entries(EXPECTED_WINDOWS_VERSION)) {
    assertEqual(versionInfo[key], expected, `Windows executable VersionInfo ${key}`)
  }
}

export function validateGitHead({ repoRoot = REPO_ROOT, expectedSha, spawn = spawnSync } = {}) {
  const result = spawn('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (result.status !== 0) fail(`git rev-parse HEAD failed in ${repoRoot}: ${result.stderr.trim()}`)
  const actual = result.stdout.trim()
  assertEqual(actual, expectedSha, 'git HEAD')
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

export function writeVerifiedOutput({ installerPath, outputDir, receipt }) {
  if (!outputDir) fail('output directory is required')
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  const installerName = path.basename(installerPath)
  const outputInstaller = path.join(outputDir, installerName)
  fs.copyFileSync(installerPath, outputInstaller)

  const checksumPath = path.join(outputDir, `${installerName}.sha256`)
  fs.writeFileSync(checksumPath, `${receipt.sha256}  ${installerName}\n`, 'utf8')

  const receiptPath = path.join(outputDir, RECEIPT_FILENAME)
  fs.writeFileSync(
    receiptPath,
    `${JSON.stringify(
      {
        ...receipt,
        installer: installerName,
        checksumFile: path.basename(checksumPath)
      },
      null,
      2
    )}\n`,
    'utf8'
  )

  return {
    outputInstaller,
    checksumPath,
    receiptPath
  }
}

export function verifyInternalInstaller(options) {
  const config = {
    sourceSeedHelperPath: DEFAULT_SEED_HELPER,
    version: PACKAGE_JSON.version,
    ...options
  }
  const layout = resolveLayout(config)
  ensureDirectory(layout.appPath, 'unpacked app')
  ensureFile(layout.binaryPath, 'packaged app executable')
  ensureFile(layout.installerPath, 'installer artifact')
  ensureFile(config.canonicalManifestPath, 'canonical harness manifest')
  ensureFile(layout.packagedManifestPath, 'packaged harness manifest')
  ensureFile(config.sourceSeedHelperPath, 'source seed helper')
  ensureFile(layout.packagedSeedHelperPath, 'packaged seed helper')
  ensureFile(layout.stampPath, 'packaged install stamp')
  ensureFile(config.generatedConfigPath, 'generated electron-builder config')

  if (path.basename(layout.installerPath) !== layout.expectedInstallerName) {
    fail(`installer basename must be ${layout.expectedInstallerName}; got ${path.basename(layout.installerPath)}`)
  }

  validateGitHead(config)
  assertCanonicalManifestBytes({
    canonicalManifestPath: config.canonicalManifestPath,
    packagedManifestPath: layout.packagedManifestPath,
    allowBakedSecrets: process.env.LEMON_DESKTOP_BAKE_HARNESS_ENV === '1'
  })
  assertCanonicalSeedHelperBytes({
    sourceSeedHelperPath: config.sourceSeedHelperPath,
    packagedSeedHelperPath: layout.packagedSeedHelperPath
  })
  const allowBakedSecrets = process.env.LEMON_DESKTOP_BAKE_HARNESS_ENV === '1'
  const manifest = readJson(layout.packagedManifestPath, 'packaged harness manifest')
  validateHarnessManifest(manifest, { allowBakedSecrets })
  const rendererHarness = validateRendererHarnessMarker({
    markerPath: layout.rendererHarnessMarkerPath,
    manifest
  })
  const stamp = readJson(layout.stampPath, 'packaged install stamp')
  validateStamp(stamp, config)
  validateGeneratedConfig(readJson(config.generatedConfigPath, 'generated electron-builder config'))

  if (config.platform === 'darwin') {
    validateMacIdentity(layout.appPath)
    validateMachOArch(layout.binaryPath, config.arch)
  } else {
    validateWindowsIdentity(layout.binaryPath, {
      readWindowsVersionInfo: config.readWindowsVersionInfo
    })
    validatePEArch(layout.binaryPath, config.arch)
  }

  const macSignature =
    config.platform === 'darwin' ? validateMacCodeSignature(layout.appPath, { spawn: config.codeSignSpawn }) : null
  const nativePayload = validateNativePayload({
    layout,
    platform: config.platform,
    arch: config.arch
  })
  const sha256 = sha256File(layout.installerPath)
  const receipt = {
    schemaVersion: 1,
    product: 'Lemon AI',
    packageVersion: config.version,
    sourceRepository: manifest.sourceRepository,
    commit: config.expectedSha,
    ref: config.expectedRef,
    platform: config.platform,
    os: layout.osName,
    arch: config.arch,
    appPath: path.basename(layout.appPath),
    installer: path.basename(layout.installerPath),
    sha256,
    checksumFormat: 'sha256sum',
    signature: macSignature?.signature ?? 'unsigned',
    notarization: config.platform === 'darwin' ? 'unnotarized' : 'not-applicable',
    verifiedAt: new Date().toISOString(),
    checks: {
      gitHead: true,
      manifestByteIdentical: true,
      stamp: true,
      generatedConfig: true,
      platformIdentity: true,
      rendererHarness: true,
      codeSignature: true,
      nativePayload: true
    }
  }
  const outputs = writeVerifiedOutput({
    installerPath: layout.installerPath,
    outputDir: config.outputDir,
    receipt
  })

  return {
    layout,
    manifest,
    rendererHarness,
    stamp,
    nativePayload,
    receipt: {
      ...receipt,
      installer: path.basename(layout.installerPath),
      checksumFile: path.basename(outputs.checksumPath)
    },
    outputs
  }
}

function usage() {
  return `Usage:
  node scripts/verify-internal-installer.mjs \\
    --platform darwin|win32 \\
    --arch arm64|x64 \\
    --sha <40-char triggering sha> \\
    --ref <branch-or-tag> \\
    --app <release/mac-arm64/Lemon AI.app|release/win-unpacked> \\
    --installer <Lemon-AI-version-platform-arch.dmg|exe> \\
    --canonical <lemon-ai-desktop.config.json> \\
    --builder-config <build/electron-builder.generated.json> \\
    --out <clean-output-dir>
`
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs()
    const result = verifyInternalInstaller(options)
    console.log(`[verify-internal-installer] verified ${result.receipt.installer}`)
    console.log(`[verify-internal-installer] sha256 ${result.receipt.sha256}`)
    console.log(`[verify-internal-installer] output ${options.outputDir}`)
  } catch (error) {
    console.error(error.message)
    console.error(usage())
    process.exit(1)
  }
}
