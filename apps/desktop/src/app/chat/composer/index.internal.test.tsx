import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ChatBarState } from '@/app/chat/composer/types'
import { I18nProvider } from '@/i18n'
import type * as AppBrand from '@/lib/app-brand'
import { $gatewayState } from '@/store/session'

import type * as ComposerContrib from './contrib'

const popoutMock = vi.hoisted(() => ({
  poppedOut: true
}))

vi.mock('@assistant-ui/react', () => ({
  ComposerPrimitive: {
    Input: ({ children }: { children: ReactNode }) => <>{children}</>,
    Root: ({ children, ...props }: { children: ReactNode }) => <form {...props}>{children}</form>,
    Unstable_TriggerPopoverRoot: ({ children }: { children: ReactNode }) => <>{children}</>
  }
}))

vi.mock('@/app/chat/tour-marker', () => ({ useTourMarker: () => undefined }))
vi.mock('@/app/hud/composer-drag', () => ({ useHudComposerDrag: () => ({ grabbing: false, onPointerDown: vi.fn() }) }))
vi.mock('@/components/prompt-overlays', () => ({ PromptOverlays: () => null }))
vi.mock('@/contrib/react/slot', () => ({ Slot: () => null }))
vi.mock('@/lib/app-brand', async importOriginal => ({
  ...(await importOriginal<typeof AppBrand>()),
  appBrand: () => ({
    accent: '#ffdd00',
    accentForeground: '#322b29',
    displayName: 'Lemon AI',
    lockupSrc: '',
    markSrc: '',
    mode: 'internal-harness',
    primary: '#ffdd00',
    primaryForeground: '#322b29',
    ring: '#806b00',
    sidebarForeground: '#322b29',
    wordmark: 'Lemon AI'
  })
}))
vi.mock('@/themes', () => ({ useTheme: () => ({ availableThemes: [], themeName: 'default' }) }))

