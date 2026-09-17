import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'vitest'

import { prepareInternalRelease, receiptNameForInstaller } from './prepare-internal-release.mjs'

const VALID_SHA = '18ae041373f413f4270057de1120e54f61ea2970'
const VALID_REF = 'lemon-v0.17.0'
const VERSION = '0.17.0'
const REPOSITORY = 'DangLemon/lemon-agent'

const TARGETS = [
  {
    arch: 'arm64',
    bytes: 'mac-installer-bytes',
    ext: 'dmg',
    notarization: 'unnotarized',
    os: 'mac',
    platform: 'darwin',
    signature: 'adhoc',
    target: 'mac-arm64'
  },
  {
    arch: 'x64',
    bytes: 'windows-installer-bytes',
    ext: 'exe',
    notarization: 'not-applicable',
    os: 'win',
    platform: 'win32',
    signature: 'unsigned',
    target: 'win-x64'
  }
]

async function withTempDir(fn) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lemon-release-prepare-'))
  try {
    return await fn(tempRoot)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function sha256Hex(value) {
  const hash = crypto.createHash('sha256')
  hash.update(value)
  return hash.digest('hex')
}

async function createReleaseAssets(root, mutate = () => {}) {
  const assetsRoot = path.join(root, 'release-assets')
  const fixtures = []

  for (const target of TARGETS) {
    const dir = path.join(assetsRoot, target.target)
    const installer = `Lemon-AI-${VERSION}-${target.target}.${target.ext}`
    const checksumFile = `${installer}.sha256`
    const sha256 = sha256Hex(target.bytes)
    const receipt = {
      schemaVersion: 1,
      product: 'Lemon AI',
      packageVersion: VERSION,
      sourceRepository: REPOSITORY,
      commit: VALID_SHA,
      ref: VALID_REF,
      platform: target.platform,
      os: target.os,
      arch: target.arch,
      appPath: target.platform === 'darwin' ? 'Lemon AI.app' : 'win-unpacked',
      installer,
      sha256,
      checksumFile,
      checksumFormat: 'sha256sum',
      signature: target.signature,
      notarization: target.notarization,
      verifiedAt: '2026-09-09T04:00:00.000Z',
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

    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, installer), target.bytes)
    fs.writeFileSync(path.join(dir, checksumFile), `${sha256}  ${installer}\n`, 'utf8')
    writeJson(path.join(dir, receiptNameForInstaller(installer)), receipt)
    fixtures.push({ dir, installer, checksumFile, receipt, target })
  }

  await mutate({ assetsRoot, fixtures })
  return assetsRoot
}

function runPrepare(root, assetsRoot) {
  return prepareInternalRelease({
    assetsRoot,
    expectedCommit: VALID_SHA,
    expectedRef: VALID_REF,
    outputDir: path.join(root, 'staged'),
    version: VERSION
  })
}

test('prepares a complete unique release asset set', async () => {
  await withTempDir(async root => {
    const assetsRoot = await createReleaseAssets(root)
    const result = runPrepare(root, assetsRoot)
    const names = fs.readdirSync(result.outputDir).sort()

    assert.deepEqual(names, [
      'Lemon-AI-0.17.0-mac-arm64.dmg',
      'Lemon-AI-0.17.0-mac-arm64.dmg.receipt.json',
      'Lemon-AI-0.17.0-mac-arm64.dmg.sha256',
      'Lemon-AI-0.17.0-win-x64.exe',
      'Lemon-AI-0.17.0-win-x64.exe.receipt.json',
      'Lemon-AI-0.17.0-win-x64.exe.sha256',
      'SHA256SUMS.txt'
    ])
    assert.equal(
      fs.readFileSync(path.join(result.outputDir, 'SHA256SUMS.txt'), 'utf8'),
      TARGETS.map(target => {
        const installer = `Lemon-AI-${VERSION}-${target.target}.${target.ext}`
        const sha = result.targets.find(item => item.installer === installer).sha256
        return `${sha}  ${installer}\n`
      }).join('')
    )
  })
})

