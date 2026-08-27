import { useTranslations } from 'use-intl'
import { useLocale } from '../i18n/locale.js'
import { cn } from '../lib/cn.js'

// The Hebrew/English toggle carried by every pre-auth screen and the settings menu
// (ui-flow: bilingual, direction-aware). Picking a language switches the strings and the
// document direction at once; on the accept screen the chosen language is also what gets
// saved as preferred_language, so the toggle's value is read there at submit.
//
// Recut for The Counter (round 8) to the same segmented control the theme toggle wears —
// muted ground, the chosen option raised on the card surface. The leading translate glyph
// is gone with the recut: in the settings menu the LANGUAGE overline names the control,
// and on the pre-auth screens the two labels are self-evident (the fieldset keeps the
// accessible name either way).
export function LanguageToggle({ className }: { className?: string }) {
  const t = useTranslations('common')
  const { locale, setLocale } = useLocale()
  return (
    <fieldset
      className={cn(
        'm-0 flex min-w-0 rounded-md border border-border-strong bg-card p-0.5',
        className,
      )}
      aria-label={t('language')}
    >
      <button
        type="button"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        className={cn(
          'flex min-h-11 flex-1 items-center justify-center rounded-sm px-2.5 py-1 text-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 font-semibold',
          locale === 'en' ? 'bg-foreground text-background' : 'text-muted-foreground',
        )}
      >
        {t('languageEnglish')}
      </button>
      <button
        type="button"
        onClick={() => setLocale('he')}
        aria-pressed={locale === 'he'}
        className={cn(
          'flex min-h-11 flex-1 items-center justify-center rounded-sm px-2.5 py-1 text-caption focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:min-h-9 font-semibold',
          locale === 'he' ? 'bg-foreground text-background' : 'text-muted-foreground',
        )}
      >
        {t('languageHebrew')}
      </button>
    </fieldset>
  )
}