vi.mock('./attachments', () => ({ AttachmentList: () => null }))
vi.mock('./contrib', async importOriginal => ({
  ...(await importOriginal<typeof ComposerContrib>()),
  runComposerMiddleware: async (draft: unknown) => draft,
  useComposerAttachmentProviders: () => []
}))
vi.mock('./directive-actions', () => ({ ComposerDirectiveActions: () => null }))
vi.mock('./help-hint', () => ({ HelpHint: () => null }))
vi.mock('./hooks/use-at-completions', () => ({ useAtCompletions: () => ({ items: [], loading: false }) }))
vi.mock('./hooks/use-composer-branch', () => ({
  useComposerBranch: () => ({
    handleBranchOff: vi.fn(),
    handleConvertBranch: vi.fn(),
    handleListBranches: vi.fn(),
    handleSwitchBranch: vi.fn(),
    openInWorktree: vi.fn()
  })
}))
vi.mock('./hooks/use-composer-draft', () => ({
  useComposerDraft: () => ({
    activeQueueSessionKeyRef: { current: null },
    clearDraft: vi.fn(),
    draftRef: { current: 'Xin chào' },
    editorRef: { current: null },
    focusInput: vi.fn(),
    hasText: true,
    insertInlineRefs: vi.fn(),
    insertText: vi.fn(),
    isHelpHint: false,
    isSteerableText: true,
    loadIntoComposer: vi.fn(),
    requestMainFocus: vi.fn(),
    sessionIdRef: { current: null },
    setComposerText: vi.fn(),
    stashAt: vi.fn(),
    syncDraftFromEditor: vi.fn()
  })
}))
vi.mock('./hooks/use-composer-drop', () => ({
  useComposerDrop: () => ({
    dragActive: false,
    handleDragEnter: vi.fn(),
    handleDragLeave: vi.fn(),
    handleDragOver: vi.fn(),
    handleDrop: vi.fn(),
    handleInputDragOver: vi.fn(),
    handleInputDrop: vi.fn()
  })
}))
vi.mock('./hooks/use-composer-esc-cancel', () => ({ useComposerEscCancel: vi.fn() }))
vi.mock('./hooks/use-composer-metrics', () => ({
  useComposerMetrics: () => ({ compactPill: false, foldVoice: false, minimal: false, stacked: false, tight: false })
}))
vi.mock('./hooks/use-composer-placeholder', () => ({ useComposerPlaceholder: () => 'Message Lemon AI...' }))
vi.mock('./hooks/use-composer-popout', () => ({
  useComposerPopout: () => ({
    dockProximity: null,
    dragging: false,
    handleComposerToggle: vi.fn(),
    onComposerGesturePointerDown: vi.fn(),
    poppedOut: popoutMock.poppedOut,
    popoutAllowed: true,
    popoutPosition: { bottom: 24, right: 24 }
  })
}))
vi.mock('./hooks/use-composer-queue', () => ({
  useComposerQueue: () => ({
    beginQueuedEdit: vi.fn(),
    drainNextQueued: vi.fn(),
    editingQueuedPrompt: null,
    exitQueuedEdit: vi.fn(),
    queueCurrentDraft: vi.fn(),
    queueDraft: vi.fn(),
    queueEdit: null,
    queueParked: false,
    queuedPrompts: [],
    sendQueuedNow: vi.fn(),
    steerQueuedNow: vi.fn(),
    stepQueuedEdit: vi.fn()
  })
}))
vi.mock('./hooks/use-composer-trigger', () => ({
  triggerKeyUpHandler: () => vi.fn(),
  useComposerTrigger: () => ({
    argStageEmpty: true,
    ascendTriggerPath: vi.fn(),
    closeTrigger: vi.fn(),
    commitTypedSlashDirective: vi.fn(),
    moveTriggerActive: vi.fn(),
    refreshTrigger: vi.fn(),
    replaceTriggerWithChip: vi.fn(),
    setTriggerActive: vi.fn(),
    slashFreeTextArgStage: false,
    trigger: null,
    triggerActive: 0,
    triggerActiveExplicit: false,
    triggerItems: [],
    triggerKeyConsumedRef: { current: false },
    triggerLoading: false
  })
}))
vi.mock('./hooks/use-composer-undo', () => ({
  useComposerUndo: () => ({
    recordUndoPoint: vi.fn(),
    redo: vi.fn(),
    resetUndoHistory: vi.fn(),
    undo: vi.fn(),
    withUndoPoint: (fn: () => boolean) => fn()
  })
}))
vi.mock('./hooks/use-composer-url-dialog', () => ({
  useComposerUrlDialog: () => ({
    openUrlDialog: vi.fn(),
    setUrlOpen: vi.fn(),
    setUrlValue: vi.fn(),
    submitUrl: vi.fn(),
    urlInputRef: { current: null },
    urlOpen: false,
    urlValue: ''
  })
}))
vi.mock('./hooks/use-composer-voice', () => ({
  useComposerVoice: () => ({
    conversation: {
      active: false,
      level: 0,
      muted: false,
      status: 'idle',
      stopTurn: vi.fn(),
      toggleMute: vi.fn()
    },
    dictate: vi.fn(),
    endConversation: vi.fn(),
    handleToggleAutoSpeak: vi.fn(),
    startConversation: vi.fn(),
    voiceActivityState: { elapsedSeconds: 0, level: 0, status: 'idle' },
    voiceConversationActive: false,
    voiceStatus: 'idle'
  })
}))
vi.mock('./hooks/use-emoji-completions', () => ({ useEmojiCompletions: () => ({ items: [], loading: false }) }))
vi.mock('./hooks/use-micro-actions', () => ({ useComposerMicroActions: vi.fn() }))
vi.mock('./hooks/use-slash-completions', () => ({ useSlashCompletions: () => ({ items: [], loading: false }) }))
vi.mock('./hooks/use-status-presence', () => ({ useSessionStatusPresence: () => false }))
vi.mock('./micro-actions', () => ({ ActionBadges: () => null }))
vi.mock('./model-pill', () => ({ ModelPill: () => <span data-testid="model-pill">Mock Model</span> }))
vi.mock('./queue-panel', () => ({ QueuePanel: () => null }))
vi.mock('./rich-editor', () => ({
  RICH_INPUT_SLOT: 'composer-input',
  beginComposerComposition: vi.fn(),
  composerPlainText: (el: HTMLElement) => el.textContent ?? '',
  deleteChipBeforeCaret: () => false,
  deleteSelectionInEditor: () => false,
  insertComposerContentsAtCaret: vi.fn(),
  normalizeComposerEditorDom: vi.fn()
}))
vi.mock('./status-stack', () => ({ ComposerStatusStack: () => null }))
vi.mock('./status-stack/coding-row', () => ({ CodingStatusRow: () => null }))
vi.mock('./suggestion-pills', () => ({ SuggestionPills: () => null }))
vi.mock('./trigger-popover', () => ({ ComposerTriggerPopover: () => null }))
vi.mock('./url-dialog', () => ({ UrlDialog: () => null }))
vi.mock('./voice-activity', () => ({ VoiceActivity: () => null, VoicePlaybackActivity: () => null }))

const state: ChatBarState = {
  model: { canSwitch: true, model: 'gpt-test', provider: 'openai' },
  tools: { enabled: true, label: 'Add context' },
  voice: { active: false, enabled: true }
}

afterEach(() => {
  cleanup()
  $gatewayState.set('idle')
})

describe('ChatBar internal floating composer', () => {
  it('keeps internal controls when the composer is popped out', async () => {
    $gatewayState.set('open')
    popoutMock.poppedOut = true

    const { ChatBar } = await import('./index')

    render(
      <I18nProvider configClient={null} initialLocale="vi">
        <ChatBar
          busy={false}
          disabled={false}
          onCancel={vi.fn()}
          onSubmit={vi.fn()}
          state={state}
        />
      </I18nProvider>
    )

    expect(screen.getByRole('button', { name: 'Đính kèm' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gửi' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Giọng nói' })).toBeTruthy()
    expect(screen.queryByTestId('model-pill')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add context' })).toBeNull()
  })
})
