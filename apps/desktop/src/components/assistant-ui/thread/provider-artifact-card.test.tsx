import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AssistantMessage } from './assistant-message'

const artifact = {
  content_type: 'application/zip',
  expires_at: 2_000_000_000,
  filename: 'report.zip',
  id: '0123456789abcdef0123456789abcdef',
  sha256: 'a'.repeat(64),
  size_bytes: 128
}
const owner = { connectionId: 'conn-1', profile: 'work' }

vi.mock('@assistant-ui/react', () => ({
  ActionBarPrimitive: { Reload: 'div' },
  BranchPickerPrimitive: { Root: 'div' },
  ErrorPrimitive: { Root: 'div', Message: 'div' },
  MessagePrimitive: { Root: 'div', Parts: 'div', Error: 'div' },
  useAuiState: (selector: (state: any) => unknown) => selector({
    message: { id: 'assistant-1', content: [], metadata: { custom: { providerArtifacts: [artifact] } } },
    thread: { messages: [] }
  }),
  useMessageRuntime: () => ({ getState: () => ({ content: [] }) })
}))

vi.mock('@/app/chat/session-view', () => ({ useSessionView: () => ({
  $runtimeId: { get: () => 'runtime-1' },
  $storedId: { get: () => 'session-1' },
  $storedOwner: { get: () => owner }
}) }))

vi.mock('@nanostores/react', () => ({ useStore: (atom: { get: () => unknown }) => atom.get() }))
vi.mock('@/lib/provider-artifacts', () => ({
  downloadProviderArtifact: vi.fn(async () => ({ saved: true }))
}))
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: {
  assistant: { thread: { dismissError: 'Dismiss', errorRetry: 'Retry', errorLayers: { generic: 'Error' } } },
  fileMenu: { download: 'Download', downloadFailed: 'Download failed', downloadSaved: 'Saved' },
  preview: { openPreview: 'Open preview', unavailable: 'Unavailable', opening: 'Opening', hide: 'Hide' },
  time: { justNow: 'now' }
} }) }))
vi.mock('@/store/session', () => ({ $connection: { get: () => ({ connectionId: 'conn-1', profile: 'work' }) }, $currentModel: { get: () => '' } }))
vi.mock('@/store/preview', () => ({ $previewTabSources: { get: () => [] } }))
vi.mock('@/store/artifacts', () => ({ $artifactRegistry: { get: () => [] } }))
vi.mock('@/store/notifications', () => ({ notifyError: vi.fn() }))
vi.mock('@/store/send-diagnostics', () => ({ requestSendDiagnostics: vi.fn() }))
vi.mock('@/lib/haptics', () => ({ triggerHaptic: vi.fn() }))
vi.mock('@/lib/spoken-reply', () => ({ markAssistantIdSpoken: vi.fn() }))
vi.mock('@/lib/voice-playback', () => ({ playSpeechText: vi.fn(), stopVoicePlayback: vi.fn() }))
vi.mock('@/components/assistant-ui/thread/use-message-reactions', () => ({
  useMessageReactions: () => ({ canReact: false }), useTapbackDoubleClick: () => undefined
}))
vi.mock('@/components/assistant-ui/thread/changed-files-card', () => ({ ChangedFilesCard: () => null }))
vi.mock('@/components/assistant-ui/thread/status', () => ({ ResponseLoadingIndicator: () => null, TurnActivityIndicator: () => null }))
vi.mock('@/components/assistant-ui/thread/message-parts', () => ({ MESSAGE_PARTS_COMPONENTS: {} }))
vi.mock('@/components/assistant-ui/thread/message-reactions', () => ({ ReactionPicker: () => null }))
vi.mock('@/components/assistant-ui/thread/timeline-timestamp', () => ({ MessageTimelineTimestamp: () => null }))
vi.mock('@/components/assistant-ui/tooltip-icon-button', () => ({ TooltipIconButton: () => null }))
vi.mock('@/components/ui/copy-button', () => ({ CopyButton: () => null }))
vi.mock('react-router', () => ({ useInRouterContext: () => false, useNavigate: () => vi.fn() }))
vi.mock('@/lib/preview-targets', () => ({ extractPreviewTargets: () => [], pickPrimaryPreviewTarget: () => [] }))
vi.mock('@/components/assistant-ui/thread/user-message', () => ({ AGENT_MESSAGE_RE: /$^/ }))
vi.mock('@/components/assistant-ui/thread/content', () => ({
  contentHasVisibleText: () => false, messageContentText: () => '', pickPrimaryPreviewTarget: () => []
}))
vi.mock('@/lib/error-surface', () => ({ formatErrorDiagnostics: () => '', parseErrorSurface: () => null }))
vi.mock('@/store/billing-block', () => ({ clearBillingBlock: vi.fn(), runBillingRecovery: vi.fn(), setBillingBlock: vi.fn() }))
vi.mock('@/store/clarify', () => ({ clearClarifyRequest: vi.fn() }))
vi.mock('@/store/compaction', () => ({ setSessionCompacting: vi.fn() }))
vi.mock('@/store/prompts', () => ({ clearAllPrompts: vi.fn() }))
vi.mock('@/store/provider-wait', () => ({ providerWaitText: vi.fn(), setSessionProviderWait: vi.fn() }))
vi.mock('@/store/session', async importOriginal => ({ ...(await importOriginal<any>()), $currentModel: { get: () => '' } }))
vi.mock('@/store/subagents', () => ({ pruneFinishedSessionSubagents: vi.fn() }))
vi.mock('@/store/todos', () => ({ clearActiveSessionTodos: vi.fn() }))
vi.mock('@/lib/preview-targets', () => ({ extractPreviewTargets: () => [], pickPrimaryPreviewTarget: () => [] }))
vi.mock('@/components/assistant-ui/thread/assistant-footer', () => ({ AssistantFooter: () => null }))

afterEach(cleanup)

describe('provider artifact card', () => {
  it('shows an independent download card for an assistant message with no text', async () => {
    render(<AssistantMessage />)
    expect(screen.getByText('report.zip')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
  })
})
