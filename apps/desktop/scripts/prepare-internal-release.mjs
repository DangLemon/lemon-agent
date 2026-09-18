#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import PACKAGE_JSON from '../package.json' with { type: 'json' }

const EXPECTED_REPOSITORY = 'DangLemon/lemon-agent'
const RECEIPT_SCHEMA_VERSION = 1
const CHECK_KEYS = [
  'gitHead',
  'manifestByteIdentical',
  'stamp',
  'generatedConfig',
  'platformIdentity',
  'rendererHarness',
  'codeSignature',
  'nativePayload'
]

export const RELEASE_TARGETS = [
  {
    arch: 'arm64',
    ext: 'dmg',
    notarization: 'unnotarized',
    os: 'mac',
    platform: 'darwin',
    signature: 'adhoc',
    target: 'mac-arm64'
  },
  {
    arch: 'x64',
    ext: 'exe',
    notarization: 'not-applicable',
    os: 'win',
    platform: 'win32',
    signature: 'unsigned',
    target: 'win-x64'
  }
]

function fail(message) {
  throw new Error(`[prepare-internal-release] ${message}`)
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

function assertFullSha(value, label) {
  if (!/^[0-9a-f]{40}$/i.test(value ?? '')) fail(`${label} must be a full 40-character commit: ${value ?? '<missing>'}`)
}

function assertBasename(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value !== path.basename(value)) {
    fail(`${label} must be a plain basename: ${JSON.stringify(value)}`)
  }
}

function ensureFile(filePath, label) {
  const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null
  if (!stat?.isFile()) fail(`missing ${label}: ${filePath}`)
  if (stat.size === 0) fail(`${label} is empty: ${filePath}`)
  return stat
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    fail(`${label} is not valid JSON: ${filePath}: ${error.message}`)
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

function expectedInstallerName(version, target) {
  return `Lemon-AI-${version}-${target.target}.${target.ext}`
}

export function receiptNameForInstaller(installerName) {
  assertBasename(installerName, 'installer name')
  return `${installerName}.receipt.json`
}

function validateTargetDirectory(inputDir, expectedNames) {
  const entries = fs.readdirSync(inputDir).sort()
  const expected = [...expectedNames].sort()
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    fail(`target directory ${inputDir} must contain exactly ${expected.join(', ')}; got ${entries.join(', ')}`)
  }
  for (const name of entries) {
    ensureFile(path.join(inputDir, name), `release asset ${name}`)
  }
}

function validateReceiptChecks(receipt, receiptPath) {
  if (!receipt.checks || typeof receipt.checks !== 'object' || Array.isArray(receipt.checks)) {
    fail(`${receiptPath} checks must be an object`)
  }
  const keys = Object.keys(receipt.checks).sort()
  const expectedKeys = [...CHECK_KEYS].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    fail(`${receiptPath} checks must contain exactly ${expectedKeys.join(', ')}`)
  }
  for (const key of CHECK_KEYS) {
    assertEqual(receipt.checks[key], true, `${receiptPath} checks.${key}`)
  }
}

function validateReceipt({
  checksumFile,
  checksumPath,
  expectedCommit,
  expectedRef,
  expectedRepository,
  installerName,
  installerPath,
  receipt,
  receiptPath,
  target,
  version
}) {
  assertEqual(receipt.schemaVersion, RECEIPT_SCHEMA_VERSION, `${receiptPath} schemaVersion`)
  assertEqual(receipt.product, 'Lemon AI', `${receiptPath} product`)
  assertEqual(receipt.packageVersion, version, `${receiptPath} packageVersion`)
  assertEqual(receipt.sourceRepository, expectedRepository, `${receiptPath} sourceRepository`)
  assertEqual(receipt.commit, expectedCommit, `${receiptPath} commit`)
  assertEqual(receipt.ref, expectedRef, `${receiptPath} ref`)
  assertEqual(receipt.platform, target.platform, `${receiptPath} platform`)
  assertEqual(receipt.os, target.os, `${receiptPath} os`)
  assertEqual(receipt.arch, target.arch, `${receiptPath} arch`)
  assertEqual(receipt.installer, installerName, `${receiptPath} receipt installer`)
  assertEqual(receipt.checksumFile, checksumFile, `${receiptPath} checksumFile`)
  assertEqual(receipt.checksumFormat, 'sha256sum', `${receiptPath} checksumFormat`)
  assertEqual(receipt.signature, target.signature, `${receiptPath} signature`)
  assertEqual(receipt.notarization, target.notarization, `${receiptPath} notarization`)
  assertBasename(receipt.installer, `${receiptPath} receipt installer`)
  assertBasename(receipt.checksumFile, `${receiptPath} checksumFile`)
  validateReceiptChecks(receipt, receiptPath)

  const actualSha256 = sha256File(installerPath)
  assertEqual(receipt.sha256, actualSha256, `${receiptPath} sha256 mismatch`)
  const expectedChecksumLine = `${actualSha256}  ${installerName}\n`
  const checksumLine = fs.readFileSync(checksumPath, 'utf8')
  assertEqual(checksumLine, expectedChecksumLine, `${checksumPath} checksum line`)

  return actualSha256
}

