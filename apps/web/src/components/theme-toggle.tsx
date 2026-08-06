import { useTranslations } from 'use-intl'
import { cn } from '../lib/cn.js'
import { useTheme } from '../theme/theme.js'
import { Icon } from './ui/icon.js'

// The light/dark theme toggle (issue #101, the feature's one new control). It is the
// LanguageToggle pattern exactly — a fieldset of two aria-pressed buttons, one pressed at
// a time — so the account menu reads as one consistent segmented style, and it takes the
// same soft accent surface for its selected option rather than the scarce blue primary
// (tokens.md principle 3). Choosing an option stamps the theme across the whole app at
// once through the ThemeProvider, with no navigation; the choice persists.
export function ThemeToggle() {
  const t = useTranslations('common')
  const { theme, setTheme } = useTheme()
  return (
    <fieldset
      className="m-0 inline-flex min-w-0 rounded-md border border-input bg-card p-0.5"
      aria-label={t('theme')}
    >
      <button
        type="button"
        onClick={() => setTheme('light')}
        aria-pressed={theme === 'light'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium',
          theme === 'light'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted',
        )}
      >
        {/* Leading sun glyph, decorative — the button text names the option (iconography.md,
            role theme-light). It inherits the button's foreground, blue on the selected soft
            accent and muted otherwise. */}
        <Icon name="theme-light" />
        {t('themeLight')}
      </button>
      <button
        type="button"
        onClick={() => setTheme('dark')}
        aria-pressed={theme === 'dark'}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium',
          theme === 'dark'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted',
        )}
      >
        {/* Leading moon glyph, decorative — the button text names the option (iconography.md,
            role theme-dark). */}
        <Icon name="theme-dark" />
        {t('themeDark')}
      </button>
    </fieldset>
  )
}
