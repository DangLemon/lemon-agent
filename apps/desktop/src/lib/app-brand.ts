import { internalCompanyBuildEnv, internalCompanyExpectedFromEnv } from '@/app/internal-company/capabilities'

export type AppBrandMode = 'upstream' | 'internal-harness'

export interface AppBrand {
  accent: string
  accentForeground: string
  agentName: string
  appName: string
  chatGuiName: string
  displayName: string
  lockupSrc: string
  markSrc: string
  mode: AppBrandMode
  primary: string
  primaryForeground: string
  ring: string
  sidebarForeground: string
  urls: {
    installer: string
    releaseNotes: string
  }
  wordmark: string
}

type BrandEnv = Record<string, unknown>
type AppBrandToken = 'agentName' | 'appName' | 'chatGuiName'

const assetPath = (path: string): string => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`

export const upstreamAppBrand: AppBrand = {
  accent: '#0053fd',
  accentForeground: '#ffffff',
  agentName: 'the Lemon AI agent',
  appName: 'Lemon AI',
  chatGuiName: 'the desktop Chat GUI',
  displayName: 'Lemon AI',
  lockupSrc: '',
  markSrc: assetPath('nous-girl.jpg'),
  mode: 'upstream',
  primary: '#0053fd',
  primaryForeground: '#ffffff',
  ring: '#0053fd',
  sidebarForeground: 'var(--ui-text-secondary)',
  urls: {
    installer: 'https://github.com/DangLemon/lemon-agent/',
    releaseNotes: 'https://github.com/DangLemon/lemon-agent/releases'
  },
  wordmark: 'LEMON AGENT'
}

export const lemonAppBrand: AppBrand = {
  accent: '#ffdd00',
  accentForeground: '#322b29',
  agentName: 'the Lemon AI agent',
  appName: 'Lemon AI',
  chatGuiName: 'the Lemon AI desktop app',
  displayName: 'Lemon AI',
  lockupSrc: assetPath('lemon-lockup.png'),
  markSrc: assetPath('lemon-mark.png'),
  mode: 'internal-harness',
  primary: '#ffdd00',
  primaryForeground: '#322b29',
  ring: '#806b00',
  sidebarForeground: '#322b29',
  urls: {
    // Lemon CI publishes signed/notarized-ready artifacts as prereleases
    // (`lemon-v*`). GitHub's `/releases/latest` endpoint ignores prereleases
    // and returns 404 until a stable release exists, which would make the
    // bundle recovery action unusable. The releases index always resolves and
    // exposes the current Lemon AI prerelease installer when one is available.
    installer: 'https://github.com/DangLemon/lemon-agent/releases',
    releaseNotes: 'https://github.com/DangLemon/lemon-agent/releases'
  },
  wordmark: 'Lemon AI'
}

export function appBrandForEnv(env: BrandEnv = internalCompanyBuildEnv()): AppBrand {
  return internalCompanyExpectedFromEnv(env) ? lemonAppBrand : upstreamAppBrand
}

export const appBrand = appBrandForEnv

const BRAND_VALUE_TOKEN_PREFIX = '\uE000brand-value-'
const BRAND_VALUE_TOKEN_SUFFIX = '\uE001'
const BRAND_SPAN_TOKEN_PREFIX = '\uE000brand-span-'
const CLI_EXECUTABLE = /\b(?:hermes|lemon)\b/g

const TECHNICAL_CONTRACT =
  /\/(?:hermes|lemon)(?=\/|\b)|@(?:hermes|lemon)\/[A-Za-z0-9][A-Za-z0-9._/-]*|\b(?:hermes|lemon):\/\/[^\s<>"'`,;)]*|\b(?:hermes|lemon):(?!\/\/)[A-Za-z0-9][A-Za-z0-9._:-]*|\b(?:hermes|lemon)[._/-][A-Za-z0-9][A-Za-z0-9._/-]*/g

const BARE_TECHNICAL_CONTEXT_WORDS = new Set(['binary', 'command', 'executable', 'path'])

