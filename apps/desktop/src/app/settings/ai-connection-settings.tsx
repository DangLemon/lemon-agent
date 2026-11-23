import { useStore } from '@nanostores/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { RowButton } from '@/components/ui/row-button'
import { type Translations, useI18n } from '@/i18n'
import {
  captureCapabilityScope,
  getCustomEndpoints,
  type ProfileScope,
  profileScopeKey,
  saveCustomEndpoint,
  validateCustomEndpoint
} from '@/lemon'
import { Check, Globe, Loader2, Plus, Save, Zap } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { $activeGatewayRoute, activeGatewayConnectionId } from '@/store/gateway'
import { $connection } from '@/store/session'
import { $settingsRequestProfile } from '@/store/settings-scope'
import type { CustomEndpoint, CustomEndpointUpdate, CustomEndpointValidationResponse } from '@/types/lemon'

import { Pill, SettingsContent, SettingsSkeleton } from './primitives'
import { SettingsProfileScope } from './profile-scope'

interface AiConnectionSettingsProps {
  onConfigSaved?: () => void
  onMainModelChanged?: (provider: string, model: string) => void
}

interface EndpointForm {
  apiKey: string
  baseUrl: string
  email: string
  id: string
  model: string
  name: string
  password: string
}

type FeedbackKind = 'error' | 'success' | 'warning'

type Feedback = null | {
  kind: FeedbackKind
  message: string
}

const EMPTY_FORM: EndpointForm = {
  apiKey: '',
  baseUrl: '',
  email: '',
  id: '',
  model: '',
  name: '',
  password: ''
}

function formFromEndpoint(endpoint: CustomEndpoint): EndpointForm {
  return {
    email: endpoint.login_username ?? '',
    apiKey: '',
    baseUrl: endpoint.base_url,
    id: endpoint.id,
    model: endpoint.model,
    name: endpoint.name,
    password: ''
  }
}

function formToPayload(form: EndpointForm, models?: string[]): CustomEndpointUpdate {
  const email = form.email.trim()

  return {
    base_url: form.baseUrl.trim(),
    discover_models: true,
    id: form.id.trim() || undefined,
    make_default: true,
    model: form.model.trim(),
    name: form.name.trim(),
    ...(email ? { login_username: email } : {}),
    ...(models?.length ? { models } : {}),
    ...(form.apiKey.trim() ? { api_key: form.apiKey.trim() } : {})
  }
}

function savePayload(form: EndpointForm, models?: string[]): CustomEndpointUpdate {
  const payload = formToPayload(form, models)
  const password = form.password

  if (!password.trim()) {
    return payload
  }

  return { ...payload, login_password: password }
}

function hasUsableUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim())

    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

type AiConnectionCopy = Translations['settings']['aiConnection']

// Preflight for the server rules in gateway_login_url. The API still refuses
// the password when this check is skipped.
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')) {
    return true
  }

  const parts = host.split('.')

  if (parts.length !== 4 || parts[0] !== '127') {
    return false
  }

  return parts.every(part => /^\d+$/.test(part) && Number(part) <= 255)
}

function passwordDraftError(baseUrl: string, email: string, password: string, copy: AiConnectionCopy): string | null {
  if (!password.trim()) {
    return null
  }

  if (!email.trim()) {
    return copy.loginAccountRequired
  }

  const problem = loginTargetProblem(baseUrl)

  if (problem === 'https') {
    return copy.loginNeedsHttps
  }

  if (problem === 'base') {
    return copy.loginBadBase
  }

  return null
}

function loginTargetProblem(baseUrl: string): 'base' | 'https' | null {
  let parsed: URL

  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    return 'base'
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'base'
  }

  const path = parsed.pathname.replace(/\/+$/, '')

  if (path && !path.endsWith('/v1')) {
    return 'base'
  }

  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    return 'https'
  }

  return null
}

function sessionExpiry(
  expiresAt: string | undefined,
  now = Date.now()
): { expired: boolean; unknown: boolean; until: string | null } {
  if (!expiresAt) {
    return { expired: false, unknown: false, until: null }
  }

  if (expiresAt === 'unknown') {
    return { expired: false, unknown: true, until: null }
  }

  const at = Date.parse(expiresAt)

  if (Number.isNaN(at)) {
    return { expired: false, unknown: true, until: null }
  }

  if (at <= now) {
    return { expired: true, unknown: false, until: null }
  }

  return { expired: false, unknown: false, until: new Date(at).toISOString().slice(0, 10) }
}

