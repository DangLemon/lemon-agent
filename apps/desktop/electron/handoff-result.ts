/**
 * Consume the detached update hand-off's result file (#82328 follow-up).
 *
 * scripts/desktop-update/windows.ps1 runs hidden/detached — the user never sees its
 * console. It writes LEMON_HOME/.lemon-ai-update-result.json on every exit
 * path; the relaunched Desktop reads it exactly once on boot and surfaces
 * failures (a silent failed update looks identical to "nothing happened",
 * which is how the 2026-08-09 'closed the app then nothing' report was
 * born). Read-and-delete so a result is reported at most once; ordinary
 * results older than the freshness window are discarded unread (a stale
 * file from a crashed relaunch chain must not resurface days later).
 *
 * manual:true results are exempt from the freshness window. They are the
 * durable action-required channel — on a browserless Linux box with no
 * working notifier, the boot dialog is the FIRST and ONLY place the message
 * ever surfaces, and the user may not reopen Lemon AI within 30 minutes.
 * Dropping it as stale strands exactly the machine it exists to serve. It is
 * still consumed once (the file is unlinked before any age check), so it
 * cannot resurface on a later boot.
 */

import fs from 'fs'
import path from 'path'

export const HANDOFF_RESULT_MAX_AGE_MS = 30 * 60 * 1000
export const LEMON_HANDOFF_RESULT_NAME = '.lemon-ai-update-result.json'

export interface HandoffResult {
  ok: boolean
  exitCode: number
  /** Update succeeded but the user must act (reopen the app, reinstall the
   * GUI package, fix the sandbox helper). The consumer must SURFACE these —
   * an ok:true manual result that only gets logged never reaches the user
   * on exactly the machines where no shim/notifier could show it live. */
  manual: boolean
  message: string
  branch: string
}

function uniqueNames(names: Array<string | null | undefined>) {
  return Array.from(new Set(names.filter((name): name is string => typeof name === 'string' && name.length > 0)))
}

export function handoffResultPath(
  lemonHome: string,
  { resultName = LEMON_HANDOFF_RESULT_NAME }: { resultName?: string } = {}
): string {
  return path.join(lemonHome, resultName)
}

function handoffResultCandidatePaths(
  lemonHome: string,
  {
    resultName = LEMON_HANDOFF_RESULT_NAME,
    legacyResultNames = []
  }: { resultName?: string; legacyResultNames?: string[] } = {}
) {
  return uniqueNames([resultName, ...legacyResultNames]).map(name => handoffResultPath(lemonHome, { resultName: name }))
}

export function readAndConsumeHandoffResult(
  lemonHome: string,
  {
    now = Date.now,
    maxAgeMs = HANDOFF_RESULT_MAX_AGE_MS,
    resultName = LEMON_HANDOFF_RESULT_NAME,
    legacyResultNames = []
  }: { now?: () => number; maxAgeMs?: number; resultName?: string; legacyResultNames?: string[] } = {}
): HandoffResult | null {
  for (const file of handoffResultCandidatePaths(lemonHome, { resultName, legacyResultNames })) {
    let raw: string

    try {
      raw = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }

    // Consume unconditionally — even a malformed/stale file must not be
    // re-reported on every subsequent boot.
    try {
      fs.unlinkSync(file)
    } catch {
      // Best-effort; a locked file just gets consumed on the next boot.
    }

    let parsed: any

    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }

    const manual = Boolean(parsed?.manual)
    const finishedAt = Number(parsed?.finished_at)

    if (!Number.isFinite(finishedAt)) {
      return null
    }

    // Ordinary results expire; a manual (action-required) result never does —
    // it's the last-resort surface for machines with no live channel, so the
    // user must see it whenever they next reopen, not only within the window.
    if (!manual && now() - finishedAt * 1000 > maxAgeMs) {
      return null
    }

    return {
      ok: Boolean(parsed?.ok),
      exitCode: Number.isFinite(Number(parsed?.exit_code)) ? Number(parsed.exit_code) : 1,
      manual,
      message: typeof parsed?.message === 'string' ? parsed.message : '',
      branch: typeof parsed?.branch === 'string' ? parsed.branch : ''
    }
  }

  return null
}
