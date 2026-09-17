import { type ReactNode, useEffect, useRef, useState } from 'react'

import type { HarnessProvisioning } from '@/app/internal-company/capabilities'
import { StatusDot, type StatusTone } from '@/components/status-dot'
import { Button } from '@/components/ui/button'
import { LogView } from '@/components/ui/log-view'
import { Tip } from '@/components/ui/tooltip'
import { getLogs } from '@/lemon'
import { useI18n } from '@/i18n'
import { LayoutDashboard, Power, RefreshCw } from '@/lib/icons'
import { runtimeReadinessForBrand, type RuntimeReadinessResult } from '@/lib/runtime-readiness'
import { cn } from '@/lib/utils'
import { reconnectGateway } from '@/store/gateway-reconnect'
import { notifyError } from '@/store/notifications'
import { runGatewayRestart } from '@/store/system-actions'
import type { StatusResponse } from '@/types/lemon'

interface GatewayMenuPanelProps {
  gatewayState: string
  harnessMode?: boolean
  harnessProvisioning?: HarnessProvisioning | null
  inferenceStatus: RuntimeReadinessResult | null
  onClose: () => void
  onOpenAiConnection?: () => void
  onOpenSystem: () => void
  statusSnapshot: StatusResponse | null
}

const LOG_TAIL = 120
const LOG_VISIBLE = 40
const LOG_POLL_MS = 3_000

// Per-connection WebSocket churn (accept/close/heartbeat) drowns out anything
// useful — strip it so the tail reads as real gateway activity at a glance.
const LOG_NOISE_RE = /\bws (?:accepted|closed|response sent|ping|pong)\b/i

// Live tail while the popover is mounted (i.e. open): poll on a tight cadence
// and stop on unmount, instead of a global always-on status poll.
function useGatewayLogTail(): string[] {
  const [lines, setLines] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false

    // async: getLogs THROWS (not rejects) when the desktop bridge is missing
    // (plain-browser mode) — a sync throw here would take down the root
    // error boundary before the .catch even attaches.
    const load = async () => {
      try {
        const res = await getLogs({ file: 'gui', lines: LOG_TAIL })

        if (cancelled) {
          return
        }

        setLines(
          res.lines
            .map(line => line.trim())
            .filter(line => line && !LOG_NOISE_RE.test(line))
            .slice(-LOG_VISIBLE)
        )
      } catch {
        // Bridge/gateway unavailable — keep the last tail.
      }
    }

    void load()
    const timer = window.setInterval(load, LOG_POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  return lines
}

const PLATFORM_TONE: Record<string, StatusTone> = {
  connected: 'good',
  connecting: 'warn',
  retrying: 'warn',
  pending_restart: 'warn',
  startup_failed: 'bad',
  fatal: 'bad'
}

const prettyState = (state: string) => state.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

// Strip leading "YYYY-MM-DD HH:MM:SS,mmm " and "[runtime_id] " prefixes from
// log lines so they don't dominate the display. Full text preserved on hover.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[,.\d]*\s+/
const RUNTIME_BRACKET_RE = /^\[[^\]]+]\s+/
const trimLogLine = (raw: string) => raw.trim().replace(TIMESTAMP_RE, '').replace(RUNTIME_BRACKET_RE, '')