function saveErrorMessage(error: unknown, hadPassword: boolean, copy: AiConnectionCopy): string {
  const text = error instanceof Error ? error.message : ''

  if (!hadPassword) {
    return copy.saveFailed
  }

  if (text.includes('sign_in_https_required')) {
    return copy.loginNeedsHttps
  }

  if (text.includes('sign_in_bad_base')) {
    return copy.loginBadBase
  }

  if (text.includes('sign_in_rejected') || /^(401|403)\b/.test(text)) {
    return copy.loginFailed
  }

  if (text.includes('sign_in_unreachable')) {
    return copy.loginUnreachable
  }

  return copy.saveFailed
}

function feedbackClass(kind: FeedbackKind) {
  if (kind === 'success') {
    return 'border-primary/20 bg-primary/10 text-(--ui-text-primary)'
  }

  if (kind === 'warning') {
    return 'border-(--ui-stroke-secondary) bg-(--ui-bg-tertiary) text-(--ui-text-secondary)'
  }

  return 'border-destructive/20 bg-destructive/10 text-destructive'
}

function captureActiveScope(fallbackProfile: string, fallbackConnectionId?: string): ProfileScope {
  const profile = $settingsRequestProfile.get()
  const connectionId = $connection.get()?.connectionId ?? activeGatewayConnectionId() ?? fallbackConnectionId

  if (profile) {
    return captureCapabilityScope(profile)
  }

  return captureCapabilityScope({
    ...(connectionId ? { connectionId } : {}),
    profile: $activeGatewayRoute.get() || fallbackProfile
  })
}

function currentScopeKey(fallbackProfile: string, fallbackConnectionId?: string): string {
  return profileScopeKey(captureActiveScope(fallbackProfile, fallbackConnectionId))
}

