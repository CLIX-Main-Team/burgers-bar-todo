import type { PrincipalResponse } from '@burgers/shared'
import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { BrandMark } from '../components/brand-mark.js'
import { Icon } from '../components/ui/icon.js'
import { Wordmark } from '../components/wordmark.js'
import { useUnseenTasksCount } from '../features/tasks/unseen.js'
import { cn } from '../lib/cn.js'
import { AccountMenu } from './account-menu.js'
import { destinationsFor, tabsFor } from './destinations.js'
import { UnseenTasksBadge } from './unseen-tasks-badge.js'

// The app's one navigation rail, on every width (v2 handoff §3 and §7). It replaces the pair
// it used to be — a desktop side nav plus a phone header and bottom tab bar — with a single
// column at the inline-start that only changes measure: 74px of icons over labels on a phone,
// 240px of icon-and-label rows from `md`. One rail means one active state, one account block
// and one set of destinations, and it buys the phone its whole top edge back: no header, so a
// screen's own title is the first thing on it.
//
// The phone drops the rail-only destinations (Projects) — 74px of width is a floor, not a
// suggestion, and four rows is what fits without the labels wrapping.
//
// Brand black in dark, near-white in day (v2 palette): the surface and inks are the nav-*
// tokens, which became theme-aware in this round — the client's call, and a documented
// reversal of the fixed-black chrome the 2026-08-12 refresh introduced.
//
// Everything is laid out with logical properties (border-inline-end, inline-start marker,
// ms/ps) so one definition mirrors: the rail sits at the inline-start, the right in Hebrew
// and the left in English, with no direction-specific CSS.

export function SideNav({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()

  // The Tasks row's new-assignments count (#136). Hidden while Tasks is the active
  // destination: on the board, the visit itself is the acknowledgement.
  const unseen = useUnseenTasksCount()

  // The phone rail carries the everyday destinations; the desktop rail carries all of them.
  const phoneRows = tabsFor(principal)
  const deskRows = destinationsFor(principal)

  return (
    <nav
      data-testid="side-nav"
      aria-label={t('common.primaryNav')}
      className={cn(
        // 80px, not the artboard's 74: at 74 the two longest labels — Dashboard and
        // Knowledge — clipped to "Dashboa…", and neither is a word that can wrap, so the
        // rail has to be wide enough to say them (owner report 2026-08-21).
        'flex h-dvh w-20 flex-none flex-col border-e border-nav-border bg-nav-surface px-[7px] py-2.5',
        // The rail owns both vertical insets now that no header clears the notch and no bar
        // clears the home indicator.
        'pt-[max(0.625rem,env(safe-area-inset-top))] pb-[max(0.625rem,env(safe-area-inset-bottom))]',
        'md:w-[var(--bb-sidenav)] md:gap-2 md:px-3 md:py-4',
      )}
    >
      {/* The brand: the ( B ) coin alone where 74px cannot hold the wordmark, the full
          BURGERSBAR device from md. Not a link; the destinations own navigation. */}
      <div
        aria-hidden="true"
        className="grid h-[42px] flex-none place-items-center text-nav-gold md:hidden"
      >
        <BrandMark className="w-7" />
      </div>
      <Wordmark tone="nav" className="hidden px-2.5 pt-2 pb-4 text-[1rem] md:flex" />

      {/* The section overline names what the rows below are. Desktop only: on the phone rail
          it would cost a row's worth of height to say something four glyphs already say. */}
      <p className="hidden px-2.5 pb-1.5 text-caption font-bold uppercase tracking-[0.08em] text-nav-muted md:block">
        {t('common.workspace')}
      </p>

      <ul className="flex flex-col gap-1 md:gap-1">
        {deskRows.map((row) => {
          const onPhone = phoneRows.includes(row)
          return (
            <li key={row.to} className={cn(!onPhone && 'hidden md:block')}>
              <NavLink
                to={row.to}
                className={({ isActive }) =>
                  cn(
                    // Phone: a 58px stacked target, icon over a caption label, centred.
                    // Desktop from md: the 40px icon-and-label row at body scale.
                    // Semibold at rest and semibold when active: the label's weight never
                    // moves, so selecting a row does not nudge the ones under it (owner call
                    // 2026-08-21). Selection is carried by colour, plus the wash, the gold
                    // marker and the filled glyph.
                    'relative flex min-h-[3.625rem] flex-col items-center justify-center gap-1 rounded-md px-0.5 py-[7px] text-center text-caption font-semibold leading-[1.15]',
                    'md:h-10 md:min-h-0 md:flex-row md:justify-start md:gap-[11px] md:px-2.5 md:py-0 md:text-start md:text-body',
                    'hover:bg-nav-active/60 hover:text-nav-ink',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-gold',
                    // Active carries the wash and full ink; the gold marker and the
                    // fill-weight icon below are the second, non-colour signals.
                    isActive ? 'bg-nav-active text-nav-ink' : 'text-nav-muted',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* The gold inline-start marker bar — sits in the rail's own inline
                        padding gutter at each measure, and mirrors with the layout. */}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute top-2.5 bottom-2.5 -start-[7px] w-[3px] rounded-full bg-nav-gold md:top-2 md:bottom-2 md:-start-[0.5625rem]"
                      />
                    )}
                    {/* The destination glyph carries the reserved `fill` active weight
                        (iconography.md); decorative — the label names the link. */}
                    <Icon name={row.icon} size="lg" active={isActive} className="md:size-5" />
                    <span className="max-w-full truncate">{t(row.labelKey)}</span>
                    {/* The new-assignments pill (#136): at the row's inline end where the
                        desktop rail has the room, and on the glyph's corner where it does not. */}
                    {row.to === '/tasks' && !isActive && unseen > 0 ? (
                      <UnseenTasksBadge
                        count={unseen}
                        className="absolute top-1.5 end-2 md:static md:ms-auto"
                      />
                    ) : null}
                  </>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>

      {/* Account foot — pushed to the bottom, divided from the rows. Opens the account panel:
          a popover rising from the foot on desktop, a bottom sheet on a phone. */}
      <div className="mt-auto border-t border-nav-border pt-2.5 md:pt-4">
        <AccountMenu principal={principal} />
      </div>
    </nav>
  )
}
