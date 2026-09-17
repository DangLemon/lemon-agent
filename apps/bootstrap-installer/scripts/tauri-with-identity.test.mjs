import assert from 'node:assert/strict'
import { test } from 'node:test'

import { internalDesktopBuild, withIdentityConfig } from './tauri-with-identity.mjs'

test('Tauri wrapper always uses the Lemon installer identity', () => {
  const { args, env } = withIdentityConfig(['build'], {})
  assert.deepEqual(args, ['build'])
  assert.equal(env.LEMON_INSTALLER_BRAND, 'lemon')
  assert.equal(internalDesktopBuild(), true)
})
