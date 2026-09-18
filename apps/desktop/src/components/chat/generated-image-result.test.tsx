import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GeneratedImage } from '@/components/chat/generated-image-result'
import { $previewTabs, closeRightRail } from '@/store/preview'
import { $connection } from '@/store/session'

const LOCAL_PATH = '/Users/me/.lemon-ai/cache/images/cat.png'

describe('GeneratedImage local preview', () => {
  let originalDesktop: typeof window.lemonDesktop

  beforeEach(() => {
    originalDesktop = window.lemonDesktop
    Object.defineProperty(window, 'lemonDesktop', {
      configurable: true,
      value: { ...(originalDesktop ?? {}) }
    })
    $connection.set({ mode: 'local' } as never)
    closeRightRail()
    window.localStorage.clear()
  })

  afterEach(() => {
    cleanup()
    closeRightRail()
    $connection.set(null)
    Object.defineProperty(window, 'lemonDesktop', {
      configurable: true,
      value: originalDesktop
    })
  })

  it('does not auto-open the preview rail for a hydrated history result', async () => {
    render(<GeneratedImage result={{ host_image: LOCAL_PATH, image: LOCAL_PATH, success: true }} />)

    await waitFor(() => {
      expect(document.querySelector('img[alt="Generated image"]')?.getAttribute('src')).toBe(
        'lemon-media://stream/%2FUsers%2Fme%2F.lemon-ai%2Fcache%2Fimages%2Fcat.png'
      )
    })
    expect($previewTabs.get()).toEqual([])
  })

  it('opens the preview rail when a live generation settles onto a local file', async () => {
    const { rerender } = render(<GeneratedImage />)

    rerender(<GeneratedImage result={{ host_image: LOCAL_PATH, image: LOCAL_PATH, success: true }} />)

    await waitFor(() => {
      expect($previewTabs.get()[0]?.target.path).toBe(LOCAL_PATH)
      expect($previewTabs.get()[0]?.target.previewKind).toBe('image')
    })
  })
})
