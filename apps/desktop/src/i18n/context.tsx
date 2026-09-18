import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import {
  captureCapabilityScope,
  getLemonConfigRecord,
  getLemonRawConfig,
  type LemonConfigRecord,
  type ProfileScope,
  saveLemonConfig
} from '@/lemon'
import { type AppBrand, appBrandForEnv, brandTranslationTree } from '@/lib/app-brand'
import type { LemonRawConfigResponse } from '@/types/lemon'

import { TRANSLATIONS } from './catalog'
import {
  DEFAULT_LOCALE,
  INTERNAL_WORKSPACE_DEFAULT_LOCALE,
  isSupportedLocaleValue,
  localeConfigValue,
  normalizeLocale,
  normalizeLocaleWithDefault
} from './languages'
import { setRuntimeI18nLocale } from './runtime'
import type { Locale, Translations } from './types'

export { LOCALE_META } from './languages'

export interface I18nConfigClient {
  getConfig: (scope?: ProfileScope) => Promise<LemonConfigRecord>
  getRawConfig?: (scope?: ProfileScope) => Promise<LemonRawConfigResponse>
  saveConfig: (config: LemonConfigRecord) => Promise<{ ok: boolean }>
}

const defaultConfigClient: I18nConfigClient = {
  getConfig: scope => {
    if (typeof window === 'undefined' || !window.lemonDesktop?.api) {
      return Promise.resolve({})
    }

    return getLemonConfigRecord(scope)
  },
  getRawConfig: scope => {
    if (typeof window === 'undefined' || !window.lemonDesktop?.api) {
      return Promise.resolve({ explicit_display_language: false, path: '', yaml: '' })
    }

    return getLemonRawConfig(scope)
  },
  saveConfig: config => {
    if (typeof window === 'undefined' || !window.lemonDesktop?.api) {
      return Promise.resolve({ ok: true })
    }

    return saveLemonConfig(config)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function translationsForBrand(translations: Translations, brand: AppBrand = appBrandForEnv()): Translations {
  return brandTranslationTree(translations, brand)
}

export function getConfigDisplayLanguage(config: LemonConfigRecord): unknown {
  return isRecord(config.display) ? config.display.language : undefined
}

export function withConfigDisplayLanguage(config: LemonConfigRecord, locale: Locale): LemonConfigRecord {
  const display = isRecord(config.display) ? config.display : {}

  return {
    ...config,
    display: {
      ...display,
      language: localeConfigValue(locale)
    }
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

const RTL_LOCALES = new Set<Locale>(['ar'])

function applyDocumentLocale(locale: Locale) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.lang = locale
  document.documentElement.dir = RTL_LOCALES.has(locale) ? 'rtl' : 'ltr'
}

function defaultLocaleForWorkspace(): Locale {
  return appBrandForEnv().mode === 'internal-harness' ? INTERNAL_WORKSPACE_DEFAULT_LOCALE : DEFAULT_LOCALE
}

function isInternalWorkspace(): boolean {
  return appBrandForEnv().mode === 'internal-harness'
}

function resolveConfiguredLocale(value: unknown): Locale {
  if (isSupportedLocaleValue(value)) {
    return normalizeLocale(value)
  }

  return defaultLocaleForWorkspace()
}

function resolveLoadedLocale(config: LemonConfigRecord, rawConfig?: LemonRawConfigResponse): Locale {
  const configuredLanguage = getConfigDisplayLanguage(config)

  if (isInternalWorkspace() && rawConfig?.explicit_display_language === false) {
    return INTERNAL_WORKSPACE_DEFAULT_LOCALE
  }

  return resolveConfiguredLocale(configuredLanguage)
}

export interface I18nContextValue {
  configLoadError: Error | null
  isLoadingConfig: boolean
  isSavingLocale: boolean
  locale: Locale
  saveError: Error | null
  setLocale: (next: Locale) => Promise<void>
  t: Translations
}

const I18nContext = createContext<I18nContextValue>({
  configLoadError: null,
  isLoadingConfig: false,
  isSavingLocale: false,
  locale: DEFAULT_LOCALE,
  saveError: null,
  setLocale: async () => {},
  t: TRANSLATIONS[DEFAULT_LOCALE]
})

export interface I18nProviderProps {
  children: ReactNode
  configClient?: I18nConfigClient | null
  initialLocale?: unknown
}

export function I18nProvider({ children, configClient = defaultConfigClient, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    normalizeLocaleWithDefault(initialLocale, defaultLocaleForWorkspace())
  )

  const [isLoadingConfig, setIsLoadingConfig] = useState(false)
  const [isSavingLocale, setIsSavingLocale] = useState(false)
  const [configLoadError, setConfigLoadError] = useState<Error | null>(null)
  const [saveError, setSaveError] = useState<Error | null>(null)
  const localeRef = useRef(locale)

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    localeRef.current = locale
    setRuntimeI18nLocale(locale)
    applyDocumentLocale(locale)
  }, [locale])

  useEffect(() => {
    if (!configClient) {
      return
    }

    let cancelled = false

    setIsLoadingConfig(true)
    setConfigLoadError(null)

    const configScope = captureCapabilityScope()

    configClient
      .getConfig(configScope)
      .then(async config => {
        try {
          const rawConfig = await configClient.getRawConfig?.(configScope)

          if (!cancelled) {
            setLocaleState(resolveLoadedLocale(config, rawConfig))
          }
        } catch (error) {
          if (!cancelled) {
            setConfigLoadError(toError(error))
            setLocaleState(resolveConfiguredLocale(getConfigDisplayLanguage(config)))
          }
        }
      })
      .catch(error => {
        if (!cancelled) {
          setConfigLoadError(toError(error))
          setLocaleState(defaultLocaleForWorkspace())
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingConfig(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [configClient, initialLocale])

  const setLocale = useCallback(
    async (next: Locale) => {
      const previousLocale = localeRef.current

      setSaveError(null)
      setLocaleState(next)

      if (!configClient) {
        return
      }

      setIsSavingLocale(true)

      try {
        const latestConfig = await configClient.getConfig()
        const result = await configClient.saveConfig(withConfigDisplayLanguage(latestConfig, next))

        if (!result.ok) {
          throw new Error('Failed to save language')
        }
      } catch (error) {
        const nextError = toError(error)

        setLocaleState(previousLocale)
        setSaveError(nextError)

        throw nextError
      } finally {
        setIsSavingLocale(false)
      }
    },
    [configClient]
  )

  const t = useMemo(() => translationsForBrand(TRANSLATIONS[locale]), [locale])

  const value = useMemo<I18nContextValue>(
    () => ({
      configLoadError,
      isLoadingConfig,
      isSavingLocale,
      locale,
      saveError,
      setLocale,
      t
    }),
    [configLoadError, isLoadingConfig, isSavingLocale, locale, saveError, setLocale, t]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext)
}
