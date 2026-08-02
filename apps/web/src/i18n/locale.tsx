import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { IntlProvider } from 'use-intl'
import { type AppLocale, messages } from './messages.js'

// The pre-auth screens must honour the language toggle before a user's
// preferred_language exists (ADR-0005, ui-flow: bilingual direction-aware pre-auth),
// so the SPA carries its own locale state rather than reading a preference. Hebrew is
// right-to-left and English left-to-right; the toggle switches both the strings and the
// document direction together.
//
// The choice is persisted so it survives a reload — a user who picks Hebrew on login
// keeps it into the app, standing in until a signed-in user's saved preference could
// drive it in a later feature.
const LOCALE_KEY = 'burgers.locale'

function directionFor(locale: AppLocale): 'rtl' | 'ltr' {
  return locale === 'he' ? 'rtl' : 'ltr'
}

function initialLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(LOCALE_KEY)
    if (stored === 'he' || stored === 'en') {
      return stored
    }
  } catch {
    // Fall through to the language-based default.
  }
  if (typeof navigator !== 'undefined' && navigator.language.startsWith('he')) {
    return 'he'
  }
  return 'en'
}

interface LocaleContextValue {
  locale: AppLocale
  direction: 'rtl' | 'ltr'
  setLocale(locale: AppLocale): void
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(initialLocale)

  // Keep the document's direction and language in step with the active locale so
  // Tailwind's logical properties flip and assistive tech announces the right language.
  useEffect(() => {
    document.documentElement.lang = locale
    document.documentElement.dir = directionFor(locale)
  }, [locale])

  const setLocale = useCallback((next: AppLocale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(LOCALE_KEY, next)
    } catch {
      // A non-persistable locale still applies for this run.
    }
  }, [])

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, direction: directionFor(locale), setLocale }),
    [locale, setLocale],
  )

  return (
    <LocaleContext.Provider value={value}>
      <IntlProvider locale={locale} messages={messages[locale]}>
        {children}
      </IntlProvider>
    </LocaleContext.Provider>
  )
}

// The toggle and any layout that needs the current direction read it here; translation
// strings themselves come from use-intl's useTranslations.
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider')
  }
  return ctx
}
