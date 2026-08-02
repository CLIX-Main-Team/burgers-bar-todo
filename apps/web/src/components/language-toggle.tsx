import { useTranslations } from 'use-intl'
import { useLocale } from '../i18n/locale.js'
import { cn } from '../lib/cn.js'

// The Hebrew/English toggle carried by every pre-auth screen and the in-app header
// (ui-flow: bilingual, direction-aware). Picking a language switches the strings and the
// document direction at once; on the accept screen the chosen language is also what gets
// saved as preferred_language, so the toggle's value is read there at submit.
export function LanguageToggle() {
  const t = useTranslations('common')
  const { locale, setLocale } = useLocale()
  return (
    <fieldset
      className="m-0 inline-flex min-w-0 rounded-md border border-slate-300 bg-white p-0.5"
      aria-label={t('language')}
    >
      <button
        type="button"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        className={cn(
          'rounded px-2.5 py-1 text-xs font-medium',
          locale === 'en' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
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
          locale === 'he' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
        )}
      >
        {t('languageHebrew')}
      </button>
    </fieldset>
  )
}
