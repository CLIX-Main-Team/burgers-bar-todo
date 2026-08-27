import { useTranslations } from 'use-intl'
import { wordmarkLockupDark } from '../assets/brand/wordmark.js'
import { LanguageToggle } from './language-toggle.js'

// The shared frame for the four pre-auth screens (login, accept, reset-request,
// reset-consume) — the app's branded front door, recut to the brand book (auth round,
// 2026-08-27; the redesign licence is ADR-0018, scoped to this frame only). The round-8
// split panel is gone; the door is now the client's own icon: the ( B ) mark's two
// brackets hold the letter, and here they hold the person signing in.
//
//  - **One composition at every width**, on a fixed warm-black board — the ground the
//    brand book's lockups stand on. Identity, not chrome: like the old gradient panel it
//    does not follow the theme; only the card surface inside it does.
//  - The true wordmark lockup (the client's vector, cream) with its own כשר / K line and
//    the tagline, over the form as one white card.
//  - **The embrace is the desktop move.** From lg the two bracket paths of the ( B ) mark
//    — the real geometry, composed not redrawn (ADR-0016) — stand at architectural scale
//    around the card, painted with the brand's gold gradient: its one spend on this page.
//    This is what keeps map #116's diagnosis answered — the desktop is filled by the
//    mark's own gesture, not a card marooned in a void.
//
// The composition is centred and the embrace symmetric, so RTL and LTR are the same
// picture; the card interior mirrors through logical properties as everywhere else. The
// two motion-safe entrances (the embrace settling, the door rising) are gated by
// prefers-reduced-motion.
export function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations()

  return (
    <div
      data-testid="auth-front-door"
      className="bb-front-door relative flex min-h-dvh flex-col text-nav-ink"
    >
      {/* The embrace — desktop only, centred on the whole door so it never clips against
          the viewport. Decoration: aria-hidden, behind the content. */}
      <span
        aria-hidden="true"
        data-testid="auth-embrace"
        className="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex"
      >
        <span className="bb-embrace block aspect-[4169/3452] w-[47rem] motion-safe:animate-[bb-embrace-in_0.8s_ease_both]" />
      </span>

      {/* One language toggle for the whole frame, floating at the top inline-end. Exactly
          one instance: a second copy for the phone would give the same control two entries
          in the accessibility tree (and two matches for every by-role selector). Its own
          muted ground keeps it readable over the black board. */}
      <div className="absolute top-3 end-3 z-20">
        <LanguageToggle />
      </div>

      <div className="relative flex flex-1 flex-col items-center px-5 pb-8 pt-[calc(4.5rem+env(safe-area-inset-top))] sm:px-8">
        <div className="my-auto flex w-full flex-col items-center">
          {/* The lockup, as the brand book sets it: the wordmark artwork over its kosher
              line — Hebrew-first in both locales, exactly as the client's own lockup PDF —
              then the door's one promise. The artwork carries the app name as alt text. */}
          <div className="flex flex-col items-center text-center motion-safe:animate-[bb-rise-in_0.5s_ease_0.05s_both]">
            <img src={wordmarkLockupDark} alt={t('common.appName')} className="w-52 md:w-60" />
            <p className="mt-3 text-caption text-nav-muted">כשר / K</p>
            <p className="mt-6 max-w-[34ch] text-balance text-label text-nav-muted md:text-heading-sm">
              {t('authFrame.tagline')}
            </p>
          </div>

          {/* The door itself: one card at every width — where the icon's B stands. */}
          <div className="relative z-10 mt-9 w-full max-w-[25rem] rounded-[14px] border border-border bg-card px-6 py-7 text-card-foreground shadow-lg motion-safe:animate-[bb-rise-in_0.5s_ease_0.12s_both] sm:px-9 sm:py-[34px]">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
