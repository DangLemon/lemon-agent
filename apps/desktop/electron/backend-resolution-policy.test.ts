import { describe, expect, it } from 'vitest'

import { shouldAllowExternalRuntime } from './backend-resolution-policy'

describe('shouldAllowExternalRuntime', () => {
  it('keeps ordinary Lemon AI desktop builds compatible with existing runtimes', () => {
    expect(shouldAllowExternalRuntime({ internalHarnessActive: false })).toBe(true)
  })

  it('does not let an internal Lemon AI build inherit a PATH Lemon AI runtime', () => {
    expect(shouldAllowExternalRuntime({ internalHarnessActive: true })).toBe(false)
  })

  it('honors an explicit backend override for an internal build', () => {
    expect(
      shouldAllowExternalRuntime({
        explicitCommand: '  /opt/lemon-ai/venv/bin/python  ',
        internalHarnessActive: true
      })
    ).toBe(true)
  })

  it('ignores an empty override', () => {
    expect(shouldAllowExternalRuntime({ explicitCommand: '  ', internalHarnessActive: true })).toBe(false)
  })
})
