import type { ReactNode } from 'react'
import { useTranslations } from 'use-intl'
import { useSession } from '../../auth/session.js'
import { roleLabelKey } from '../../i18n/labels.js'
import { IdentityForm } from './identity-form.js'
import { PasswordForm } from './password-form.js'

// Your own account (owner ask 2026-09-04): the page behind the Profile row in the account
// popover. Three cards, in the order a person is likely to want them: the face the team
// recognises (name and disc colour, one Save between them), the facts about the account an
// admin owns (read-only, so nobody hunts for an edit control that is not there), and the
// password. Each form is its own unit with its own Save, so a half-typed password never rides
// along with a colour change and vice versa.
//
// No capability gates it — every signed-in role has a face and a password — and the API scopes
// every write to the bearer's own row, so the page has no id to carry and nothing to leak.
export function ProfileScreen() {
  const { principal } = useSession()
  const t = useTranslations()

  // RequireAuth guarantees a principal; the check narrows the type.
  if (!principal) {
    return null
  }

  return (
    <div className="flex w-full max-w-[46rem] flex-col gap-4">
      <header className="motion-safe:animate-rise">
        <h1 className="text-heading-lg font-extrabold text-foreground">{t('profile.heading')}</h1>
        <p className="mt-0.5 text-label text-muted-foreground">{t('profile.subtitle')}</p>
      </header>

      <Section title={t('profile.identityTitle')} delay={60}>
        <IdentityForm principal={principal} />
      </Section>

      <Section title={t('profile.accountTitle')} hint={t('profile.accountHint')} delay={120}>
        {/* A definition list, because these are facts with names, not fields with values. The
            email is Latin script inside a Hebrew page, so it sits in a <bdi> and keeps its own
            direction without re-aligning the row. */}
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-body">
          <dt className="text-label font-semibold text-muted-foreground">{t('common.email')}</dt>
          <dd className="min-w-0 truncate text-foreground">
            <bdi>{principal.email}</bdi>
          </dd>
          <dt className="text-label font-semibold text-muted-foreground">{t('profile.role')}</dt>
          <dd className="text-foreground">{t(roleLabelKey(principal.role))}</dd>
          <dt className="text-label font-semibold text-muted-foreground">{t('profile.branch')}</dt>
          <dd className="min-w-0 truncate text-foreground">
            <bdi>{principal.locationName ?? t('profile.chainWide')}</bdi>
          </dd>
        </dl>
      </Section>

      <Section title={t('profile.passwordTitle')} hint={t('profile.passwordHint')} delay={180}>
        <PasswordForm />
      </Section>
    </div>
  )
}

// One card of the page: a titled surface with an optional one-line hint under the title. The
// cards rise in after the header, each a beat later than the one above, so the page reads top
// to bottom on arrival the way the dashboard's do.
function Section({
  title,
  hint,
  delay,
  children,
}: {
  title: string
  hint?: string
  delay: number
  children: ReactNode
}) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-4 shadow-sm motion-safe:animate-rise md:p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <h2 className="text-heading-sm font-bold text-foreground">{title}</h2>
      {hint ? <p className="mt-0.5 text-label text-muted-foreground">{hint}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}
