import { useTranslations } from 'use-intl'
import { bracketEmbrace } from '../assets/brand/bracket-embrace.js'
import { wordmarkLockupDark } from '../assets/brand/wordmark.js'
import { LanguageToggle } from './language-toggle.js'

// The shared frame for the four pre-auth screens (login, accept, reset-request,
// reset-consume) — the app's branded front door (issue #123, map #116; signed-off mockup
// docs/prototypes/pre-auth-frame.html). It is the one seam of the redesign: the four
// routes render only their card contents as `children` and are otherwise untouched, so
// the whole entry flow reads as one surface.
//
// Desktop is a 50/50 two-column split — the brand-gradient panel on the inline-start
// column beside the sign-in form on the inline-end column. Placement is expressed with a
// plain grid and logical properties, so Hebrew (RTL, the canonical direction) puts the
// panel on the right and English (LTR) mirrors it to the left with no direction-specific
// styles. Below the desktop breakpoint the split folds to a single column: the panel is
// replaced by a compact brand-gradient cap above the form, keeping the primary action in
// the thumb zone. The form sits directly on the `card` surface — no floating bordered Card.
//
// The panel and cap wear the signature --bb-gradient-brand sweep (the brand site's own
// header bar, tan → chocolate) in both light and dark — the gradient is brand identity,
// not a themed surface — so only the form column switches by theme; direction and theme
// need no new machinery here because LocaleProvider already stamps dir/lang and the theme
// provider already stamps `.dark`, and this frame styles entirely through tokens and
// logical properties. The brand signature is the mark's own bracket-embrace glyph
// (composed from the client mark, ADR-0016), rendered large, low-opacity, aria-hidden, and
// flipped under RTL so the embrace still reads as an embrace. The cream wordmark lockup is
// used in both themes — cream on the brown gradient is the site's own hero pairing, and
// against the gradient's mid-tone it clears the large-text bar. The single restrained
// entrance is gated by prefers-reduced-motion.
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations()
  const appName = t('common.appName')
  const tagline = t('authFrame.tagline')

  return (
    <div className="flex min-h-dvh flex-col bg-background p-3 sm:p-4 md:p-6">
      <div className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 overflow-hidden rounded-2xl border border-border shadow-lg md:grid-cols-2">
        {/* Brand panel — desktop only, inline-start column. Its decoration is aria-hidden
            and only the wordmark is labelled, so assistive tech announces the brand and
            skips the ornament. */}
        <aside
          data-testid="auth-brand-panel"
          className="relative hidden overflow-hidden bg-[image:var(--bb-gradient-brand)] p-12 text-white md:flex md:items-center md:justify-center"
        >
          <img
            src={bracketEmbrace}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full object-contain p-12 opacity-15 select-none rtl:-scale-x-100"
          />
          <div className="relative z-10 flex max-w-[21rem] flex-col items-center text-center motion-safe:animate-[bb-rise-in_0.5s_ease_0.05s_both]">
            <img src={wordmarkLockupDark} alt={appName} className="w-60 max-w-[80%]" />
            <span aria-hidden="true" className="mt-6 h-px w-10 rounded-full bg-white/30" />
            <p className="mt-4 text-balance text-base font-semibold text-white/90">{tagline}</p>
          </div>
        </aside>

        {/* Form column — the `card` surface, full height, no separate bordered Card. */}
        <div className="relative flex flex-col bg-card text-card-foreground">
          {/* Brand cap — mobile only, above the form. */}
          <div
            data-testid="auth-brand-cap"
            className="relative flex flex-col items-center gap-2 overflow-hidden rounded-b-2xl bg-[image:var(--bb-gradient-brand)] px-6 pt-8 pb-6 text-white md:hidden"
          >
            <img
              src={bracketEmbrace}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-1/2 h-[150%] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 opacity-15 select-none rtl:-scale-x-100"
            />
            <img
              src={wordmarkLockupDark}
              alt={appName}
              className="relative z-10 w-44 max-w-[70%]"
            />
            <p className="relative z-10 text-sm font-semibold text-white/90">{tagline}</p>
          </div>

          <div className="flex justify-end p-4">
            <LanguageToggle />
          </div>

          <div className="flex flex-1 items-center justify-center px-6 pb-10 md:px-12">
            <div className="w-full max-w-[21rem] motion-safe:animate-[bb-rise-in_0.5s_ease_0.12s_both]">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