const CLI_CONTEXT_WORDS = new Set([
  'command',
  'execute',
  'executing',
  'launch',
  'launched',
  'run',
  'running',
  'start',
  'started',
  'try',
  'type',
  'typed',
  'use',
  'using',
  'via'
])

const CLI_PROSE_BOUNDARY_WORDS = new Set([
  'after',
  'and',
  'are',
  'because',
  'before',
  'but',
  'fails',
  'failed',
  'for',
  'if',
  'in',
  'is',
  'on',
  'or',
  'running',
  'still',
  'then',
  'to',
  'unavailable',
  'was',
  'were',
  'when',
  'while',
  'with'
])

// Some translated catalog strings place a bare CLI command between
// non-English words, so the English context/boundary heuristic below cannot
// identify it. Keep the command heads that are shipped in user-facing copy
// here; requiring a subcommand/argument after the head prevents ordinary
// product prose such as "Lemon AI gateway is unavailable" from being treated as
// an executable command.
const CLI_COMMAND_HEADS = new Set(['curator', 'debug', 'desktop', 'gateway', 'mcp', 'model', 'pets', 'project'])

interface TextSpan {
  end: number
  start: number
}

interface CliToken {
  end: number
  start: number
  value: string
}

interface ProtectedBrandText {
  restore: (value: string) => string
  text: string
}

function replaceValuesWithTokens(input: string, values: readonly string[], tokens: readonly string[]): string {
  return values.reduce((next, original, index) => {
    if (!original) {
      return next
    }

    return next.split(original).join(tokens[index])
  }, input)
}

function restoreTokens(input: string, values: readonly string[], tokens: readonly string[]): string {
  return tokens.reduce((next, token, index) => next.split(token).join(values[index]), input)
}

function isWhitespace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char)
}