export function AiConnectionSettings({ onConfigSaved, onMainModelChanged }: AiConnectionSettingsProps) {
  const { t } = useI18n()
  const copy = t.settings.aiConnection
  const requestProfile = useStore($settingsRequestProfile)
  const activeRoute = useStore($activeGatewayRoute)
  const activeConnection = useStore($connection)
  const activeConnectionId = activeConnection?.connectionId ?? activeGatewayConnectionId() ?? undefined

  const ambientScope = useMemo<ProfileScope>(
    () =>
      requestProfile ?? {
        ...(activeConnectionId ? { connectionId: activeConnectionId } : {}),
        profile: activeRoute
      },
    [activeConnectionId, activeRoute, requestProfile]
  )

  const capturedScope = useMemo(() => captureCapabilityScope(ambientScope), [ambientScope])
  const scopeKey = profileScopeKey(capturedScope)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [endpoints, setEndpoints] = useState<CustomEndpoint[]>([])
  const [form, setForm] = useState<EndpointForm>(EMPTY_FORM)
  const [selectedId, setSelectedId] = useState('')
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [feedback, setFeedback] = useState<Feedback>(null)
  const discoveredModelsBaseUrlRef = useRef('')
  const requestIdRef = useRef(0)

  const applyEndpoint = useCallback((endpoint: CustomEndpoint | null) => {
    setFeedback(null)
    setTesting(false)

    if (!endpoint) {
      setForm(EMPTY_FORM)
      setSelectedId('')
      setDiscoveredModels([])
      discoveredModelsBaseUrlRef.current = ''

      return
    }

    setForm(formFromEndpoint(endpoint))
    setSelectedId(endpoint.id)
    setDiscoveredModels(endpoint.models)
    discoveredModelsBaseUrlRef.current = endpoint.base_url.trim()
  }, [])

  const resetToEndpoint = useCallback(
    (endpoint: CustomEndpoint | null) => {
      requestIdRef.current += 1
      applyEndpoint(endpoint)
    },
    [applyEndpoint]
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      const loadScopeKey = scopeKey
      setLoading(true)
      setSaving(false)
      setTesting(false)
      setFeedback(null)
      setEndpoints([])
      setForm(EMPTY_FORM)
      setSelectedId('')
      setDiscoveredModels([])

      try {
        const data = await getCustomEndpoints(capturedScope)

        if (cancelled || currentScopeKey(activeRoute, activeConnectionId) !== loadScopeKey) {
          return
        }

        setEndpoints(data.endpoints)
        applyEndpoint(data.endpoints.find(endpoint => endpoint.is_current) ?? data.endpoints[0] ?? null)
      } catch {
        if (!cancelled && currentScopeKey(activeRoute, activeConnectionId) === loadScopeKey) {
          setFeedback({ kind: 'error', message: copy.loadFailed })
        }
      } finally {
        if (!cancelled && currentScopeKey(activeRoute, activeConnectionId) === loadScopeKey) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [activeConnectionId, activeRoute, applyEndpoint, capturedScope, copy.loadFailed, scopeKey])

  const updateForm = useCallback((patch: Partial<EndpointForm>) => {
    requestIdRef.current += 1
    setTesting(false)
    setFeedback(null)

    if (Object.prototype.hasOwnProperty.call(patch, 'baseUrl')) {
      setDiscoveredModels([])
      discoveredModelsBaseUrlRef.current = ''
    }

    setForm(current => ({ ...current, ...patch }))
  }, [])

  const startNew = useCallback(() => {
    resetToEndpoint(null)
  }, [resetToEndpoint])

  const cancelChanges = useCallback(() => {
    const selected = endpoints.find(endpoint => endpoint.id === selectedId) ?? endpoints.find(endpoint => endpoint.is_current) ?? null
    resetToEndpoint(selected)
  }, [endpoints, resetToEndpoint, selectedId])

  const urlInvalid = form.baseUrl.trim().length > 0 && !hasUsableUrl(form.baseUrl)
  const urlHelpId = 'ai-connection-url-help'
  const urlErrorId = 'ai-connection-url-error'

  const canSignInWithoutModel = form.email.trim().length > 0 && form.password.trim().length > 0
  const canSave =
    form.name.trim().length > 0 && form.baseUrl.trim().length > 0 && !urlInvalid && (form.model.trim().length > 0 || canSignInWithoutModel)

  const canValidate = form.baseUrl.trim().length > 0 && !urlInvalid
  const allModelOptions = Array.from(new Set([...discoveredModels, form.model].filter(Boolean)))
  const controlsLocked = saving

  async function handleValidate() {
    if (!canValidate) {
      setFeedback({ kind: 'error', message: copy.invalidUrl })

      return
    }

    const draftError = passwordDraftError(form.baseUrl, form.email, form.password, copy)

    if (draftError) {
      setFeedback({ kind: 'error', message: draftError })

      return
    }

    const requestId = ++requestIdRef.current
    const submittedScopeKey = scopeKey
    setTesting(true)
    setFeedback(null)

    try {
      const response: CustomEndpointValidationResponse = await validateCustomEndpoint(savePayload(form), capturedScope)

      if (requestId !== requestIdRef.current || currentScopeKey(activeRoute, activeConnectionId) !== submittedScopeKey) {
        return
      }

      if (response.ok) {
        setDiscoveredModels(response.models)
        discoveredModelsBaseUrlRef.current = form.baseUrl.trim()

        if (response.models.length > 0 && !form.model.trim()) {
          setForm(current => (current.model.trim() ? current : { ...current, model: response.models[0] }))
        }

        setFeedback({
          kind: 'success',
          message: response.models.length ? copy.validationModels(response.models.length) : copy.validationReachable
        })
      } else {
        setFeedback({ kind: response.reachable ? 'warning' : 'error', message: copy.validationFailed })
      }
    } catch {
      if (requestId === requestIdRef.current && currentScopeKey(activeRoute, activeConnectionId) === submittedScopeKey) {
        setFeedback({ kind: 'error', message: copy.validationFailed })
      }
    } finally {
      if (requestId === requestIdRef.current && currentScopeKey(activeRoute, activeConnectionId) === submittedScopeKey) {
        setTesting(false)
      }
    }
  }

  async function handleSave() {
    if (!canSave) {
      setFeedback({ kind: 'error', message: hasUsableUrl(form.baseUrl) ? copy.requiredFields : copy.invalidUrl })

      return
    }

    const draftError = passwordDraftError(form.baseUrl, form.email, form.password, copy)

    if (draftError) {
      setFeedback({ kind: 'error', message: draftError })

      return
    }

    const requestId = ++requestIdRef.current
    const submittedScopeKey = scopeKey
    setSaving(true)
    setFeedback(null)

    try {
      const modelsForServer = discoveredModelsBaseUrlRef.current === form.baseUrl.trim() ? discoveredModels : undefined
      const response = await saveCustomEndpoint(savePayload(form, modelsForServer), capturedScope)

      if (requestId !== requestIdRef.current || currentScopeKey(activeRoute, activeConnectionId) !== submittedScopeKey) {
        return
      }

      setEndpoints(response.endpoints)
      const saved = response.endpoints.find(endpoint => endpoint.id === response.id) ?? response.endpoints.find(endpoint => endpoint.is_current)

      if (saved) {
        setForm(formFromEndpoint(saved))
        setSelectedId(saved.id)
        setDiscoveredModels(saved.models)
        discoveredModelsBaseUrlRef.current = saved.base_url.trim()
        onMainModelChanged?.(saved.id, saved.model)
      }

      onConfigSaved?.()
      setFeedback({ kind: 'success', message: copy.saved })
    } catch (error) {
      if (requestId === requestIdRef.current && currentScopeKey(activeRoute, activeConnectionId) === submittedScopeKey) {
        setFeedback({ kind: 'error', message: saveErrorMessage(error, Boolean(form.password.trim()), copy) })
      }
    } finally {
      if (requestId === requestIdRef.current && currentScopeKey(activeRoute, activeConnectionId) === submittedScopeKey) {
        setSaving(false)
      }
    }
  }

  const editingExpiry = sessionExpiry(endpoints.find(endpoint => endpoint.id === form.id)?.login_expires_at)

  if (loading) {
    return <SettingsSkeleton sections={[{ heading: true, rows: 4 }]} />
  }

  return (
    <SettingsContent>
      <div className="mx-auto grid max-w-[35rem] gap-5 py-2">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Globe className="size-4 text-(--ui-text-tertiary)" />
              <h2 className="text-[length:var(--conversation-title-font-size)] font-semibold text-(--ui-text-primary)">
                {copy.title}
              </h2>
            </div>
            <Button disabled={controlsLocked} onClick={startNew} size="sm" type="button" variant="secondary">
              <Plus />
              {copy.addConnection}
            </Button>
          </div>
          <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
            {copy.intro}
          </p>
        </div>

        <SettingsProfileScope />

        {endpoints.length > 0 && (
          <section className="grid gap-2">
            <h3 className="text-[length:var(--conversation-text-font-size)] font-medium text-(--ui-text-primary)">
              {copy.savedConnections}
            </h3>
            <div className="grid gap-1">
              {endpoints.map(endpoint => {
                const expiry = sessionExpiry(endpoint.login_expires_at)

                return (
                  <RowButton
                    aria-pressed={selectedId === endpoint.id}
                    className={cn(
                      'grid gap-1 rounded-[6px] px-3 py-2 text-left transition hover:bg-(--chrome-action-hover)',
                      selectedId === endpoint.id && 'bg-(--ui-bg-tertiary)'
                    )}
                    disabled={controlsLocked}
                    key={endpoint.id}
                    onClick={() => resetToEndpoint(endpoint)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 truncate text-[length:var(--conversation-text-font-size)] font-medium text-(--ui-text-primary)">
                        {endpoint.name}
                      </span>
                      {endpoint.is_current && (
                        <Pill className="text-(--ui-text-primary)" tone="primary">
                          <Check className="size-3" />
                          {copy.currentBadge}
                        </Pill>
                      )}
                      {selectedId === endpoint.id && (
                        <span className="text-[0.65rem] text-(--ui-text-secondary)">{copy.selectedForEditing}</span>
                      )}
                    </span>
                    <span className="truncate text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                      {endpoint.base_url}
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-1 text-[length:var(--conversation-caption-font-size)] text-(--ui-text-tertiary)">
                      <span>{endpoint.model}</span>
                      {endpoint.login_username ? <span>{endpoint.login_username}</span> : null}
                      {endpoint.has_api_key && !expiry.expired && !expiry.unknown ? <span>{copy.savedKey}</span> : null}
                      {expiry.expired ? <span>{copy.sessionExpired}</span> : null}
                      {expiry.unknown ? <span>{copy.sessionUnknown}</span> : null}
                      {expiry.until ? <span>{copy.sessionUntil(expiry.until)}</span> : null}
                    </span>
                  </RowButton>
                )
              })}
            </div>
          </section>
        )}

        <section aria-labelledby="ai-connection-form-title" className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[length:var(--conversation-text-font-size)] font-medium text-(--ui-text-primary)" id="ai-connection-form-title">
              {form.id ? copy.editTitle : copy.newTitle}
            </h3>
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1.5 text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
              {copy.nameLabel}
              <Input
                aria-label={copy.nameLabel}
                disabled={controlsLocked}
                onChange={event => updateForm({ name: event.target.value })}
                placeholder={copy.namePlaceholder}
                value={form.name}
              />
            </label>

            <label className="grid gap-1.5 text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
              {copy.urlLabel}
              <Input
                aria-describedby={urlInvalid ? `${urlHelpId} ${urlErrorId}` : urlHelpId}
                aria-invalid={urlInvalid || undefined}
                aria-label={copy.urlLabel}
                disabled={controlsLocked}
                inputMode="url"
                onChange={event => updateForm({ baseUrl: event.target.value })}
                placeholder="https://ai.example.com/v1"
                value={form.baseUrl}
              />
              <span
                className="text-[length:var(--conversation-caption-font-size)] font-normal leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)"
                id={urlHelpId}
              >
                {copy.urlHelp}
              </span>
              {urlInvalid && (
                <span
                  className="text-[length:var(--conversation-caption-font-size)] font-normal leading-(--conversation-caption-line-height) text-destructive"
                  id={urlErrorId}
                >
                  {copy.invalidUrl}
                </span>
              )}
            </label>

            <label className="grid gap-1.5 text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
              {copy.keyLabel}
              <Input
                aria-label={copy.keyAriaLabel}
                disabled={controlsLocked}
                onChange={event => updateForm({ apiKey: event.target.value })}
                placeholder={form.id ? copy.keyExistingPlaceholder : copy.keyNewPlaceholder}
                type="password"
                value={form.apiKey}
              />
              <span className="text-[length:var(--conversation-caption-font-size)] font-normal leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                {form.id ? copy.keyExistingHelp : copy.keyNewHelp}
              </span>
            </label>

            <label className="grid gap-1.5 text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
              {copy.accountLabel}
              <Input
                aria-label={copy.accountAriaLabel}
                autoComplete="username"
                disabled={controlsLocked}
                inputMode="email"
                onChange={event => updateForm({ email: event.target.value })}
                placeholder={copy.accountPlaceholder}
                type="email"
                value={form.email}
              />
            </label>

            <label className="grid gap-1.5 text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
              {copy.passwordLabel}
              <Input
                aria-describedby="ai-connection-login-help"
                aria-label={copy.passwordAriaLabel}
                autoComplete="current-password"
                disabled={controlsLocked}
                onChange={event => updateForm({ password: event.target.value })}
                placeholder={copy.passwordPlaceholder}
                type="password"
                value={form.password}
              />
              <span
                className="text-[length:var(--conversation-caption-font-size)] font-normal leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)"
                id="ai-connection-login-help"
              >
                {copy.loginHelp}
              </span>
              {editingExpiry.expired || editingExpiry.unknown ? (
                <span className="text-[length:var(--conversation-caption-font-size)] font-normal leading-(--conversation-caption-line-height) text-destructive">
                  {editingExpiry.expired ? copy.sessionExpired : copy.sessionUnknown}
                </span>
              ) : null}
            </label>

            <label className="grid gap-1.5 text-[length:var(--conversation-caption-font-size)] font-medium text-(--ui-text-secondary)">
              {copy.modelLabel}
              <Input
                aria-label={copy.modelLabel}
                disabled={controlsLocked}
                list="ai-connection-models"
                onChange={event => updateForm({ model: event.target.value })}
                placeholder={copy.modelPlaceholder}
                value={form.model}
              />
              <datalist id="ai-connection-models">
                {allModelOptions.map(model => (
                  <option key={model} value={model} />
                ))}
              </datalist>
              {discoveredModels.length > 0 ? (
                <div aria-label={copy.validationModels(discoveredModels.length)} className="grid gap-1" role="listbox">
                  {discoveredModels.map(model => (
                    <button
                      aria-selected={form.model === model}
                      className={cn(
                        'rounded-[6px] border px-3 py-2 text-left text-[length:var(--conversation-caption-font-size)]',
                        form.model === model
                          ? 'border-primary/40 bg-primary/10 text-(--ui-text-primary)'
                          : 'border-(--ui-stroke-secondary) bg-transparent text-(--ui-text-secondary)'
                      )}
                      disabled={controlsLocked}
                      key={model}
                      onClick={() => setForm(current => ({ ...current, model }))}
                      role="option"
                      type="button"
                    >
                      {model}
                    </button>
                  ))}
                </div>
              ) : null}
              <span className="text-[length:var(--conversation-caption-font-size)] font-normal leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                {copy.modelHelp}
              </span>
            </label>
          </div>

          {feedback && (
            <p
              className={cn(
                'rounded-[6px] border px-3 py-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height)',
                feedbackClass(feedback.kind)
              )}
              role="status"
            >
              {feedback.message}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button disabled={saving || !canSave} onClick={() => void handleSave()} type="button">
              {saving ? <Loader2 className="animate-spin" /> : <Save />}
              {copy.saveAndUse}
            </Button>
            <Button disabled={saving || testing || !canValidate} onClick={() => void handleValidate()} type="button" variant="secondary">
              {testing ? <Loader2 className="animate-spin" /> : <Zap />}
              {copy.testConnection}
            </Button>
            <Button disabled={saving} onClick={cancelChanges} type="button" variant="text">
              {copy.cancelChanges}
            </Button>
          </div>

          <p className="text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
            {copy.saveScope}
          </p>
        </section>
      </div>
    </SettingsContent>
  )
}
