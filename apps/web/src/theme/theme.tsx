import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// The light/dark theme provider (issue #101). It mirrors LocaleProvider exactly: the app
// owns one global preference in React state, stamps it as a single class on
// document.documentElement, and persists the choice so it survives a reload. Where the
// locale provider stamps dir/lang, this one stamps the `dark` class the token layer's
// @custom-variant and .dark block key off (tokens.md, theming architecture #68).
//
// Two deliberate decisions from #68 are enforced here rather than inferred:
//   - Default DARK as of 2026-08-27 (owner call), reversing #68's light default: the recut
//     palette was designed night-first and that is how the app should introduce itself.
//     The user opts into light; the stored choice still wins over the default either way.
//   - No prefers-color-scheme detection. The theme is class-based and explicit, never
//     driven by the OS setting — a light OS with no stored choice still opens dark.
// A matching pre-paint inline script in index.html applies the stored class before first
// paint so a return visit does not flash the wrong theme; this provider is the source of
// truth once React has mounted and keeps that same key.
export const THEME_KEY = 'burgers.theme'

// The browser/OS chrome tint (Android's address bar and task-switcher card, the PWA status
// bar). Round 8 (2026-08-14) opened BOTH shells on one brand-black chrome, on the reasoning
// that the phone header wore the rail's black in both themes. Round 14 (2026-08-27) ends
// that: the rail is white by day and cool charcoal by night, so a warm near-black bar above
// either one is a seam rather than a continuation. Each theme now names the surface actually
// under the bar — the day rail's white, the night canvas's charcoal.
// Literals rather than reads of the custom properties: this also runs before paint from
// index.html, where no stylesheet has resolved yet — so the value is duplicated there and in
// the manifest, and all move together.
export const THEME_COLOR_LIGHT = '#FFFFFF'
export const THEME_COLOR_DARK = '#0C0E11'

export type AppTheme = 'light' | 'dark'

function initialTheme(): AppTheme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
  } catch {
    // A non-readable storage falls through to the explicit dark default.
  }
  // Default dark (2026-08-27), and deliberately still no prefers-color-scheme read (#68).
  return 'dark'
}

interface ThemeContextValue {
  theme: AppTheme
  setTheme(theme: AppTheme): void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(initialTheme)

  // Keep the document root's `dark` class in step with the active theme so the token
  // layer's .dark overrides apply across the whole app the moment the choice changes, and
  // repoint the chrome tint with it.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT)
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
