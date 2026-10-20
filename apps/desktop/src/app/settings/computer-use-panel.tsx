import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  getActionStatus,
  getComputerUseHistory,
  getComputerUsePrivilege,
  getComputerUseStatus,
  grantComputerUsePermissions,
  putComputerUseHistory,
  putComputerUsePrivilege
} from '@/lemon'
import { appBrand, replaceLemonBrandTerms } from '@/lib/app-brand'
import { AlertTriangle, Check, ExternalLink, Loader2, RefreshCw, X } from '@/lib/icons'
import { upsertDesktopActionTask } from '@/store/activity'
import { notify, notifyError } from '@/store/notifications'
import type {
  ComputerUseHistory,
  ComputerUsePrivilege,
  ComputerUsePrivilegeMode,
  ComputerUseStatus
} from '@/types/lemon'

import { Pill } from './primitives'

interface ComputerUsePanelProps {
  /** Re-read the parent toolset list after a permission/install change so the
   *  "Configured / Needs keys" pill stays in sync. */
  onConfiguredChange?: () => void
}

// Per-OS one-liner shown when there's no TCC grant flow (Windows/Linux). macOS
// drives the permission rows instead, so it has no entry here.
const PLATFORM_NOTE: Record<string, string> = {
  linux: 'Drives your desktop via the X11/XWayland accessibility stack — no permission prompt.',
  win32: 'First run may trigger a Windows SmartScreen prompt for the cua-driver UIAccess worker — allow it.'
}

const PRIVILEGE_OPTIONS: {
  mode: ComputerUsePrivilegeMode
  label: string
  hint: string
}[] = [
  {
    mode: 'capture_only',
    label: 'Capture only',
    hint: 'Screenshots and app lists only — clicks and typing stay blocked.'
  },
  {
    mode: 'ask',
    label: 'Ask before act',
    hint: 'Mutating actions prompt Allow / Deny (recommended default).'
  },
  {
    mode: 'trusted_apps',
    label: 'Trusted apps',
    hint: 'Apps on the list skip the prompt; everything else still asks.'
  }
]

function tone(granted: boolean | null) {
  return granted === true ? 'primary' : 'muted'
}

function GrantIcon({ granted }: { granted: boolean | null }) {
  const Icon = granted === true ? Check : granted === false ? X : AlertTriangle

  return <Icon className="size-3" />
}

function PermissionRow({ granted, label, hint }: { granted: boolean | null; label: string; hint: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/55 p-2.5">
      <div className="min-w-0">
        <span className="text-sm font-medium">{label}</span>
        <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{hint}</p>
      </div>
      <Pill tone={tone(granted)}>
        <GrantIcon granted={granted} />
        {granted === true ? 'Granted' : granted === false ? 'Not granted' : 'Unknown'}
      </Pill>
    </div>
  )
}

/**
 * Cross-platform Computer Use preflight card.
 *
 * Block A — OS permissions (macOS TCC / driver health).
 * Block B — What Lemon may do (privilege_mode + trusted apps), Codex-like.
 * Block C — Session history (opt-in; privacy default OFF).
 */
