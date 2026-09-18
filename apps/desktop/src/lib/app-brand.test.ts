import { describe, expect, it } from 'vitest'

import { harnessEnvFromBuildConstants } from '@/app/internal-company/capabilities'
import { TRANSLATIONS } from '@/i18n/catalog'
import { BOT_ATTENTION_HINTS } from '@/plugins/lemon-bots/data'

import {
  appBrandForEnv,
  applyAppBrandRoot,
  brandTranslationTree,
  lemonAppBrand,
  replaceAppBrandTokens,
  replaceLemonBrandTerms,
  upstreamAppBrand
} from './app-brand'

describe('appBrandForEnv', () => {
  it('keeps upstream Lemon AI branding by default', () => {
    const brand = appBrandForEnv({})

    expect(brand.mode).toBe('upstream')
    expect(brand.displayName).toBe('Lemon AI')
    expect(brand.wordmark).toBe('LEMON AGENT')
    expect(brand.markSrc).toContain('nous-girl.jpg')
  })

  it('uses Lemon AI branding only for the internal desktop harness', () => {
    const brand = appBrandForEnv({ VITE_LEMON_DESKTOP_HARNESS: 'internal' })

    expect(brand.mode).toBe('internal-harness')
    expect(brand.displayName).toBe('Lemon AI')
    expect(brand.wordmark).toBe('Lemon AI')
    expect(brand.markSrc).toContain('lemon-mark.png')
    expect(brand.lockupSrc).toContain('lemon-lockup.png')
  })

  it('uses Lemon AI branding when called with the configured build env object', () => {
    const brand = appBrandForEnv(harnessEnvFromBuildConstants({ harness: 'internal' }))

    expect(brand.mode).toBe('internal-harness')
    expect(brand.displayName).toBe('Lemon AI')
  })

  it('centralizes user-facing URLs for upstream and Lemon builds', () => {
    expect(upstreamAppBrand.urls.releaseNotes).toBe('https://github.com/DangLemon/lemon-agent/releases')
    expect(upstreamAppBrand.urls.installer).toBe('https://github.com/DangLemon/lemon-agent/')
    expect(lemonAppBrand.urls.releaseNotes).toBe('https://github.com/DangLemon/lemon-agent/releases')
    expect(lemonAppBrand.urls.installer).toBe('https://github.com/DangLemon/lemon-agent/releases')
  })

  it('replaces brand tokens without changing Lemon AI defaults', () => {
    expect(replaceAppBrandTokens('Uninstall {appName}: remove {agentName}.', upstreamAppBrand)).toBe(
      'Uninstall Lemon AI: remove the Lemon AI agent.'
    )
    expect(replaceAppBrandTokens('Uninstall {appName}: remove {agentName}.', lemonAppBrand)).toBe(
      'Uninstall Lemon AI: remove the Lemon AI agent.'
    )
  })

  it('replaces leftover Hermes terms across internal update copy', () => {
    const source = 'Hermes Desktop checks for updates and restarts the Hermes Agent.'

    expect(replaceLemonBrandTerms(source, upstreamAppBrand)).toBe(source)
    expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(
      'Lemon AI checks for updates and restarts the Lemon AI.'
    )
  })

  it('does not double-brand already-Lemon copy', () => {
    const source = 'Lemon AI checks for updates and restarts the Lemon AI.'

    expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(source)
  })

  it('brands renderer fallback copy without changing upstream copy', () => {
    const source =
      'Ask Hermes… Not connected — open Hermes to reconnect. Open in Hermes. Hermes is working. Reacted by Hermes. Hermes reported an error.'

    expect(replaceLemonBrandTerms(source, upstreamAppBrand)).toBe(source)
    expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(
      'Ask Lemon AI… Not connected — open Lemon AI to reconnect. Open in Lemon AI. Lemon AI is working. Reacted by Lemon AI. Lemon AI reported an error.'
    )
  })

  it('brands quoted leftover product labels while preserving quoted executable commands', () => {
    const source =
      "Open 'Hermes Desktop', read \"Hermes Agent\", keep `Hermes Desktop`, then run 'hermes model' and `lemon mcp login amazon-ads`."

    expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(
      "Open 'Lemon AI', read \"Lemon AI\", keep `Lemon AI`, then run 'hermes model' and `lemon mcp login amazon-ads`."
    )
  })

  it('preserves only bounded bare executable commands and brands following prose', () => {
    const source = 'Run hermes model before opening Hermes Desktop. Then run lemon doctor if Lemon AI still fails.'

    expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(
      'Run hermes model before opening Lemon AI. Then run lemon doctor if Lemon AI still fails.'
    )
  })

  it('does not protect arbitrary quoted leftover product text', () => {
    const source = 'Read "Hermes Desktop" and `Hermes Agent`; keep "hermes doctor" and `lemon desktop --force-build`.'

    expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(
      'Read "Lemon AI" and `Lemon AI`; keep "hermes doctor" and `lemon desktop --force-build`.'
    )
  })

  it('preserves the executable model command while branding leftover config path hints', () => {
    const source =
      "Run 'hermes model', then check ~/.hermes/.env and ~/.hermes/config.yaml if the Hermes backend or hermes gateway still fails."

    expect(replaceLemonBrandTerms(source, upstreamAppBrand)).toBe(source)
    expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(
      "Run 'hermes model', then check ~/.lemon-ai/.env and ~/.lemon-ai/config.yaml if the Lemon AI backend or Lemon AI gateway still fails."
    )
  })

  it('preserves interpolation values when the same text also contains executable commands', () => {
    const source = "Run 'hermes model', then reopen Hermes Agent.txt in Hermes Desktop."

    expect(replaceLemonBrandTerms(source, lemonAppBrand, ['Hermes Agent.txt'])).toBe(
      "Run 'hermes model', then reopen Hermes Agent.txt in Lemon AI."
    )
  })

  it('preserves generic lower-case executable Lemon AI commands while branding surrounding UI text', () => {
    const cases = [
      ['lemon', 'lemon'],
      ['`lemon gateway`', '`lemon gateway`'],
      ['lemon gateway', 'lemon gateway'],
      ['lemon project', 'lemon project'],
      ['lemon --profile default gateway', 'lemon --profile default gateway'],
      ['lemon -p default project list --json', 'lemon -p default project list --json'],
      ['lemon curator restore', 'lemon curator restore'],
      ['lemon pets', 'lemon pets'],
      ['lemon debug share --nous', 'lemon debug share --nous'],
      ['lemon --help', 'lemon --help']
    ] as const

    for (const [source, expected] of cases) {
      expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(expected)
    }
  })

  it('stops generic command protection before prose boundaries', () => {
    expect(replaceLemonBrandTerms('Run lemon gateway before opening Lemon AI.', lemonAppBrand)).toBe(
      'Run lemon gateway before opening Lemon AI.'
    )
    expect(replaceLemonBrandTerms('Try lemon project if Lemon AI still fails.', lemonAppBrand)).toBe(
      'Try lemon project if Lemon AI still fails.'
    )
    expect(
      replaceLemonBrandTerms('Lemon AI gateway is not connected. See https://example.com/lemon/help.', lemonAppBrand)
    ).toBe('Lemon AI gateway is not connected. See https://example.com/lemon/help.')
  })

  it('keeps a bare command intact across shell operators and line breaks', () => {
    expect(replaceLemonBrandTerms('lemon gateway && echo ok', lemonAppBrand)).toBe('lemon gateway && echo ok')
    expect(replaceLemonBrandTerms('lemon gateway | tee gateway.log', lemonAppBrand)).toBe(
      'lemon gateway | tee gateway.log'
    )
    expect(replaceLemonBrandTerms('lemon gateway > gateway.log', lemonAppBrand)).toBe(
      'lemon gateway > gateway.log'
    )
    expect(replaceLemonBrandTerms('lemon gateway\nLemon AI is ready.', lemonAppBrand)).toBe(
      'lemon gateway\nLemon AI is ready.'
    )
    expect(replaceLemonBrandTerms('hermes gateway\nHermes Agent is ready.', lemonAppBrand)).toBe(
      'hermes gateway\nLemon AI is ready.'
    )
  })

  it('preserves technical path and executable hints from the catalog', () => {
    const locales = [TRANSLATIONS.en, TRANSLATIONS.zh, TRANSLATIONS['zh-hant'], TRANSLATIONS.ja, TRANSLATIONS.ar, TRANSLATIONS.ru]

    for (const translations of locales) {
      expect(replaceLemonBrandTerms(translations.settings.gateway.remoteUrlDesc, lemonAppBrand)).toContain('/lemon')
      expect(replaceLemonBrandTerms(translations.settings.gateway.sshLemonPathDesc, lemonAppBrand)).toContain(
        'lemon'
      )
    }
  })

  it('leaves generic command and prose boundaries unchanged in upstream mode', () => {
    const source =
      'Run lemon gateway before opening Lemon AI. Try lemon project if Lemon AI still fails. Lemon AI gateway is unavailable.'

    expect(replaceLemonBrandTerms(source, upstreamAppBrand)).toBe(source)
  })

  it('preserves actual catalog and plugin executable command strings', () => {
    expect(replaceLemonBrandTerms(TRANSLATIONS.en.skills.skillArchivedMessage, lemonAppBrand)).toBe(
      'Restorable via lemon curator restore.'
    )
    expect(replaceLemonBrandTerms(TRANSLATIONS.en.desktop.handoff.timedOut, lemonAppBrand)).toBe(
      'Timed out waiting for the gateway. Is `lemon gateway` running?'
    )
    expect(replaceLemonBrandTerms(BOT_ATTENTION_HINTS.missing_config, lemonAppBrand)).toBe(
      'Provider not configured — run lemon model'
    )
  })

  it('preserves bare CLI commands embedded in localized catalog copy', () => {
    expect(replaceLemonBrandTerms(TRANSLATIONS.zh.skills.skillArchivedMessage, lemonAppBrand)).toBe(
      '可通过 lemon curator restore 恢复。'
    )
    expect(replaceLemonBrandTerms(TRANSLATIONS['zh-hant'].skills.skillArchivedMessage, lemonAppBrand)).toBe(
      '可透過 lemon curator restore 還原。'
    )
    expect(replaceLemonBrandTerms(TRANSLATIONS.ja.skills.skillArchivedMessage, lemonAppBrand)).toBe(
      'lemon curator restore で復元できます。'
    )
    expect(replaceLemonBrandTerms(TRANSLATIONS.ru.skills.skillArchivedMessage, lemonAppBrand)).toBe(
      'Восстановить через lemon curator restore.'
    )
  })

  it('preserves executable CLI commands while branding leftover surrounding UI text', () => {
    const source =
      'Hermes gateway is not connected. Run `hermes gateway setup`, then try lemon mcp login amazon-ads. See https://example.com/hermes/help.'

    expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(
      'Lemon AI gateway is not connected. Run `hermes gateway setup`, then try lemon mcp login amazon-ads. See https://example.com/hermes/help.'
    )
  })

  it('preserves leftover Hermes and current Lemon technical identifiers', () => {
    const leftover =
      'Open Hermes Desktop for hermes://open/settings/plugins, call hermes:api, import @hermes/plugin-sdk, and load hermes-agent from /opt/hermes-agent/bin.'

    const current =
      'Open Lemon AI for lemon://open/settings/plugins, call lemon:api, import @lemon-ai/plugin-sdk, and load lemon-agent from /opt/lemon-agent/bin.'

    expect(replaceLemonBrandTerms(leftover, lemonAppBrand)).toBe(
      'Open Lemon AI for hermes://open/settings/plugins, call hermes:api, import @hermes/plugin-sdk, and load hermes-agent from /opt/hermes-agent/bin.'
    )
    expect(replaceLemonBrandTerms(current, lemonAppBrand)).toBe(current)
  })

  it('preserves lower-case technical identifiers while branding leftover Hermes home paths', () => {
    const source =
      'Store data-hermes-mode and hermes.desktop.routeTiles.v1 next to ~/.hermes/config.yaml for Hermes Desktop.'

    expect(replaceLemonBrandTerms(source, lemonAppBrand)).toBe(
      'Store data-hermes-mode and hermes.desktop.routeTiles.v1 next to ~/.lemon-ai/config.yaml for Lemon AI.'
    )
  })

  it('preserves explicit runtime values while branding leftover static copy', () => {
    const source =
      'Hermes Desktop could not open Hermes Agent.txt from https://example.com/Hermes and reported: Hermes gateway unavailable.'

    expect(
      replaceLemonBrandTerms(source, lemonAppBrand, [
        'Hermes Agent.txt',
        'https://example.com/Hermes',
        'Hermes gateway unavailable'
      ])
    ).toBe(
      'Lemon AI could not open Hermes Agent.txt from https://example.com/Hermes and reported: Hermes gateway unavailable.'
    )
  })

  it('brands leftover translation functions without mutating interpolated filenames', () => {
    const branded = brandTranslationTree(
      {
        failedOpen: (name: string) => `Hermes Desktop could not open ${name}.`,
        nested: {
          ready: 'Hermes Agent is ready.'
        }
      },
      lemonAppBrand
    )

    expect(branded.failedOpen('Hermes Agent.txt')).toBe('Lemon AI could not open Hermes Agent.txt.')
    expect(branded.nested.ready).toBe('Lemon AI is ready.')
  })
})

