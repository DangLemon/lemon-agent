import { beforeEach, describe, expect, it } from 'vitest'

import { $desktopBoot, completeDesktopBoot, failDesktopBoot } from './boot'

describe('boot display branding', () => {
  beforeEach(() => {
    $desktopBoot.set({
      error: null,
      fakeMode: false,
      message: 'Starting',
      phase: 'renderer.init',
      progress: 2,
      running: true,
      timestamp: Date.now(),
      visible: true
    })
  })


  it('preserves authoritative runtime paths in terminal failures', () => {
    failDesktopBoot('Missing venv at /Users/test/Hermes Runtime/venv')

    expect($desktopBoot.get().error).toBe('Missing venv at /Users/test/Hermes Runtime/venv')
    expect($desktopBoot.get().message).toContain('/Users/test/Hermes Runtime/venv')
  })

  it('keeps completion and failure messages compatible for the upstream build', () => {
    completeDesktopBoot('Hermes Desktop is ready')
    expect($desktopBoot.get().message).toBe('Hermes Desktop is ready')

    failDesktopBoot('Hermes gateway unavailable')
    expect($desktopBoot.get().error).toBe('Hermes gateway unavailable')
  })
})