export function ComputerUsePanel({ onConfiguredChange }: ComputerUsePanelProps) {
  const brand = appBrand()
  const [status, setStatus] = useState<ComputerUseStatus | null>(null)
  const [privilege, setPrivilege] = useState<ComputerUsePrivilege | null>(null)
  const [history, setHistory] = useState<ComputerUseHistory | null>(null)
  const [loading, setLoading] = useState(true)
  const [granting, setGranting] = useState(false)
  const [savingPrivilege, setSavingPrivilege] = useState(false)
  const [savingHistory, setSavingHistory] = useState(false)
  const [draftApp, setDraftApp] = useState('')
  const activeRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [nextStatus, nextPrivilege, nextHistory] = await Promise.all([
        getComputerUseStatus(),
        getComputerUsePrivilege().catch(() => null),
        getComputerUseHistory().catch(() => null)
      ])
      setStatus(nextStatus)
      if (nextPrivilege) {
        setPrivilege(nextPrivilege)
      }
      if (nextHistory) {
        setHistory(nextHistory)
      }
    } catch (err) {
      notifyError(err, 'Could not read Computer Use status')
    } finally {
      setLoading(false)
    }
  }, [])

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    activeRef.current = true
    void refresh()

    return () => void (activeRef.current = false)
  }, [refresh])

  const grant = useCallback(async () => {
    setGranting(true)

    try {
      const started = await grantComputerUsePermissions()

      if (!started.ok) {
        notifyError(new Error('spawn failed'), 'Could not request permissions')

        return
      }

      notify({
        kind: 'info',
        title: 'Approve in System Settings',
        message: 'macOS will show a permission dialog attributed to CuaDriver. Approve it, then return here.'
      })

      // The driver waits for the user to flip the switch — poll until it exits.
      for (let attempt = 0; attempt < 150 && activeRef.current; attempt += 1) {
        await new Promise(resolve => window.setTimeout(resolve, 1500))

        if (!activeRef.current) {
          break
        }

        const polled = await getActionStatus(started.name, 200)
        upsertDesktopActionTask(polled)

        if (!polled.running) {
          break
        }
      }

      if (activeRef.current) {
        await refresh()
        onConfiguredChange?.()
      }
    } catch (err) {
      if (activeRef.current) {
        notifyError(err, 'Could not request permissions')
      }
    } finally {
      if (activeRef.current) {
        setGranting(false)
      }
    }
  }, [onConfiguredChange, refresh])

  const handlePrivilegeMode = useCallback(
    async (mode: ComputerUsePrivilegeMode) => {
      setSavingPrivilege(true)
      try {
        const next = await putComputerUsePrivilege({ privilege_mode: mode })
        setPrivilege(next)
        notify({ kind: 'info', title: 'Privilege updated', message: `Computer Use is now: ${mode}` })
      } catch (err) {
        notifyError(err, 'Could not update privilege')
      } finally {
        setSavingPrivilege(false)
      }
    },
    []
  )

  const handleAddTrustedApp = useCallback(async () => {
    const name = draftApp.trim()
    if (!name || !privilege) {
      return
    }
    const nextList = privilege.trusted_apps.some(a => a.toLowerCase() === name.toLowerCase())
      ? privilege.trusted_apps
      : [...privilege.trusted_apps, name]
    setSavingPrivilege(true)
    try {
      const next = await putComputerUsePrivilege({
        privilege_mode: 'trusted_apps',
        trusted_apps: nextList
      })
      setPrivilege(next)
      setDraftApp('')
    } catch (err) {
      notifyError(err, 'Could not update trusted apps')
    } finally {
      setSavingPrivilege(false)
    }
  }, [draftApp, privilege])

  const handleRemoveTrustedApp = useCallback(
    async (app: string) => {
      if (!privilege) {
        return
      }
      setSavingPrivilege(true)
      try {
        const next = await putComputerUsePrivilege({
          trusted_apps: privilege.trusted_apps.filter(a => a !== app)
        })
        setPrivilege(next)
      } catch (err) {
        notifyError(err, 'Could not update trusted apps')
      } finally {
        setSavingPrivilege(false)
      }
    },
    [privilege]
  )

  const handleHistoryEnabled = useCallback(async (enabled: boolean) => {
    setSavingHistory(true)
    try {
      const next = await putComputerUseHistory({ history_enabled: enabled })
      setHistory(next)
      notify({
        kind: 'info',
        title: 'Session history',
        message: enabled
          ? 'Computer Use will log actions in this profile (opt-in).'
          : 'Computer Use history is off (privacy default).'
      })
    } catch (err) {
      notifyError(err, 'Could not update history setting')
    } finally {
      setSavingHistory(false)
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Checking Computer Use status…
      </div>
    )
  }

  if (!status) {
    return null
  }

  if (!status.platform_supported) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        Computer Use isn&apos;t supported on this platform ({status.platform}).
      </p>
    )
  }

  if (!status.installed) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        Install the cua-driver backend below to drive this machine.
        {status.can_grant && ' Then grant Accessibility and Screen Recording here.'}
      </p>
    )
  }

  const failingChecks = status.checks.filter(c => c.status !== 'ok')
  const mode = privilege?.privilege_mode ?? 'ask'

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          {status.can_grant ? (
            <p className="text-[0.72rem] text-muted-foreground">
              {replaceLemonBrandTerms(
                "Grants attach to CuaDriver's own identity (com.trycua.driver), not Lemon AI — so the dialog is attributed to the process that drives your Mac.",
                brand
              )}
            </p>
          ) : (
            <p className="text-[0.72rem] text-muted-foreground">{PLATFORM_NOTE[status.platform] ?? ''}</p>
          )}
          {status.version && <p className="text-[0.68rem] text-muted-foreground/80">{status.version}</p>}
        </div>
        <Button onClick={() => void refresh()} size="sm" variant="text">
          <RefreshCw className="size-3.5" />
          Recheck
        </Button>
      </div>

      <div className="grid gap-2">
        <p className="px-1 text-[0.72rem] font-medium text-foreground/90">macOS permissions</p>
        {status.can_grant ? (
          <>
            <PermissionRow
              granted={status.accessibility}
              hint="Lets cua-driver post clicks, keystrokes, and read the accessibility tree."
              label="Accessibility"
            />
            <PermissionRow
              granted={status.screen_recording}
              hint="Lets cua-driver capture screenshots of app windows."
              label="Screen Recording"
            />
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/55 p-2.5">
            <span className="text-sm font-medium">Driver health</span>
            <Pill tone={tone(status.ready)}>
              <GrantIcon granted={status.ready} />
              {status.ready === true ? 'Ready' : status.ready === false ? 'Not ready' : 'Unknown'}
            </Pill>
          </div>
        )}
      </div>

      {failingChecks.map(c => (
        <p className="px-1 text-[0.7rem] text-muted-foreground" key={c.label}>
          <AlertTriangle className="mr-1 inline size-3" />
          {c.label}: {c.message}
        </p>
      ))}

      {status.error && (
        <p className="px-1 text-[0.7rem] text-muted-foreground">
          <AlertTriangle className="mr-1 inline size-3" />
          {status.error}
        </p>
      )}

      {status.ready ? (
        <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
          <Check className="size-3.5" />
          Computer Use is ready. Ask the agent to capture an app and click around.
        </div>
      ) : (
        status.can_grant && (
          <Button disabled={granting} onClick={() => void grant()} size="sm">
            {granting ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
            {granting ? 'Waiting for approval…' : 'Grant permissions'}
          </Button>
        )
      )}

      {/* Block B — privilege picker (independent of TCC readiness). */}
      <div className="grid gap-2 border-t border-border/40 pt-3">
        <div className="px-1">
          <p className="text-[0.72rem] font-medium text-foreground/90">
            {replaceLemonBrandTerms('What Lemon may do', brand)}
          </p>
          <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
            Separate from OS permissions — choose how far the agent can go after the driver is ready.
          </p>
        </div>

        <div aria-label="Computer Use privilege" className="grid gap-1.5" role="radiogroup">
          {PRIVILEGE_OPTIONS.map(opt => {
            const selected = mode === opt.mode
            return (
              <button
                aria-checked={selected}
                aria-label={opt.label}
                className={`rounded-lg px-2.5 py-2 text-left transition-colors ${
                  selected ? 'bg-primary/15 ring-1 ring-primary/40' : 'bg-background/55 hover:bg-background/80'
                }`}
                disabled={savingPrivilege}
                key={opt.mode}
                onClick={() => void handlePrivilegeMode(opt.mode)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    void handlePrivilegeMode(opt.mode)
                  }
                }}
                role="radio"
                tabIndex={0}
                type="button"
              >
                <span className="text-sm font-medium">{opt.label}</span>
                <p className="mt-0.5 text-[0.68rem] text-muted-foreground">{opt.hint}</p>
              </button>
            )
          })}
        </div>

        {mode === 'trusted_apps' && privilege && (
          <div className="grid gap-2 rounded-lg bg-background/55 p-2.5">
            <p className="text-[0.7rem] text-muted-foreground">
              Add app names (e.g. TextEdit, Safari) or bundle ids. Unlisted apps still ask before act.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {privilege.trusted_apps.length === 0 && (
                <span className="text-[0.68rem] text-muted-foreground">No trusted apps yet.</span>
              )}
              {privilege.trusted_apps.map(app => (
                <button
                  aria-label={`Remove ${app}`}
                  className="inline-flex items-center gap-1 rounded-md bg-background px-2 py-0.5 text-[0.7rem]"
                  key={app}
                  onClick={() => void handleRemoveTrustedApp(app)}
                  type="button"
                >
                  {app}
                  <X className="size-3" />
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Trusted app name"
                className="min-w-[10rem] flex-1 rounded-md border border-border/60 bg-background px-2 py-1 text-sm"
                onChange={event => setDraftApp(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleAddTrustedApp()
                  }
                }}
                placeholder="App name or bundle id"
                value={draftApp}
              />
              <Button disabled={savingPrivilege || !draftApp.trim()} onClick={() => void handleAddTrustedApp()} size="sm">
                Add
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Block C — opt-in session history (privacy default OFF). */}
      <div className="grid gap-2 border-t border-border/40 pt-3">
        <div className="px-1">
          <p className="text-[0.72rem] font-medium text-foreground/90">Session history</p>
          <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
            Optional timeline of Computer Use actions in this profile. Off by default — not continuous
            background recording.
          </p>
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-background/55 px-2.5 py-2">
          <input
            aria-label="Enable Computer Use session history"
            checked={Boolean(history?.history_enabled)}
            className="mt-0.5 size-3.5 accent-primary"
            disabled={savingHistory || history == null}
            onChange={event => void handleHistoryEnabled(event.target.checked)}
            type="checkbox"
          />
          <span className="min-w-0">
            <span className="text-sm font-medium">Log Computer Use actions</span>
            <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
              Agent can call <code className="text-[0.65rem]">action=history</code> for “what did I just
              do”. Text/values are truncated in the log.
            </p>
          </span>
        </label>
      </div>
    </div>
  )
}
