import { useTranslations } from 'use-intl'
import { LanguageToggle } from './language-toggle.js'
import { Wordmark } from './wordmark.js'

// The shared frame for the four pre-auth screens (login, accept, reset-request,
// reset-consume) — the app's branded front door, recut to The Counter (round 8,
// 2026-08-14). The gradient panel and the raster wordmark/bracket artwork are gone; the
// brand now leads with the same black board the in-app chrome stands on:
//
//  - **Desktop** is a 50/50 split: the brand-black panel on the inline-start column — the
//    BURGERSBAR wordmark in the fixed nav inks, the tagline, a short gold-gradient rule,
//    and the כשר / K line — beside the form column on the warm-paper canvas, where the
//    form floats as one white card. The panel's two flourishes are the ( B ) mark ghosted
//    at architectural scale behind the text and the gold gradient as a thin seam where
//    black meets paper (the panel's inline-end edge).
//  - **Phone** folds to a single column: the same black panel as a compact cap — ghost,
//    wordmark, tagline, rule — with the gold seam along its bottom edge, and the form
//    directly on the canvas below (no card at phone width).
//
// Placement is logical-properties-only, so Hebrew (RTL) puts the panel on the right and
// English mirrors it with no direction-specific styles; the ghost's parentheses mirror
// natively. The single restrained entrance is gated by prefers-reduced-motion.
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations()
  const tagline = t('authFrame.tagline')

  return (
    <div className="grid min-h-dvh grid-cols-1 bg-background md:grid-cols-2">
      {/* Brand panel — desktop only, inline-start column. Decoration is aria-hidden; the
          wordmark announces the brand. */}
      <aside
        data-testid="auth-brand-panel"
        className="relative hidden overflow-hidden bg-nav-surface text-nav-ink md:flex md:flex-col md:justify-center md:px-16"
      >
        {/* The ( B ) ghosted at architectural scale — the one flourish allowed to grow. */}
        <span
          aria-hidden="true"
          dir="ltr"
          className="pointer-events-none absolute -bottom-[120px] -end-[70px] select-none whitespace-nowrap text-[23.75rem] font-extrabold leading-none tracking-[-0.04em] text-nav-gold/10"
        >
          ( B )
        </span>
        {/* The gold gradient as the seam where black meets paper. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 end-0 w-[3px] bg-[image:linear-gradient(to_bottom,var(--bb-gold-300),var(--bb-gold-500),var(--bb-gold-700))]"
        />
        <div className="relative z-10 flex flex-col items-start motion-safe:animate-[bb-rise-in_0.5s_ease_0.05s_both]">
          <Wordmark tone="nav" className="text-[2.625rem]" />
          <p className="mt-3.5 max-w-[34ch] text-balance text-heading-sm text-nav-muted">
            {tagline}
          </p>
          <span
            aria-hidden="true"
            className="mt-[26px] h-[3px] w-[72px] rounded-full bg-[image:linear-gradient(to_right,var(--bb-gold-300),var(--bb-gold-500),var(--bb-gold-700))]"
          />
          {/* The kosher certification from the brand's own lockup — Hebrew-first, both locales. */}
          <p className="mt-4.5 text-label text-nav-muted">כשר / K</p>
        </div>
      </aside>

      {/* Form column. */}
      <div className="relative flex flex-col">
        {/* One language toggle for the whole frame, floating at the top inline-end. Exactly
            one instance: a second copy for the phone would give the same control two entries
            in the accessibility tree (and two matches for every by-role selector). Its own
            muted ground keeps it readable over the phone cap's black and the desktop canvas
            alike. */}
        <div className="absolute top-3 end-3 z-20">
          <LanguageToggle />
        </div>

        {/* Brand cap — phone only: the black panel folded down, sealed by the gold seam. */}
        <div
          data-testid="auth-brand-cap"
          className="relative overflow-hidden bg-nav-surface px-7 pb-9 pt-[calc(2.75rem+env(safe-area-inset-top))] text-nav-ink md:hidden"
        >
          <span
            aria-hidden="true"
            dir="ltr"
            className="pointer-events-none absolute -bottom-[70px] -end-10 select-none whitespace-nowrap text-[11.875rem] font-extrabold leading-none tracking-[-0.04em] text-nav-gold/10"
          >
            ( B )
          </span>
          <span
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-[3px] bg-[image:linear-gradient(to_right,var(--bb-gold-300),var(--bb-gold-500),var(--bb-gold-700))]"
          />
          <div className="relative z-10 flex flex-col items-start motion-safe:animate-[bb-rise-in_0.5s_ease_0.05s_both]">
            <Wordmark tone="nav" className="text-[1.75rem]" />
            <p className="mt-2 max-w-[30ch] text-body text-nav-muted">{tagline}</p>
            <span
              aria-hidden="true"
              className="mt-4.5 h-[3px] w-14 rounded-full bg-[image:linear-gradient(to_right,var(--bb-gold-300),var(--bb-gold-500),var(--bb-gold-700))]"
            />
          </div>
        </div>

        {/* The form: directly on the canvas at phone width, one floating white card from md. */}
        <div className="flex flex-1 flex-col justify-center px-5 py-7 md:items-center md:px-12 md:py-10">
          <div className="w-full max-w-[25rem] motion-safe:animate-[bb-rise-in_0.5s_ease_0.12s_both] md:rounded-[14px] md:border md:border-border md:bg-card md:px-9 md:py-[34px] md:shadow-sm">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
