import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function loadBrandMark() {
  return import('./brand-mark')
}

describe('BrandMark', () => {
  it('keeps the upstream Nous mark on a white tile by default', async () => {
    const { BrandMark } = await loadBrandMark()

    render(<BrandMark aria-label="brand mark" />)

    const wrapper = screen.getByLabelText('brand mark')
    const img = wrapper.querySelector('img')

    expect(wrapper.getAttribute('data-brand')).toBe('upstream')
    expect(wrapper.className).toContain('bg-white')
    expect(img?.getAttribute('src')).toContain('nous-girl.jpg')
  })

  it('uses the transparent Lemon mark for the internal harness', async () => {
    vi.stubGlobal('__LEMON_DESKTOP_HARNESS__', 'internal')
    const { BrandMark } = await loadBrandMark()

    render(<BrandMark aria-label="brand mark" />)

    const wrapper = screen.getByLabelText('brand mark')
    const img = wrapper.querySelector('img')

    expect(wrapper.getAttribute('data-brand')).toBe('internal-harness')
    expect(wrapper.className).toContain('bg-transparent')
    expect(wrapper.className).not.toContain('bg-white')
    expect(img?.getAttribute('src')).toContain('lemon-mark.png')
  })

  it('restores the white tile when the Lemon asset falls back upstream', async () => {
    vi.stubGlobal('__LEMON_DESKTOP_HARNESS__', 'internal')
    const { BrandMark } = await loadBrandMark()

    render(<BrandMark aria-label="brand mark" />)

    const wrapper = screen.getByLabelText('brand mark')
    const img = wrapper.querySelector('img')

    expect(wrapper.getAttribute('data-brand')).toBe('internal-harness')
    expect(wrapper.className).toContain('bg-transparent')
    expect(img?.getAttribute('src')).toContain('lemon-mark.png')

    fireEvent.error(img!)

    expect(wrapper.className).toContain('bg-white')
    expect(img?.getAttribute('src')).toContain('nous-girl.jpg')
  })
})
