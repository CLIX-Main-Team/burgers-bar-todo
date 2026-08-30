import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { LanguageToggle } from '../components/language-toggle.js'
import { Wordmark } from '../components/wordmark.js'
import type { PolicyDocument } from './privacy-content.js'

// The shared shell for the app's public legal documents (the privacy policy and the account
// deletion page). Both stores demand URLs that open with no account and no app installed, and
// a reviewer will follow them, so these are plain document pages rather than app screens: no
// session, no API call, no chrome beyond the brand and the language toggle. The locale state is
// the one the pre-auth screens use, which defaults to the browser's own language, so a reviewer
// in either language lands on a page they can read.
export function PolicyDocumentPage({ doc }: { doc: PolicyDocument }) {
  // These two documents link to each other, and a client-side navigation keeps the scroll
  // position it had — so following "how to delete your account" from the foot of a long policy
  // lands halfway down the page it just opened. A reviewer reads that as a broken link.
  // Each document is its own route component, so crossing between them remounts this one and
  // a mount-only effect is the whole story.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

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
            {section.link ? (
              <Link
                to={section.link.href}
                className="mt-2.5 inline-block text-body text-primary underline underline-offset-4"
              >
                {section.link.label}
              </Link>
            ) : null}
          </section>
        ))}
      </main>
    </div>
  )
}