describe('applyAppBrandRoot', () => {
  it('publishes contrast-safe Lemon theme tokens in harness mode', () => {
    const root = document.createElement('html')
    const brand = appBrandForEnv({ VITE_LEMON_DESKTOP_HARNESS: 'internal' })

    applyAppBrandRoot(root, brand)

    expect(root.dataset.lemonBrand).toBe('lemon')
    expect(root.style.getPropertyValue('--theme-primary')).toBe('#ffdd00')
    expect(root.style.getPropertyValue('--theme-accent-soft')).toBe('#fff4b8')
    expect(root.style.getPropertyValue('--theme-midground')).toBe('#322b29')
    expect(root.style.getPropertyValue('--ui-accent')).toBe('#322b29')
    expect(root.style.getPropertyValue('--ui-accent-secondary')).toBe('#806b00')
    expect(root.style.getPropertyValue('--lemon-workspace-sidebar')).toBe('#f5f5f3')
    expect(root.style.getPropertyValue('--lemon-workspace-selected')).toBe('#fff4b8')
    expect(root.style.getPropertyValue('--dt-primary-foreground')).toBe('#322b29')
    expect(root.style.getPropertyValue('--dt-primary-solid-foreground')).toBe('#322b29')
    expect(root.style.getPropertyValue('--dt-ring')).toBe('#806b00')
  })

  it('uses yellow as readable brand ink on dark surfaces', () => {
    const root = document.createElement('html')
    const brand = appBrandForEnv({ VITE_LEMON_DESKTOP_HARNESS: 'internal' })

    applyAppBrandRoot(root, brand, 'dark')

    expect(root.style.getPropertyValue('--theme-midground')).toBe('#ffdd00')
    expect(root.style.getPropertyValue('--ui-accent')).toBe('#ffdd00')
    expect(root.style.getPropertyValue('--lemon-workspace-sidebar')).toBe('#24201d')
    expect(root.style.getPropertyValue('--lemon-workspace-selected')).toBe('#51470d')
    expect(root.style.getPropertyValue('--dt-primary-foreground')).toBe('#322b29')
  })

  it('removes the harness brand marker for upstream mode', () => {
    const root = document.createElement('html')
    root.dataset.lemonBrand = 'lemon'

    applyAppBrandRoot(root, appBrandForEnv({}))

    expect(root.dataset.lemonBrand).toBeUndefined()
  })
})
