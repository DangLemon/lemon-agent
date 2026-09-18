import { useState } from 'react'

import { type ComposerTarget, requestComposerFocus, requestComposerInsert } from '@/app/chat/composer/focus'
import { useI18n } from '@/i18n'
import { appBrand, replaceLemonBrandTerms } from '@/lib/app-brand'
import { BarChart3, Clipboard, FileText, NotebookTabs } from '@/lib/icons'
import { capitalize, normalize } from '@/lib/text'
import { cn } from '@/lib/utils'

import introCopyJsonl from './intro-copy.jsonl?raw'
import { Wordmark } from './wordmark'

type IntroCopy = {
  headline: string
  body: string
}

type IntroCopyRecord = IntroCopy & {
  personality: string
}

export type IntroProps = {
  composerDisabled?: boolean
  composerTarget?: ComposerTarget
  homeLayout?: boolean
  personality?: string
  seed?: number
}

const NEUTRAL_PERSONALITIES = new Set(['', 'default', 'none', 'neutral'])

const FALLBACK_COPY: IntroCopy[] = [
  {
    headline: 'What are we moving today?',
    body: "Send a bug, branch, plan, or rough idea. I'll inspect the repo and turn it into the next concrete step."
  },
  {
    headline: "What's on your mind?",
    body: "Bring the code, question, or stuck part. I'll read the room before making changes."
  },
  {
    headline: 'What should Lemon AI look at?',
    body: "Send the task, failing path, or half-formed plan. I'll help turn it into action."
  },
  {
    headline: 'Where should we start?',
    body: "Bring the problem, goal, or file. I'll inspect first and keep the next step concrete."
  },
  {
    headline: 'What needs attention?',
    body: "Send the context you have. I'll help sort it into a plan or a fix."
  }
]

function normalizeKey(value?: string): string {
  return normalize(value)
}

function titleize(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(capitalize)
    .join(' ')
}

function isIntroCopyRecord(value: unknown): value is IntroCopyRecord {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Record<string, unknown>

  return (
    typeof record.personality === 'string' &&
    typeof record.headline === 'string' &&
    typeof record.body === 'string' &&
    Boolean(record.personality.trim()) &&
    Boolean(record.headline.trim()) &&
    Boolean(record.body.trim())
  )
}

function parseIntroCopy(raw: string): Record<string, IntroCopy[]> {
  const byPersonality: Record<string, IntroCopy[]> = {}

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()

    if (!trimmed) {
      continue
    }

    try {
      const parsed: unknown = JSON.parse(trimmed)

      if (!isIntroCopyRecord(parsed)) {
        continue
      }

      const key = normalizeKey(parsed.personality)
      byPersonality[key] ??= []
      byPersonality[key].push({
        headline: parsed.headline.trim(),
        body: parsed.body.trim()
      })
    } catch {
      // Bad generated copy should not break the whole desktop app.
    }
  }

  return byPersonality
}

const INTRO_COPY_BY_PERSONALITY = parseIntroCopy(introCopyJsonl)

const INTERNAL_STARTERS = [
  {
    copyKey: 'writeContent',
    icon: FileText
  },
  {
    copyKey: 'summarizeDocument',
    icon: Clipboard
  },
  {
    copyKey: 'analyzeReport',
    icon: BarChart3
  },
  {
    copyKey: 'planWork',
    icon: NotebookTabs
  }
] as const

function neutralCopy(): IntroCopy[] {
  return INTRO_COPY_BY_PERSONALITY.none || INTRO_COPY_BY_PERSONALITY.default || FALLBACK_COPY
}

