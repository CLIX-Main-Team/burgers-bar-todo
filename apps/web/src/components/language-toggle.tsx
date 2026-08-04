import { useTranslations } from 'use-intl'
import { useLocale } from '../i18n/locale.js'
import { cn } from '../lib/cn.js'
import { Icon } from './ui/icon.js'

// The Hebrew/English toggle carried by every pre-auth screen and the in-app header
// (ui-flow: bilingual, direction-aware). Picking a language switches the strings and the
// document direction at once; on the accept screen the chosen language is also what gets
// saved as preferred_language, so the toggle's value is read there at submit.
//
// Rethemed onto the tokens (issue #101, components.md LanguageToggle): the selected
// option takes the soft accent surface — not the gold primary, which is reserved for the
// one primary action per screen (tokens.md principle 3) — and the unselected options read
// as muted. It stays a fieldset of two aria-pressed buttons, the shared segmented pattern.
export function LanguageToggle() {
  const t = useTranslations('common')
  const { locale, setLocale } = useLocale()
  return (
    <fieldset
      className="m-0 inline-flex min-w-0 items-center rounded-md border border-input bg-card p-0.5 text-muted-foreground"
      aria-label={t('language')}
    >
      {/* One translate glyph labels the whole control — unlike the theme toggle there is no
          per-option glyph, so a single leading mark carries the "language" meaning
          (iconography.md, role language). Decorative: the fieldset's aria-label names it. Its
          colour is the muted foreground it inherits from the fieldset — the buttons override
          that with their own — so it reads as a passive label, not a third pressable option,
          without a call-site colour prop (iconography.md, Colour). */}
      <Icon name="language" className="mx-1" />
      <button
        type="button"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        className={cn(
          'rounded px-2.5 py-1 text-xs font-medium',
          locale === 'en'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted',
        )}
      >
        {t('languageEnglish')}
      </button>
      <button
        type="button"
        onClick={() => setLocale('he')}
        aria-pressed={locale === 'he'}
        className={cn(
          'rounded px-2.5 py-1 text-xs font-medium',
          locale === 'he'
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted',
        )}
      >
        {t('languageHebrew')}
      </button>
    </fieldset>
  )
}
