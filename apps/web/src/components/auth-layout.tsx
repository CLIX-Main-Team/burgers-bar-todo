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
// replaced by a brand-gradient hero above the form, keeping the primary action in the
// thumb zone. The form sits directly on the `card` surface — no floating bordered Card.
//
// The panel and hero wear the signature --bb-gradient-brand sweep (the brand site's own
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
//
// Phone composition, revised 2026-08-11 (owner: "the login page looks really bad"). Three
// changes, all about where the vertical space went:
//   • the hero is sized as a fraction of the viewport instead of to its own content, so it
//     absorbs the slack a short form leaves on a tall phone rather than stranding it as a
//     void under the button;
//   • the form rides up over the hero on its own rounded top edge, so the seam between
//     brand and form is a deliberate overlap instead of two stacked bands;
//   • the language toggle leaves the flow entirely (see below), which is what freed the
//     row that used to sit orphaned between the two.
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
          {/* One language toggle for the whole frame, lifted out of the flow to the top
              inline-end corner. Exactly one instance: a second copy for the phone would
              give the same control two entries in the accessibility tree (and two matches
              for every by-role selector). It carries its own `card` ground, so it reads as
              a floating control on the phone's gradient hero and as a plain segmented
              control on the desktop card without branching on the breakpoint. */}
          <div className="absolute top-3 end-3 z-20">
            <LanguageToggle />
          </div>

          {/* Brand hero — phone only. Sized as a fraction of the viewport (bounded, so it
              is neither a stripe on a small phone nor half the screen on a large one). */}
          <div
            data-testid="auth-brand-cap"
            className="relative flex h-[42dvh] max-h-[24rem] min-h-[13rem] flex-col items-center justify-center overflow-hidden bg-[image:var(--bb-gradient-brand)] px-6 text-white md:hidden"
          >
            {/* Same containment as the desktop panel — the embrace framing the wordmark
                between its brackets. Cropping it off the edge instead was tried and lost
                the glyph entirely at this size: what survived the crop read as a smudge on
                the gradient rather than as the mark. */}
            <img
              src={bracketEmbrace}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full object-contain p-6 opacity-15 select-none rtl:-scale-x-100"
            />
            <img
              src={wordmarkLockupDark}
              alt={appName}
              className="relative z-10 w-48 max-w-[68%] motion-safe:animate-[bb-rise-in_0.5s_ease_0.05s_both]"
            />
            <span
              aria-hidden="true"
              className="relative z-10 mt-5 h-px w-10 rounded-full bg-white/30"
            />
            <p className="relative z-10 mt-3 text-sm font-semibold text-white/90">{tagline}</p>
          </div>

          {/* The form, riding up over the hero on the phone. The upward shadow is what
              sells the overlap — without it the rounded top reads as a notch cut out of
              the gradient rather than a surface in front of it. Desktop keeps the flat
              full-height column, so every phone-only rule is reset at md. */}
          <div className="relative z-10 -mt-6 flex flex-1 flex-col justify-center rounded-t-[1.75rem] bg-card px-6 pt-9 pb-10 shadow-[0_-10px_30px_-12px_rgb(42_34_22_/_0.45)] md:mt-0 md:rounded-none md:px-12 md:pt-6 md:shadow-none">
            <div className="mx-auto w-full max-w-[21rem] motion-safe:animate-[bb-rise-in_0.5s_ease_0.12s_both]">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
