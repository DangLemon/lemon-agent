import { describe, expect, it } from 'vitest'

import { TRANSLATIONS } from '@/i18n/catalog'
import { lemonAppBrand, upstreamAppBrand } from '@/lib/app-brand'

import { uninstallCopyForBrand, uninstallOptionsForBrand } from './uninstall-section'

describe('uninstallCopyForBrand', () => {
  it('preserves upstream Lemon AI uninstall copy by default', () => {
    const copy = uninstallCopyForBrand(upstreamAppBrand)

    expect(copy.heading).toBe('Uninstall Lemon AI')
    expect(copy.options[0].description).toBe(
      'Remove this desktop app. The Lemon AI agent, your config, and chats all stay.'
    )
  })

  it('replaces Lemon AI user-visible nouns for Lemon AI', () => {
    const copy = uninstallCopyForBrand(lemonAppBrand)

    const combined = [
      copy.cancelLabel,
      copy.confirmButtonLabel,
      copy.confirmDescription(copy.options[0].consequence),
      copy.confirmTitle,
      copy.dangerTitle,
      copy.heading,
      copy.intro,
      copy.loadingLabel,
      copy.runningLabel,
      copy.startError,
      ...copy.options.flatMap(option => [option.title, option.description, option.consequence])
    ].join('\n')

    expect(copy.heading).toBe('Gỡ Lemon AI')
    expect(copy.dangerTitle).toBe('Khu vực nhạy cảm')
    expect(copy.cancelLabel).toBe('Hủy')
    expect(combined).toContain('agent Lemon AI')
    expect(combined).not.toContain('Lemon AI')
    expect(combined).not.toContain('Uninstall')
    expect(combined).not.toContain('Danger zone')
    expect(combined).not.toContain('Checking')
  })
})

describe('uninstallOptionsForBrand', () => {
  it('keeps GUI-only visible when no local agent is installed', () => {
    expect(uninstallOptionsForBrand(lemonAppBrand, false).map(option => option.mode)).toEqual(['gui'])
  })

  it('shows agent-removing options when a local agent is installed', () => {
    expect(uninstallOptionsForBrand(lemonAppBrand, true).map(option => option.mode)).toEqual(['gui', 'lite', 'full'])
  })

  it('filters options without leaving the active locale', () => {
    const [option] = uninstallOptionsForBrand(lemonAppBrand, false, TRANSLATIONS.en)

    expect(option?.mode).toBe('gui')
    expect(option?.title).toBe('Uninstall Chat GUI only')
    expect(option?.description).toBe('Remove this desktop app. The Lemon AI, your config, and chats all stay.')
    expect(option?.description).not.toContain('Gỡ')
    expect(option?.description).not.toContain('Lemon AI')
  })
})