test('rejects a receipt digest that does not match installer bytes', async () => {
  await withTempDir(async root => {
    const assetsRoot = await createReleaseAssets(root, ({ fixtures }) => {
      const fixture = fixtures[0]
      const receiptPath = path.join(fixture.dir, receiptNameForInstaller(fixture.installer))
      writeJson(receiptPath, { ...fixture.receipt, sha256: '0'.repeat(64) })
    })

    assert.throws(() => runPrepare(root, assetsRoot), /sha256 mismatch/)
  })
})

test('rejects a receipt installer name that does not match the expected target asset', async () => {
  await withTempDir(async root => {
    const assetsRoot = await createReleaseAssets(root, ({ fixtures }) => {
      const fixture = fixtures[0]
      const receiptPath = path.join(fixture.dir, receiptNameForInstaller(fixture.installer))
      writeJson(receiptPath, { ...fixture.receipt, installer: `Renamed-${fixture.installer}` })
    })

    assert.throws(() => runPrepare(root, assetsRoot), /receipt installer/)
  })
})

test('rejects a receipt package version that does not match the release version', async () => {
  await withTempDir(async root => {
    const assetsRoot = await createReleaseAssets(root, ({ fixtures }) => {
      const fixture = fixtures[0]
      const receiptPath = path.join(fixture.dir, receiptNameForInstaller(fixture.installer))
      writeJson(receiptPath, { ...fixture.receipt, packageVersion: '0.18.0' })
    })

    assert.throws(() => runPrepare(root, assetsRoot), /packageVersion/)
  })
})

test('rejects a receipt from the wrong source repository fork', async () => {
  await withTempDir(async root => {
    const assetsRoot = await createReleaseAssets(root, ({ fixtures }) => {
      const fixture = fixtures[1]
      const receiptPath = path.join(fixture.dir, receiptNameForInstaller(fixture.installer))
      writeJson(receiptPath, { ...fixture.receipt, sourceRepository: 'DangLemon/lemon-agent' })
    })

    assert.throws(() => runPrepare(root, assetsRoot), /sourceRepository/)
  })
})

test('rejects a macOS receipt that was not verified as ad-hoc signed', async () => {
  await withTempDir(async root => {
    const assetsRoot = await createReleaseAssets(root, ({ fixtures }) => {
      const fixture = fixtures.find(item => item.target.platform === 'darwin')
      const receiptPath = path.join(fixture.dir, receiptNameForInstaller(fixture.installer))
      writeJson(receiptPath, { ...fixture.receipt, signature: 'unsigned' })
    })

    assert.throws(() => runPrepare(root, assetsRoot), /signature/)
  })
})

test('rejects receipts that predate the code signature verification gate', async () => {
  await withTempDir(async root => {
    const assetsRoot = await createReleaseAssets(root, ({ fixtures }) => {
      const fixture = fixtures[0]
      const receiptPath = path.join(fixture.dir, receiptNameForInstaller(fixture.installer))
      const checks = { ...fixture.receipt.checks }
      delete checks.codeSignature
      writeJson(receiptPath, { ...fixture.receipt, checks })
    })

    assert.throws(() => runPrepare(root, assetsRoot), /checks/)
  })
})

test('rejects receipts that predate the renderer harness verification gate', async () => {
  await withTempDir(async root => {
    const assetsRoot = await createReleaseAssets(root, ({ fixtures }) => {
      const fixture = fixtures[0]
      const receiptPath = path.join(fixture.dir, receiptNameForInstaller(fixture.installer))
      const checks = { ...fixture.receipt.checks }
      delete checks.rendererHarness
      writeJson(receiptPath, { ...fixture.receipt, checks })
    })

    assert.throws(() => runPrepare(root, assetsRoot), /checks/)
  })
})

test('rejects a missing release target asset', async () => {
  await withTempDir(async root => {
    const assetsRoot = await createReleaseAssets(root, ({ fixtures }) => {
      fs.rmSync(path.join(fixtures[1].dir, fixtures[1].installer))
    })

    assert.throws(() => runPrepare(root, assetsRoot), /missing win-x64 installer/)
  })
})