function isCliDelimiter(char: string | undefined): boolean {
  return char === undefined || /[.,;:!?()[\]{}<>`]/.test(char)
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char)
}

function previousWord(input: string, index: number): string | null {
  let cursor = index - 1

  while (cursor >= 0 && !isWordChar(input[cursor])) {
    cursor -= 1
  }

  if (cursor < 0) {
    return null
  }

  const end = cursor + 1

  while (cursor >= 0 && isWordChar(input[cursor])) {
    cursor -= 1
  }

  return input.slice(cursor + 1, end).toLowerCase()
}

function hasCodeOrQuoteBoundary(input: string, start: number, end: number): boolean {
  const before = input[start - 1]
  const after = input[end]

  return before === '`' || after === '`' || before === '"' || after === '"' || before === "'" || after === "'"
}

function hasCliContext(input: string, start: number): boolean {
  const word = previousWord(input, start)

  return word !== null && CLI_CONTEXT_WORDS.has(word)
}

function readCliToken(input: string, start: number): CliToken | null {
  const quote = input[start]

  if (quote === '"' || quote === "'") {
    let cursor = start + 1

    while (cursor < input.length && input[cursor] !== quote && input[cursor] !== '\n') {
      cursor += 1
    }

    if (input[cursor] !== quote) {
      return null
    }

    return { start, end: cursor + 1, value: input.slice(start, cursor + 1) }
  }

  if (isCliDelimiter(input[start]) || isWhitespace(input[start])) {
    return null
  }

  let cursor = start

  while (cursor < input.length && !isWhitespace(input[cursor]) && !isCliDelimiter(input[cursor])) {
    cursor += 1
  }

  return { start, end: cursor, value: input.slice(start, cursor) }
}

function isCliTokenValue(token: string): boolean {
  if (/^--?[A-Za-z0-9][A-Za-z0-9-]*(?:=.*)?$/.test(token)) {
    return true
  }

  if (/^[A-Za-z0-9][A-Za-z0-9._:/@+=-]*$/.test(token)) {
    return true
  }

  if (/^(?:"[^"\n]*"|'[^'\n]*')$/.test(token)) {
    return true
  }

  return false
}

function scanCliCommand(input: string, start: number, executableLength: number): TextSpan {
  let cursor = start + executableLength
  let end = cursor
  let consumedTokens = 0

  while (cursor < input.length) {
    const whitespaceStart = cursor

    while (cursor < input.length && isWhitespace(input[cursor]) && input[cursor] !== '\n') {
      cursor += 1
    }

    if (cursor === whitespaceStart) {
      break
    }

    const token = readCliToken(input, cursor)

    if (token === null) {
      break
    }

    const normalized = token.value.toLowerCase()

    if (CLI_PROSE_BOUNDARY_WORDS.has(normalized)) {
      break
    }

    if (!isCliTokenValue(token.value)) {
      break
    }

    consumedTokens += 1
    end = token.end
    cursor = token.end
  }

  return { start, end }
}

function hasOnlyCommandPunctuationAfter(input: string, end: number): boolean {
  return /^[\s`'".,;:!?()[\]{}]*$/.test(input.slice(end))
}

function hasShellCommandBoundaryAfter(input: string, end: number): boolean {
  return /^\s*(?:&&|\|\||[|>]|\r?\n)/.test(input.slice(end))
}

function hasKnownCliCommandShape(input: string, span: TextSpan): boolean {
  const tokens = input
    .slice(span.start, span.end)
    .trim()
    .split(/\s+/)
    .map(token => token.replace(/^['"]|['"]$/g, '').toLowerCase())

  if (!CLI_COMMAND_HEADS.has(tokens[1] ?? '')) {
    return false
  }

  return tokens.length >= 3 || hasShellCommandBoundaryAfter(input, span.end)
}

function hasBareTechnicalContext(input: string, span: TextSpan): boolean {
  const tokens = input
    .slice(span.start, span.end)
    .trim()
    .split(/\s+/)
    .map(token => token.toLowerCase())

  if (tokens.length === 2 && BARE_TECHNICAL_CONTEXT_WORDS.has(tokens[1] ?? '')) {
    return true
  }

  const executable = input.slice(span.start, span.end).toLowerCase()

  if (tokens.length !== 1 || (executable !== 'hermes' && executable !== 'lemon')) {
    return false
  }

  // In translated copy the word following the executable is often a
  // non-ASCII noun (for example, the Chinese/Japanese equivalent of
  // "binary"). A lower-case standalone CLI name at that boundary is the
  // executable, while an English prose continuation such as `lemon is`
  // remains eligible for display branding.
  const firstCodePoint = input.slice(span.end).trimStart().codePointAt(0)

  return firstCodePoint === undefined || firstCodePoint > 0x7f
}

function shouldProtectCliSpan(input: string, span: TextSpan): boolean {
  return (
    hasCodeOrQuoteBoundary(input, span.start, span.end) ||
    hasCliContext(input, span.start) ||
    hasOnlyCommandPunctuationAfter(input, span.end) ||
    hasKnownCliCommandShape(input, span) ||
    hasBareTechnicalContext(input, span)
  )
}

function protectCliSpans(input: string, protect: (original: string) => string): string {
  let output = ''
  let cursor = 0
  CLI_EXECUTABLE.lastIndex = 0

  for (let match = CLI_EXECUTABLE.exec(input); match !== null; match = CLI_EXECUTABLE.exec(input)) {
    const start = match.index
    const span = scanCliCommand(input, start, match[0].length)

    output += input.slice(cursor, start)

    if (shouldProtectCliSpan(input, span)) {
      output += protect(input.slice(span.start, span.end))
      cursor = span.end
      CLI_EXECUTABLE.lastIndex = span.end
    } else {
      output += input.slice(start, span.end)
      cursor = span.end
      CLI_EXECUTABLE.lastIndex = span.end
    }
  }

  return output + input.slice(cursor)
}

function protectTechnicalContracts(input: string, protect: (original: string) => string): string {
  TECHNICAL_CONTRACT.lastIndex = 0

  return input.replace(TECHNICAL_CONTRACT, (match, offset: number) => {
    if (input[offset - 1] === '.') {
      return match
    }

    return protect(match)
  })
}

function protectInterpolationValues(input: string, values: readonly unknown[]): ProtectedBrandText {
  const replacements: Array<{ original: string; token: string }> = []
  let text = input

  const stringValues = values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length)

  for (const original of stringValues) {
    if (!text.includes(original)) {
      continue
    }

    const token = `${BRAND_VALUE_TOKEN_PREFIX}${replacements.length}${BRAND_VALUE_TOKEN_SUFFIX}`
    text = text.split(original).join(token)
    replacements.push({ original, token })
  }

  return {
    restore: value =>
      replacements.reduce((next, replacement) => next.split(replacement.token).join(replacement.original), value),
    text
  }
}

function protectDisplaySpans(input: string): ProtectedBrandText {
  const replacements: Array<{ original: string; token: string }> = []

  const protect = (original: string): string => {
    const token = `${BRAND_SPAN_TOKEN_PREFIX}${replacements.length}${BRAND_VALUE_TOKEN_SUFFIX}`
    replacements.push({ original, token })

    return token
  }

  // Keep URLs and lower-case executable CLI command spans intact. Product
  // names inside quotes/backticks remain brandable display copy unless the span
  // is a lower-case executable or technical contract identifier.
  const textWithProtectedUrls = input.replace(/https?:\/\/[^\s<>"'`]+/gi, protect)
  const textWithProtectedContracts = protectTechnicalContracts(textWithProtectedUrls, protect)
  const text = protectCliSpans(textWithProtectedContracts, protect)

  return {
    restore: value =>
      replacements.reduce((next, replacement) => next.split(replacement.token).join(replacement.original), value),
    text
  }
}

function replaceBrandText(input: string, brand: AppBrand): string {
  const protectedSpans = protectDisplaySpans(input)

  const tokenized = protectedSpans.text
    .replace(/~\/\.hermes(?=\/|\b)/gi, '~/.lemon-ai')
    .replace(/\bHermes Desktop\b/gi, '{appName}')
    .replace(/\bHermes Agent\b/gi, '{appName}')
    .replace(/\bHermes backend\b/gi, '{appName} backend')
    .replace(/\bHermes gateway\b/gi, '{appName} gateway')
    .replace(/\bHermes\b/gi, '{appName}')

  return protectedSpans.restore(replaceAppBrandTokens(tokenized, brand))
}

function brandTranslationFunction(
  translate: (...args: never[]) => unknown,
  args: readonly unknown[],
  brand: AppBrand
): unknown {
  const rendered = translate(...(args as never[]))

  if (typeof rendered !== 'string') {
    return brandTranslationTree(rendered, brand)
  }

  const stringArgs = args.filter((value): value is string => typeof value === 'string' && value.length > 0)

  if (stringArgs.length === 0) {
    return replaceBrandText(rendered, brand)
  }

  const tokens = stringArgs.map((_, index) => `${BRAND_VALUE_TOKEN_PREFIX}probe-${index}${BRAND_VALUE_TOKEN_SUFFIX}`)
  const projected = replaceValuesWithTokens(rendered, stringArgs, tokens)

  const probeArgs = args.map(value =>
    typeof value === 'string' && value.length > 0 ? tokens[stringArgs.indexOf(value)] : value
  )

  try {
    const probed = translate(...(probeArgs as never[]))

    if (typeof probed === 'string' && probed === projected) {
      return restoreTokens(replaceBrandText(probed, brand), stringArgs, tokens)
    }
  } catch {
    // Some extension translators may validate their arguments. Fall back to
    // the value-preserving path below when a sentinel probe is not accepted.
  }

  return replaceLemonBrandTerms(rendered, brand, args)
}

export function replaceLemonBrandTerms(
  input: string,
  brand: AppBrand = appBrandForEnv(),
  preserveValues: readonly unknown[] = []
): string {
  if (brand.mode === 'upstream') {
    return input
  }

  const protectedValues = protectInterpolationValues(input, preserveValues)

  return protectedValues.restore(replaceBrandText(protectedValues.text, brand))
}

export function replaceAppBrandTokens(input: string, brand: AppBrand = appBrandForEnv()): string {
  return input.replace(/\{(agentName|appName|chatGuiName)\}/g, (token, key: AppBrandToken) => brand[key] ?? token)
}

/**
 * Apply internal branding to a translation tree without changing the
 * upstream object. Translation functions are wrapped so interpolated values
 * receive the same display-only rewrite as static strings.
 */
export function brandTranslationTree<T>(value: T, brand: AppBrand = appBrandForEnv()): T {
  if (brand.mode === 'upstream') {
    return value
  }

  if (typeof value === 'string') {
    return replaceLemonBrandTerms(value, brand) as T
  }

  if (typeof value === 'function') {
    return ((...args: unknown[]) => {
      return brandTranslationFunction(value as (...args: never[]) => unknown, args, brand)
    }) as T
  }

  if (Array.isArray(value)) {
    return value.map(item => brandTranslationTree(item, brand)) as T
  }

  if (value !== null && typeof value === 'object') {
    const branded: Record<string, unknown> = {}

    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      branded[key] = brandTranslationTree(item, brand)
    }

    return branded as T
  }

  return value
}

export function applyAppBrandRoot(
  root: HTMLElement,
  brand: AppBrand = appBrandForEnv(),
  mode: 'light' | 'dark' = root.classList.contains('dark') ? 'dark' : 'light'
): void {
  if (brand.mode !== 'internal-harness') {
    delete root.dataset.lemonBrand

    return
  }

  root.dataset.lemonBrand = 'lemon'

  const vars: Record<string, string> = {
    '--lemon-brand-primary': brand.primary,
    '--lemon-brand-primary-foreground': brand.primaryForeground,
    '--lemon-brand-accent': brand.accent,
    '--lemon-brand-accent-foreground': brand.accentForeground,
    '--lemon-brand-sidebar-foreground': brand.sidebarForeground,
    '--lemon-workspace-canvas': mode === 'dark' ? '#171412' : '#ffffff',
    '--lemon-workspace-sidebar': mode === 'dark' ? '#24201d' : '#f5f5f3',
    '--lemon-workspace-raised': mode === 'dark' ? '#2c2723' : '#ffffff',
    '--lemon-workspace-ink': mode === 'dark' ? '#f5f1ea' : '#322b29',
    '--lemon-workspace-ink-muted': mode === 'dark' ? '#c9c0b5' : '#68645f',
    '--lemon-workspace-border': mode === 'dark' ? '#433b35' : '#e6e4df',
    '--lemon-workspace-brand': brand.primary,
    '--lemon-workspace-brand-hover': '#f4d300',
    '--lemon-workspace-brand-ink': brand.primaryForeground,
    '--lemon-workspace-selected': mode === 'dark' ? '#51470d' : '#fff4b8',
    '--lemon-workspace-selected-border': mode === 'dark' ? '#75670c' : '#f0d456',
    '--lemon-workspace-control-hover': mode === 'dark' ? '#332d29' : '#ffffff',
    '--lemon-workspace-focus': brand.ring,
    '--theme-primary': brand.primary,
    '--theme-midground': mode === 'dark' ? brand.primary : brand.primaryForeground,
    '--theme-accent-soft': mode === 'dark' ? '#51470d' : '#fff4b8',
    '--theme-warm': brand.ring,
    '--ui-accent': mode === 'dark' ? brand.primary : brand.primaryForeground,
    '--ui-accent-secondary': brand.ring,
    '--dt-primary-foreground': brand.primaryForeground,
    '--dt-primary-solid': brand.primary,
    '--dt-primary-solid-foreground': brand.primaryForeground,
    '--dt-accent-foreground': brand.primaryForeground,
    '--dt-midground-foreground': brand.primaryForeground,
    '--dt-composer-ring': brand.ring,
    '--dt-ring': brand.ring
  }

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value)
  }
}
