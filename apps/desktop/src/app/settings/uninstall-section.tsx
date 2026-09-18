import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import type { DesktopUninstallMode, DesktopUninstallSummary } from '@/global'
import { type Translations, useI18n } from '@/i18n'
import { TRANSLATIONS } from '@/i18n/catalog'
import { type AppBrand, appBrandForEnv, replaceLemonBrandTerms } from '@/lib/app-brand'
import { AlertTriangle, Loader2, Trash2 } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { SectionHeading } from './primitives'

interface ModeOption {
  mode: DesktopUninstallMode
  title: string
  description: string
  /** Shown in the confirm step so people know exactly what disappears. */
  consequence: string
  /** True when the option removes the Python agent (hidden if no agent). */
  needsAgent: boolean
}

interface UninstallCopy {
  cancelLabel: string
  confirmButtonLabel: string
  confirmDescription: (consequence: string) => string
  confirmTitle: string
  dangerTitle: string
  heading: string
  intro: string
  loadingLabel: string
  options: ModeOption[]
  runningLabel: string
  startError: string
}

export function uninstallCopyForBrand(
  brand: AppBrand = appBrandForEnv(),
  translations: Translations = brand.mode === 'internal-harness' ? TRANSLATIONS.vi : TRANSLATIONS.en
): UninstallCopy {
  const copy = translations.uninstall
  const text = (value: string): string => replaceLemonBrandTerms(value, brand)

  const option = (mode: DesktopUninstallMode, value: (typeof copy.options)[keyof typeof copy.options]): ModeOption => ({
    mode,
    title: text(value.title),
    description: text(value.description),
    consequence: text(value.consequence),
    needsAgent: mode !== 'gui'
  })

  return {
    cancelLabel: text(copy.cancel),
    confirmButtonLabel: text(copy.confirm),
    confirmDescription: consequence => text(copy.confirmDescription(consequence)),
    confirmTitle: text(copy.confirmTitle),
    dangerTitle: text(copy.dangerTitle),
    heading: text(copy.heading),
    intro: text(copy.intro),
    loadingLabel: text(copy.loading),
    options: [option('gui', copy.options.gui), option('lite', copy.options.lite), option('full', copy.options.full)],
    runningLabel: text(copy.running),
    startError: text(copy.startError)
  }
}

export function uninstallOptionsForBrand(
  brand: AppBrand = appBrandForEnv(),
  agentInstalled: boolean,
  translations?: Translations
): ModeOption[] {
  return uninstallCopyForBrand(brand, translations).options.filter(opt => agentInstalled || !opt.needsAgent)
}

export function UninstallSection() {
  const { t } = useI18n()
  const [summary, setSummary] = useState<DesktopUninstallSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<DesktopUninstallMode | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const bridge = window.lemonDesktop?.uninstall

    if (!bridge) {
      setLoading(false)

      return
    }

    void bridge
      .summary()
      .then(result => {
        if (alive) {
          setSummary(result)
        }
      })
      .catch(() => {
        // Non-fatal — we degrade to offering the GUI-only option.
      })
      .finally(() => {
        if (alive) {
          setLoading(false)
        }
      })

    return () => {
      alive = false
    }
  }, [])

  const bridge = window.lemonDesktop?.uninstall
  const brand = appBrandForEnv()
  const copy = uninstallCopyForBrand(brand, t)

  if (!bridge) {
    return null
  }

  // Gate the agent-removing options on whether an agent is actually present.
  // A future lite client that ships without the bundled agent shows GUI-only.
  const agentInstalled = summary?.agent_installed ?? false
  const visibleOptions = uninstallOptionsForBrand(brand, agentInstalled, t)

  const handleConfirm = async () => {
    if (!pending) {
      return
    }

    setRunning(true)
    setError(null)

    try {
      const result = await bridge.run(pending)

      if (!result.ok) {
        setError(result.message || result.error || copy.startError)
        setRunning(false)
        setPending(null)
      }
      // On success the app quits shortly; keep the spinner up until it does.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setRunning(false)
      setPending(null)
    }
  }

  const pendingOption = copy.options.find(opt => opt.mode === pending) ?? null

  return (
    <div className="mx-auto mt-8 w-full max-w-2xl">
      <SectionHeading icon={AlertTriangle} title={copy.dangerTitle} />

      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {copy.loadingLabel}
          </div>
        ) : pendingOption ? (
          <div>
            <p className="text-sm font-medium text-destructive">{copy.confirmTitle}</p>
            <p className="mt-1 text-xs text-muted-foreground">{copy.confirmDescription(pendingOption.consequence)}</p>
            {summary?.running_app_path && (
              <p className="mt-1 font-mono text-[0.68rem] text-muted-foreground/60">App: {summary.running_app_path}</p>
            )}
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button disabled={running} onClick={() => void handleConfirm()} size="sm" variant="destructive">
                {running && <Loader2 className="size-3 animate-spin" />}
                {running ? copy.runningLabel : copy.confirmButtonLabel}
              </Button>
              <Button disabled={running} onClick={() => setPending(null)} size="sm" variant="text">
                {copy.cancelLabel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">{copy.heading}</p>
            <p className="text-xs text-muted-foreground">{copy.intro}</p>
            <div className="mt-1 flex flex-col gap-2">
              {visibleOptions.map(opt => (
                <button
                  className={cn(
                    'flex items-start gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 text-left transition',
                    'hover:border-destructive/40 hover:bg-destructive/5'
                  )}
                  key={opt.mode}
                  onClick={() => {
                    setError(null)
                    setPending(opt.mode)
                  }}
                  type="button"
                >
                  <Trash2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{opt.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{opt.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
