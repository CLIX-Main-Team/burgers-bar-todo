import { useTranslations } from 'use-intl'
import { cn } from '../lib/cn.js'
import { useTheme } from '../theme/theme.js'

// The Day/Night theme toggle (issue #101, recut for The Counter round 8): the settings
// menu's segmented control — a quiet muted ground holding two options, the chosen one
// raised on the card surface. Two options only (owner call, rev 3: no Auto); choosing one
// stamps the theme across the whole app at once through the ThemeProvider, and the choice
// persists. It stays a fieldset of two aria-pressed buttons, the shared segmented pattern
// the language toggle mirrors.
export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations('common')
  const { theme, setTheme } = useTheme()
  return (
    <fieldset
      className={cn('m-0 flex min-w-0 rounded-md border border-border bg-muted p-0.5', className)}
      aria-label={t('theme')}
    >
      <button
        type="button"
        onClick={() => setTheme('light')}
        aria-pressed={theme === 'light'}
        className={cn(
          'flex min-h-11 flex-1 items-center justify-center rounded-sm px-2.5 py-1 text-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 font-medium',
          theme === 'light'
            ? 'bg-card font-semibold text-foreground shadow-sm'
            : 'text-muted-foreground',
        )}
      >
        {t('themeLight')}
      </button>
      <button
        type="button"
        onClick={() => setTheme('dark')}
        aria-pressed={theme === 'dark'}
        className={cn(
          'flex min-h-11 flex-1 items-center justify-center rounded-sm px-2.5 py-1 text-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 font-medium',
          theme === 'dark'
            ? 'bg-card font-semibold text-foreground shadow-sm'
            : 'text-muted-foreground',
        )}
      >
        {t('themeDark')}
      </button>
    </fieldset>
  )
}