export function GatewayMenuPanel({
  gatewayState,
  harnessMode = false,
  harnessProvisioning = null,
  inferenceStatus,
  onClose,
  onOpenAiConnection,
  onOpenSystem,
  statusSnapshot
}: GatewayMenuPanelProps) {
  const { t } = useI18n()
  const copy = t.shell.gatewayMenu
  const [reconnecting, setReconnecting] = useState(false)

  // Both jumps open the system panel, which owns the full view — so dismiss the
  // little status popover on the way out.
  const openSystem = () => {
    onClose()
    onOpenSystem()
  }

  // Shared restart helper: never rejects and surfaces progress in the statusbar
  // gateway indicator, so just fire and close.
  const restart = () => {
    onClose()
    void runGatewayRestart()
  }

  const reconnect = () => {
    if (reconnecting) {
      return
    }

    setReconnecting(true)
    void reconnectGateway()
      .catch(err => notifyError(err, copy.reconnectGateway))
      .finally(() => setReconnecting(false))
  }

  const openAiConnection = () => {
    onClose()
    onOpenAiConnection?.()
  }

  const displayInferenceStatus = runtimeReadinessForBrand(inferenceStatus)

  const gatewayOpen = gatewayState === 'open'
  const showAdminChrome = !harnessMode
  const showProvisioningNotice = harnessMode && harnessProvisioning?.state && harnessProvisioning.state !== 'complete'
  const gatewayConnecting = gatewayState === 'connecting'
  const inferenceReady = gatewayOpen && displayInferenceStatus?.ready === true
  const provisioningAlreadyOffersAiConnection =
    harnessProvisioning?.state === 'incomplete' && harnessProvisioning.missing.includes('inference')

  const showAiConnectionShortcut = harnessMode && !inferenceReady && !provisioningAlreadyOffersAiConnection

  const connectionLabel = gatewayOpen
    ? copy.connected
    : gatewayConnecting
      ? copy.connecting
      : prettyState(gatewayState || copy.offline)

  const inferenceLabel = gatewayOpen
    ? displayInferenceStatus?.ready
      ? copy.inferenceReady
      : displayInferenceStatus
        ? copy.inferenceNotReady
        : copy.checkingInference
    : copy.disconnected

  const platforms = Object.entries(statusSnapshot?.gateway_platforms || {}).sort(([l], [r]) => l.localeCompare(r))
  const recentLogs = useGatewayLogTail()

  // Keep the tail pinned to the latest line as it streams.
  const logScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = logScrollRef.current

    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [recentLogs])

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="flex min-w-0 flex-col gap-1 text-[0.7rem] leading-none">
          <span className="flex items-center gap-1.5 font-medium">
            <StatusDot tone={gatewayOpen ? 'good' : gatewayConnecting ? 'warn' : 'bad'} />
            {connectionLabel}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <StatusDot tone={inferenceReady ? 'good' : gatewayOpen ? 'warn' : 'bad'} />
            {inferenceLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!gatewayOpen && (
            <Tip label={copy.reconnectGateway}>
              <Button
                aria-label={copy.reconnectGateway}
                className="text-muted-foreground hover:text-foreground"
                disabled={reconnecting}
                onClick={reconnect}
                size="icon-xs"
                variant="ghost"
              >
                <RefreshCw className={cn(reconnecting && 'animate-spin')} />
              </Button>
            </Tip>
          )}
          {showAdminChrome && (
            <>
              <Tip label={copy.openSystem}>
                <Button
                  aria-label={copy.openSystem}
                  className="text-muted-foreground hover:text-foreground"
                  onClick={openSystem}
                  size="icon-xs"
                  variant="ghost"
                >
                  <LayoutDashboard />
                </Button>
              </Tip>
              {/* Restart is the heavy, disruptive action: keep it visually distinct
                  (power icon, destructive hover) and separated from the benign
                  reconnect/system buttons so it can't be hit by mistake. */}
              <span aria-hidden className="mx-1 h-4 w-px bg-border/70" />
              <Tip label={t.commandCenter.restartGateway}>
                <Button
                  aria-label={t.commandCenter.restartGateway}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={restart}
                  size="icon-xs"
                  variant="ghost"
                >
                  <Power />
                </Button>
              </Tip>
            </>
          )}
        </div>
      </div>

      {showProvisioningNotice && harnessProvisioning && (
        <ProvisioningNotice onOpenAiConnection={openAiConnection} provisioning={harnessProvisioning} />
      )}

      {showAiConnectionShortcut && (
        <Section className="text-xs text-muted-foreground">
          <Button className="h-auto px-2 py-1 text-xs" onClick={openAiConnection} size="xs" type="button" variant="secondary">
            {copy.openAiConnection}
          </Button>
        </Section>
      )}

      {displayInferenceStatus?.reason && (
        <Section className="text-xs text-muted-foreground">
          <div className="line-clamp-3">{displayInferenceStatus.reason}</div>
        </Section>
      )}

      {recentLogs.length > 0 && (
        <Section>
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>{copy.recentActivity}</SectionLabel>
            {showAdminChrome && (
              <Button
                className="-mr-2 h-auto py-0 font-medium leading-none text-muted-foreground"
                onClick={openSystem}
                size="xs"
                type="button"
                variant="text"
              >
                {copy.viewAllLogs}
              </Button>
            )}
          </div>
          <LogView className="mt-1.5 max-h-40 border-0 px-0" ref={logScrollRef}>
            {recentLogs.map(trimLogLine).join('\n')}
          </LogView>
        </Section>
      )}

      {platforms.length > 0 && (
        <Section>
          <SectionLabel>{copy.messagingPlatforms}</SectionLabel>
          <ul className="mt-1.5 space-y-1">
            {platforms.map(([name, platform]) => (
              <li className="flex items-center justify-between gap-2 text-xs" key={name}>
                <span className="truncate capitalize">{name}</span>
                <span className="flex items-center gap-1.5 text-[0.66rem] text-muted-foreground">
                  <StatusDot tone={PLATFORM_TONE[platform.state] || 'muted'} />
                  {prettyState(platform.state)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

function ProvisioningNotice({
  onOpenAiConnection,
  provisioning
}: {
  onOpenAiConnection: () => void
  provisioning: HarnessProvisioning
}) {
  const { t } = useI18n()
  const copy = t.shell.gatewayMenu
  const missingInference = provisioning.missing.includes('inference')

  if (provisioning.state === 'incomplete' && missingInference) {
    return (
      <Section className="space-y-2 text-xs text-muted-foreground">
        <SectionLabel>{copy.aiConnectionMissingTitle}</SectionLabel>
        <div>{copy.aiConnectionMissingDetail}</div>
        <Button className="h-auto px-2 py-1 text-xs" onClick={onOpenAiConnection} size="xs" type="button" variant="secondary">
          {copy.openAiConnection}
        </Button>
      </Section>
    )
  }

  const title = provisioning.state === 'unknown' ? copy.provisioningUnknownTitle : copy.provisioningIncompleteTitle

  const detail =
    provisioning.detail ??
    (provisioning.state === 'unknown' ? copy.provisioningUnknownDetail : copy.provisioningIncompleteDetail)

  return (
    <Section className="space-y-1 text-xs text-muted-foreground">
      <SectionLabel>{title}</SectionLabel>
      <div>{detail}</div>
    </Section>
  )
}

function Section({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('border-t border-border/50 px-3 py-2', className)}>{children}</div>
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">{children}</div>
  )
}
