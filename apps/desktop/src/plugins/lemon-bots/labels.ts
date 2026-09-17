/**
 * The presentation leaves every Bot Mode surface reads: the name a row shows,
 * the flattened one-line preview beside it, and the slug that identifies a
 * workspace tile.
 *
 * They sit below the surfaces rather than inside any one of them — the roster,
 * the bot row and the group-chat room all render the same identity, and none
 * of them can own it without the others importing a sibling surface.
 */

import { aliasIdentityFor } from './routing'
import type { BotMeta, RosterRow } from './types'

export type BrandEnv = {
  readonly [key: string]: unknown
}

function envString(env: BrandEnv, key: string): string {
  const value = env[key]

  // Callers may pass an explicit environment snapshot in tests or when
  // rendering a locale bundle. It must win over the process-wide compiled
  // global; otherwise a stale global from another test/build masks the
  // requested profile.
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }

  const globalKey = key.replace(/^VITE_/, '__') + '__'
  const globalValue = (globalThis as unknown as Partial<Record<string, unknown>>)[globalKey]

  if (typeof globalValue === 'string' && globalValue.trim()) {
    return globalValue.trim()
  }

  return typeof value === 'string' ? value.trim() : ''
}

export function botModeUsesLemonAiBrand(env: BrandEnv = import.meta.env): boolean {
  return envString(env, 'VITE_LEMON_DESKTOP_HARNESS').toLowerCase() === 'internal'
}

export function botModeProductName(_env: BrandEnv = import.meta.env): string {
  return 'Lemon AI'
}

export function botModeDesktopProductName(env: BrandEnv = import.meta.env): string {
  return `${botModeProductName(env)} Desktop`
}

function protectValues(value: string, preserveValues: readonly unknown[]): { restore: (text: string) => string; text: string } {
  const values = preserveValues.filter((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
  const tokens = values.map((_, index) => `lemon-bot-value-${index}`)
  const text = values.reduce((next, original, index) => next.split(original).join(tokens[index]), value)

  return {
    restore: textWithTokens => tokens.reduce((next, token, index) => next.split(token).join(values[index]), textWithTokens),
    text
  }
}

export function brandDisplayString(
  value: string,
  env: BrandEnv = import.meta.env,
  preserveValues: readonly unknown[] = []
): string {
  if (!botModeUsesLemonAiBrand(env)) {
    return value
  }

  const protectedValue = protectValues(value, preserveValues)
  const desktopToken = '\uE000lemon-bot-desktop\uE001'

  const branded = protectedValue.text
    .replace(/\bLemon AI Desktop\b/g, desktopToken)
    .replace(/\bHermes Agent\b/g, desktopToken)
    .replace(/\bHermes Desktop\b/g, desktopToken)
    .replace(/\bHermes\b/g, botModeProductName(env))
    .split(desktopToken)
    .join(botModeDesktopProductName(env))

  return protectedValue.restore(branded)
}

export function defaultAgentName(): string {
  return botModeProductName()
}

export function displayName(bot: Partial<RosterRow>, meta?: BotMeta | null): string {
  // A configured alias route claiming this row overrides source-derived
  // identity: the friendly alias name must survive hosted-session
  // activation and Cloud-only rosters (#89131).
  const alias = aliasIdentityFor(bot)

  // Only THIN rows from another source trade the friendly name for their
  // connection label — the active gateway's own default must keep reading
  // "Lemon AI". Annotated active rows carry sourceScoped too, and keying this
  // off sourceScoped renamed the user's main agent to an IP-derived label
  // (community report, Aug 17 2026).
  if (
    bot?.remoteSource &&
    (bot.name || '').trim().toLowerCase() === 'default' &&
    bot.connectionLabel &&
    !alias &&
    !meta?.title?.trim()
  ) {
    return bot.connectionLabel
  }

  if (meta?.title?.trim()) {
    return meta.title.trim()
  }

  // Core-profile display name (profile.yaml, set via `lemon profile rename
  // default <name>` or the dashboard) — the CLI-level equivalent of a Bot
  // Mode title. Rides the profiles.list row; presentation-only.
  if (typeof bot?.display_name === 'string' && bot.display_name.trim()) {
    return bot.display_name.trim()
  }

  // An untitled backend row claimed by an alias reads as the alias name —
  // never generic "Lemon AI" or a hostname-derived label.
  if (alias) {
    const raw = alias.name.replace(/[-_]+/g, ' ').trim()

    return raw.replace(/\b\w/g, ch => ch.toUpperCase())
  }

  // The primary profile is literally named "default" — as a bot identity
  // that reads like nobody bothered. Present it as the active app name
  // unless the user gives it a real title.
  if ((bot.name || '').trim().toLowerCase() === 'default' && !bot.title) {
    return defaultAgentName()
  }

  const raw = (bot.title || bot.name || '').replace(/[-_]+/g, ' ').trim()

  return raw.replace(/\b\w/g, ch => ch.toUpperCase())
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

/** Flatten markdown syntax out of a one-line roster preview so rows read
 *  like Discord's — no raw **bold**, `code`, > quotes, or [link](url)
 *  characters in the preview line. */
export function stripPreviewMarkdown(text: unknown) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`\n]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(^|\s)[*_](\S(?:.*?\S)?)[*_](?=\s|$|[.,;:!?])/g, '$1$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}
