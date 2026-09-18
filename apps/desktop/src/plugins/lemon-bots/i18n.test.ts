/**
 * The English bundle is the message shape. ja / zh / zh-hant must cover the
 * same leaves so a locale switch never falls through to a raw key — and the
 * interpolators must still splice their arguments, not drop them.
 */

import { describe, expect, it } from 'vitest'

import { BOTS_LOCALES, type BotsMessages, brandBotsLocaleBundlesForEnv } from './i18n'
import { botModeProductName, brandDisplayString } from './labels'

type Leaf = string | ((...args: never[]) => string)

function leafEntries(node: unknown, prefix = ''): Array<[string, Leaf]> {
  if (typeof node === 'function' || typeof node === 'string') {
    return [[prefix, node as Leaf]]
  }

  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) =>
    leafEntries(value, prefix ? `${prefix}.${key}` : key)
  )
}

type BotsLocaleSet = Record<'en' | 'ja' | 'zh' | 'zh-hant', BotsMessages>

const locales = BOTS_LOCALES as BotsLocaleSet
const en = locales.en
const ja = locales.ja
const zh = locales.zh
const zhHant = locales['zh-hant']
const internalEnv = { VITE_LEMON_DESKTOP_HARNESS: 'internal' }

describe('BOTS_LOCALES', () => {
  it('covers the English key tree in every shipped locale', () => {
    expect(ja).toBeDefined()
    expect(zh).toBeDefined()
    expect(zhHant).toBeDefined()

    const enPaths = leafEntries(en).map(([path]) => path)

    expect(leafEntries(ja).map(([path]) => path)).toEqual(enPaths)
    expect(leafEntries(zh).map(([path]) => path)).toEqual(enPaths)
    expect(leafEntries(zhHant).map(([path]) => path)).toEqual(enPaths)
  })

  it('translates user-visible chrome instead of echoing English', () => {
    const samples = ['roster.emptyTitle', 'bot.newTitle', 'group.manageTitle', 'tools.skillsHub'] as const
    const enByPath = Object.fromEntries(leafEntries(en))

    for (const locale of [ja, zh, zhHant]) {
      const byPath = Object.fromEntries(leafEntries(locale))

      for (const path of samples) {
        expect(byPath[path]).not.toBe(enByPath[path])
      }
    }
  })

  it('keeps interpolator arguments in the translated string', () => {
    const sentinel = 'QUERY_SENTINEL'
    const gateway = 'GATEWAY_SENTINEL'

    for (const locale of [en, ja, zh, zhHant]) {
      const byPath = Object.fromEntries(leafEntries(locale))
      const queryFn = byPath['roster.noMatchQuery'] as (query: string) => string
      const bothFn = byPath['roster.noMatchQueryOn'] as (query: string, gateway: string) => string
      const reasonFn = byPath['roster.rosterUnavailable'] as (reason: string) => string

      expect(queryFn(sentinel)).toContain(sentinel)
      expect(bothFn(sentinel, gateway)).toContain(sentinel)
      expect(bothFn(sentinel, gateway)).toContain(gateway)
      expect(reasonFn(sentinel)).toContain(sentinel)
    }
  })

  it('keeps upstream display branding by default', () => {
    expect(botModeProductName({})).toBe('Lemon AI')
    expect(brandDisplayString('Update Lemon AI to open another Bot chat.', {})).toBe(
      'Update Lemon AI to open another Bot chat.'
    )
    expect(brandDisplayString('Set up Lemon AI before creating bots.', {})).toBe(
      'Set up Lemon AI before creating bots.'
    )
    expect(en.bot.openAnotherChatUnsupported).toBe('Update Lemon AI to open another Bot chat.')
  })

  it('brands internal display copy as Lemon AI without changing lowercase technical commands', () => {
    const internal = brandBotsLocaleBundlesForEnv(internalEnv) as BotsLocaleSet

    expect(botModeProductName(internalEnv)).toBe('Lemon AI')
    expect(brandDisplayString('Update Lemon AI to open another Bot chat.', internalEnv)).toBe(
      'Update Lemon AI to open another Bot chat.'
    )
    expect(brandDisplayString('Set up Lemon AI before creating bots.', internalEnv)).toBe(
      'Set up Lemon AI before creating bots.'
    )
    expect(brandDisplayString('Update Hermes Agent to open another Bot chat.', internalEnv)).toBe(
      'Update Lemon AI Desktop to open another Bot chat.'
    )
    expect(brandDisplayString('Provider not configured — run lemon model', internalEnv)).toBe(
      'Provider not configured — run lemon model'
    )
    expect(internal.en.bot.openAnotherChatUnsupported).toBe('Update Lemon AI to open another Bot chat.')
    expect(internal.en.tools.skillsHub).toBe('Lemon AI Skills Hub')
    expect(internal.ja.tools.skillsHub).toBe('Lemon AI スキルハブ')
    expect(internal.zh.tools.skillsHub).toBe('Lemon AI 技能中心')
    expect(internal['zh-hant'].tools.skillsHub).toBe('Lemon AI 技能中心')
  })

  it('brands wrapped locale interpolators while preserving their arguments', () => {
    const internal = brandBotsLocaleBundlesForEnv(internalEnv) as BotsLocaleSet
    const reason = 'REASON_SENTINEL'
    const query = 'QUERY_SENTINEL'
    const gateway = 'GATEWAY_SENTINEL'

    expect(internal.en.roster.rosterUnavailable(reason)).toContain('Lemon AI')
    expect(internal.en.roster.rosterUnavailable(reason)).toContain(reason)
    expect(internal.en.roster.noMatchQueryOn(query, gateway)).toContain(query)
    expect(internal.en.roster.noMatchQueryOn(query, gateway)).toContain(gateway)
  })

  it('does not rewrite Lemon AI inside Bot Mode interpolation values', () => {
    const internal = brandBotsLocaleBundlesForEnv(internalEnv) as BotsLocaleSet
    const userQuery = 'Lemon AI onboarding'
    const userGateway = 'Lemon AI gateway profile'

    expect(internal.en.roster.noMatchQueryOn(userQuery, userGateway)).toContain(userQuery)
    expect(internal.en.roster.noMatchQueryOn(userQuery, userGateway)).toContain(userGateway)
  })
})
