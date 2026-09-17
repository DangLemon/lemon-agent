import assert from 'node:assert/strict'
import fs from 'node:fs'

const readJson = file => JSON.parse(fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
const readText = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8')

const lemon = readJson('../src-tauri/tauri.conf.json')
assert.equal(lemon.productName, 'Lemon AI Setup')
assert.equal(lemon.identifier, 'com.lemondigital.lemonai.setup')
assert.equal(lemon.mainBinaryName, 'Lemon AI Setup')
assert.equal(lemon.app.windows[0].title, 'Lemon AI Setup')
assert.equal(lemon.bundle.publisher, 'Lemon Digital')
assert.equal(lemon.bundle.macOS.infoPlist, 'Info.lemon.plist')
assert.equal(lemon.bundle.macOS.signingIdentity, '-')
assert.deepEqual(lemon.bundle.icon, [
  'icons/lemon-32x32.png',
  'icons/lemon-128x128.png',
  'icons/lemon-128x128@2x.png',
  'icons/lemon-icon.icns',
  'icons/lemon-icon.ico'
])

const lemonManifest = readText('../src-tauri/lemon-ai-setup.manifest')
assert.match(lemonManifest, /LemonDigital\.LemonAI\.Setup/)
assert.match(lemonManifest, /<description>Lemon AI Setup<\/description>/)
const buildScript = readText('../src-tauri/build.rs')
assert.match(buildScript, /LEMON_INSTALLER_BRAND/)
assert.match(buildScript, /lemon-ai-setup\.manifest/)
const lemonPlist = readText('../src-tauri/Info.lemon.plist')
assert.match(lemonPlist, /Lemon AI launches the desktop app/)

const store = readText('../src/store.ts')
const update = readText('../src-tauri/src/update.rs')
const posixUpdate = readText('../../../scripts/desktop-update/posix.sh')
assert.match(store, /brand'\) === 'lemon'/)
assert.match(store, /internal'\) === '1'/)
assert.match(store, /~\/\.lemon-ai\/logs\/bootstrap-installer\.log/)
assert.match(store, /productName: 'Lemon AI'/)
assert.doesNotMatch(store, /title: 'Hermes repository'/)
assert.doesNotMatch(update, /Another Hermes update/)
assert.doesNotMatch(update, /Close all Hermes windows/)
assert.doesNotMatch(update, /Launch Hermes manually/)
assert.doesNotMatch(posixUpdate, /Reinstall Hermes/)
console.log('bootstrap installer Lemon identity: ok')
