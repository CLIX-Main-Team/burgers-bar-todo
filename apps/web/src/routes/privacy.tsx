import { LanguageToggle } from '../components/language-toggle.js'
import { Wordmark } from '../components/wordmark.js'
import { useLocale } from '../i18n/locale.js'
import { privacyPolicy } from './privacy-content.js'

// The public privacy policy (docs/mobile/*-publishing.md). Both stores demand a URL that
// opens the policy with no account and no app installed, and a reviewer will follow it, so
// this is a plain document page rather than an app screen: no session, no API call, no
// chrome beyond the brand and the language toggle. It reads the same locale state the
// pre-auth screens use, which defaults to the browser's own language, so a reviewer in
// either language lands on a page they can read.
export function PrivacyScreen() {
  const { locale } = useLocale()
  const doc = privacyPolicy[locale]

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between gap-4 border-b border-border bg-nav-surface px-5 py-3.5 text-nav-ink md:px-10">
        <Wordmark tone="nav" className="text-[1.25rem]" />
        <LanguageToggle />
      </header>

      <main className="mx-auto w-full max-w-[46rem] px-5 py-9 md:px-10 md:py-12">
        <h1 className="text-heading-lg text-foreground">{doc.title}</h1>
        <p className="mt-1.5 text-caption text-muted-foreground">{doc.lastUpdated}</p>
        <p className="mt-5 text-body text-foreground">{doc.intro}</p>

        {doc.sections.map((section) => (
          <section key={section.heading} className="mt-8">
            <h2 className="text-heading-sm text-foreground">{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph} className="mt-2.5 text-body text-foreground">
                {paragraph}
              </p>
            ))}
            {section.bullets ? (
              <ul className="mt-2.5 flex list-disc flex-col gap-2 ps-5 text-body text-foreground">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </main>
    </div>
  )
}
