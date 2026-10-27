import { useState } from 'react'

import { useI18n } from '@/i18n'
import { downloadProviderArtifact } from '@/lib/provider-artifacts'
import type { ProviderArtifactDescriptor } from '@/types/lemon'
import type { SessionOwnerScope } from '@/store/session-request-router'

type ProviderArtifactCardProps = {
  artifact: ProviderArtifactDescriptor
  owner: SessionOwnerScope
  sessionId: string
}

export function ProviderArtifactCard({ artifact, owner, sessionId }: ProviderArtifactCardProps) {
  const { t } = useI18n()
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [unavailable, setUnavailable] = useState(false)

  async function download() {
    if (downloading || unavailable || !owner) {
      return
    }

    setDownloading(true)
    try {
      const result = await downloadProviderArtifact(artifact.id, sessionId, artifact.filename, owner)
      setDownloaded(Boolean(result.saved))
    } catch {
      setUnavailable(true)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="flex w-full max-w-160 items-center gap-2 rounded-lg border border-(--ui-stroke-tertiary) bg-card/55 px-2.5 py-1.5 text-sm"
      data-slot="provider-artifact-card"
    >
      <span className="min-w-0 flex-1 truncate text-[0.78rem] font-medium text-foreground/90">{artifact.filename}</span>
      <span className="text-[0.68rem] text-muted-foreground">{Math.ceil(artifact.size_bytes / 1024)} KB</span>
      <button
        aria-label={unavailable ? t.fileMenu.downloadFailed : t.fileMenu.download}
        className="rounded-md border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.7rem]"
        disabled={downloading || unavailable || !owner}
        onClick={() => void download()}
        type="button"
      >
        {unavailable ? t.fileMenu.downloadFailed : downloaded ? t.fileMenu.downloadSaved : t.fileMenu.download}
      </button>
    </div>
  )
}
