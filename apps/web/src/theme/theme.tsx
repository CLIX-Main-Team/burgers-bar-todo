import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// The light/dark theme provider (issue #101). It mirrors LocaleProvider exactly: the app
// owns one global preference in React state, stamps it as a single class on
// document.documentElement, and persists the choice so it survives a reload. Where the
// locale provider stamps dir/lang, this one stamps the `dark` class the token layer's
// @custom-variant and .dark block key off (tokens.md, theming architecture #68).
//
// Two deliberate decisions from #68 are enforced here rather than inferred:
//   - Default light. With no stored choice the app is light; the user opts into dark.
//   - No prefers-color-scheme detection. The theme is class-based and explicit, never
//     driven by the OS setting — a dark OS with no stored choice still opens light.
// A matching pre-paint inline script in index.html applies the stored class before first
// paint so a return visit does not flash the wrong theme; this provider is the source of
// truth once React has mounted and keeps that same key.
export const THEME_KEY = 'burgers.theme'

export type AppTheme = 'light' | 'dark'

function initialTheme(): AppTheme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
  } catch {
    // A non-readable storage falls through to the explicit light default.
  }
  // Default light, and deliberately no prefers-color-scheme read (#68).
  return 'light'
}

interface ThemeContextValue {
  theme: AppTheme
  setTheme(theme: AppTheme): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(initialTheme)

  // Keep the document root's `dark` class in step with the active theme so the token
  // layer's .dark overrides apply across the whole app the moment the choice changes.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next)
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // A non-persistable choice still applies for this run.
    }
  }, [])

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// The theme toggle (and any surface that needs the current theme) reads it here.
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
