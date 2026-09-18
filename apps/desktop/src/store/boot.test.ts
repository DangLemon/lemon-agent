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
    failDesktopBoot('Missing venv at /Users/test/Lemon AI Runtime/venv')

    expect($desktopBoot.get().error).toBe('Missing venv at /Users/test/Lemon AI Runtime/venv')
    expect($desktopBoot.get().message).toContain('/Users/test/Lemon AI Runtime/venv')
  })

  it('keeps completion and failure messages compatible for the upstream build', () => {
    completeDesktopBoot('Lemon AI is ready')
    expect($desktopBoot.get().message).toBe('Lemon AI is ready')

    failDesktopBoot('Lemon AI gateway unavailable')
    expect($desktopBoot.get().error).toBe('Lemon AI gateway unavailable')
  })
})