function fallbackCopyForPersonality(personalityKey: string, displayName = 'Lemon AI'): IntroCopy[] {
  if (NEUTRAL_PERSONALITIES.has(personalityKey)) {
    return neutralCopy()
  }

  const label = titleize(personalityKey)

  return [
    {
      headline: `${label} mode is on. What should we work on?`,
      body: `Send the task, file, or rough idea. I'll use your configured voice and keep ${displayName} grounded in this repo.`
    },
    {
      headline: `What does ${label} ${displayName} need to see?`,
      body: "Bring the context or the stuck part. I'll adapt to your configured personality."
    },
    {
      headline: `${label} mode is ready.`,
      body: "Send the problem, file, or idea. I'll follow the personality you've configured."
    },
    {
      headline: `What should ${label} ${displayName} tackle?`,
      body: "Drop the task here. I'll keep the work grounded in the repo."
    },
    {
      headline: 'Where should we begin?',
      body: `Give me the context and I'll answer in ${label} mode.`
    }
  ]
}

function pickCopy(copies: IntroCopy[], seed = 0): IntroCopy {
  return copies[Math.abs(seed) % copies.length] || FALLBACK_COPY[0]
}

function resolveCopy(personality?: string, seed?: number, displayName = 'Lemon AI'): IntroCopy {
  const personalityKey = normalizeKey(personality)

  const copies = NEUTRAL_PERSONALITIES.has(personalityKey)
    ? INTRO_COPY_BY_PERSONALITY[personalityKey] || neutralCopy()
    : INTRO_COPY_BY_PERSONALITY[personalityKey] || fallbackCopyForPersonality(personalityKey, displayName)

  return pickCopy(copies, seed)
}

export function Intro({ composerDisabled = false, composerTarget = 'active', personality, seed }: IntroProps) {
  const { t } = useI18n()
  const [mountSeed] = useState(() => Math.floor(Math.random() * 100000))
  const brand = appBrand()
  const copy = resolveCopy(personality, mountSeed + (seed ?? 0), brand.displayName)

  const displayCopy = {
    body: replaceLemonBrandTerms(copy.body, brand),
    headline: replaceLemonBrandTerms(copy.headline, brand)
  }

  const internalCopy = t.internalWorkspace

  return (
    <div
      className={cn(
        'pointer-events-none flex w-full min-w-0 flex-col items-center justify-center px-0.5 text-center text-muted-foreground sm:px-6 lg:px-8',
        brand.mode === 'internal-harness' ? 'py-0' : 'py-6'
      )}
      data-slot="aui_intro"
    >
      <div className="w-full min-w-0">
        {brand.mode === 'internal-harness' ? (
          <div className="mx-auto flex w-full max-w-[48rem] flex-col items-center text-[#322b29] dark:text-foreground">
            <h1 className="m-0 text-[2rem] font-semibold leading-[1.25] tracking-normal text-current">
              {internalCopy.home.heading}
            </h1>
            <p className="mt-3 max-w-[36rem] text-[0.96rem] leading-6 tracking-normal text-[#68645f] dark:text-muted-foreground">
              {internalCopy.home.supporting}
            </p>
            <div className="pointer-events-auto mt-7 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              {INTERNAL_STARTERS.map(starter => {
                const Icon = starter.icon
                const starterCopy = internalCopy.starters[starter.copyKey]

                return (
                  <button
                    className="group flex min-h-[6rem] min-w-0 items-start gap-3 rounded-[10px] border border-[#e6e4df] bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(50,43,41,0.04)] transition-colors hover:border-[#d6c778] hover:bg-[#fff9d8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#806b00] disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:bg-card dark:hover:bg-accent/30"
                    disabled={composerDisabled}
                    key={starter.copyKey}
                    onClick={() => {
                      requestComposerInsert(starterCopy.draft, { mode: 'block', target: composerTarget })
                      requestComposerFocus(composerTarget)
                    }}
                    type="button"
                  >
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#fff4b8] text-[#322b29] dark:bg-primary/20 dark:text-foreground">
                      <Icon aria-hidden className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.95rem] font-medium leading-5 text-[#322b29] dark:text-foreground">
                        {starterCopy.title}
                      </span>
                      <span className="mt-1 block text-[0.82rem] leading-5 text-[#68645f] dark:text-muted-foreground">
                        {starterCopy.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            <Wordmark className="mb-1" text={brand.wordmark} />
            <p className="m-0 text-center leading-normal tracking-tight">{displayCopy.body}</p>
          </>
        )}
      </div>
    </div>
  )
}