function copyAsset(source, destination) {
  fs.copyFileSync(source, destination)
  return destination
}

export function prepareInternalRelease({
  assetsRoot,
  expectedCommit,
  expectedRef,
  expectedRepository = EXPECTED_REPOSITORY,
  outputDir,
  version = PACKAGE_JSON.version
}) {
  if (!assetsRoot) fail('assetsRoot is required')
  if (!outputDir) fail('outputDir is required')
  if (!version) fail('version is required')
  if (!expectedRef) fail('expectedRef is required')
  assertFullSha(expectedCommit, 'expectedCommit')
  assertEqual(expectedRepository, EXPECTED_REPOSITORY, 'expectedRepository')

  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  const targets = []
  const checksumLines = []
  for (const target of RELEASE_TARGETS) {
    const inputDir = path.join(assetsRoot, target.target)
    const installerName = expectedInstallerName(version, target)
    const checksumFile = `${installerName}.sha256`
    const receiptFile = receiptNameForInstaller(installerName)
    const installerPath = path.join(inputDir, installerName)
    const checksumPath = path.join(inputDir, checksumFile)
    const receiptPath = path.join(inputDir, receiptFile)

    ensureFile(installerPath, `${target.target} installer`)
    ensureFile(checksumPath, `${target.target} checksum`)
    ensureFile(receiptPath, `${target.target} receipt`)
    validateTargetDirectory(inputDir, [installerName, checksumFile, receiptFile])

    const receipt = readJson(receiptPath, `${target.target} receipt`)
    const sha256 = validateReceipt({
      checksumFile,
      checksumPath,
      expectedCommit,
      expectedRef,
      expectedRepository,
      installerName,
      installerPath,
      receipt,
      receiptPath,
      target,
      version
    })

    copyAsset(installerPath, path.join(outputDir, installerName))
    copyAsset(checksumPath, path.join(outputDir, checksumFile))
    copyAsset(receiptPath, path.join(outputDir, receiptFile))
    checksumLines.push(`${sha256}  ${installerName}\n`)
    targets.push({
      arch: target.arch,
      checksumFile,
      installer: installerName,
      platform: target.platform,
      receiptFile,
      sha256,
      target: target.target
    })
  }

  const checksumSumsPath = path.join(outputDir, 'SHA256SUMS.txt')
  fs.writeFileSync(checksumSumsPath, checksumLines.join(''), 'utf8')
  validateTargetDirectory(outputDir, [
    'SHA256SUMS.txt',
    ...targets.flatMap(target => [target.installer, target.checksumFile, target.receiptFile])
  ])

  return {
    checksumSumsPath,
    outputDir,
    targets
  }
}

function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) fail(`unexpected argument: ${arg}`)
    const key = arg.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`missing value for --${key}`)
    args[key] = value
    index += 1
  }
  const assetsRoot = args['assets-root'] ?? env.RELEASE_ASSETS_ROOT ?? 'release-assets'
  return {
    assetsRoot,
    expectedCommit: args.sha ?? env.RELEASE_BUILD_COMMIT ?? env.GITHUB_SHA,
    expectedRef: args.ref ?? env.RELEASE_BUILD_REF ?? env.GITHUB_REF_NAME,
    expectedRepository: args.repository ?? env.RELEASE_SOURCE_REPOSITORY ?? EXPECTED_REPOSITORY,
    outputDir: args.out ?? env.RELEASE_OUTPUT_DIR ?? path.join(assetsRoot, 'staged'),
    version: args.version ?? env.RELEASE_VERSION ?? PACKAGE_JSON.version
  }
}

function usage() {
  return `Usage:
  node apps/desktop/scripts/prepare-internal-release.mjs \\
    --assets-root <downloaded-artifact-root> \\
    --out <staged-release-assets-dir> \\
    --version <package-version> \\
    --sha <40-char release sha> \\
    --ref <release-tag> \\
    --repository DangLemon/lemon-agent
`
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = prepareInternalRelease(parseArgs())
    console.log(`[prepare-internal-release] staged ${result.targets.length} targets at ${result.outputDir}`)
    for (const target of result.targets) {
      console.log(`[prepare-internal-release] ${target.target} ${target.sha256} ${target.installer}`)
    }
  } catch (error) {
    console.error(error.message)
    console.error(usage())
    process.exit(1)
  }
}
