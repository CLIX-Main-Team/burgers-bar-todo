import type { PrincipalResponse } from '@burgers/shared'
import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { Icon } from '../components/ui/icon.js'
import { Wordmark } from '../components/wordmark.js'
import { useUnseenTasksCount } from '../features/tasks/unseen.js'
import { cn } from '../lib/cn.js'
import { AccountMenu } from './account-menu.js'
import { destinationsFor } from './destinations.js'
import { UnseenTasksBadge } from './unseen-tasks-badge.js'

// The navigation rail, from `md` up. Below that it is not narrowed, it is gone: the phone
// gets the bottom bar in bottom-tabs.tsx instead.
//
// It used to run at every width, an 80px column of icons over labels on a phone widening to
// 240px of icon-and-label rows from `md`. That cost a 390px phone 20.5% of its inline space
// and never stopped clipping the two longest labels, which is what a nine-glyph word does in
// an 80px column whichever way you size it. A rail on a phone is a tablet pattern on the
// wrong device class: Material 3 puts destinations in a bottom bar below 600dp and reserves
// the rail for 600dp and up (owner report 2026-08-30).
//
// Being one measure rather than two, everything here is now the desktop shape with no phone
// branch underneath it. One rail still means one active state, one account block and one set
// of destinations, and the rail and the bar are never mounted at the same time.
//
// The rail carries all of a role's destinations, including the ones held back from the phone
// bar for want of a slot (Locations, see destinations.ts).
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

  const rows = destinationsFor(principal)

  return (
    <nav
      data-testid="side-nav"
      aria-label={t('common.primaryNav')}
      className={cn(
        'hidden w-[var(--bb-sidenav)] flex-none flex-col gap-2 border-e border-nav-border bg-nav-surface px-3 py-4 md:flex',
        // h-full, not h-dvh: the rail is a cell in the shell's row now, and that row is itself
        // short of the viewport by whatever the bottom bar takes. h-dvh would overhang it.
        'h-full',
        // A tablet at this width still has intrusions to clear, and no header above the rail
        // to clear them for it.
        'pt-[max(1rem,var(--bb-safe-top))] pb-[max(1rem,var(--bb-safe-bottom))]',
      )}
    >
      <Wordmark tone="nav" className="flex px-2.5 pt-2 pb-4 text-[1rem]" />

      {/* The section overline names what the rows below are. */}
      <p className="px-2.5 pb-1.5 text-caption font-bold uppercase tracking-[0.08em] text-nav-muted">
        {t('common.workspace')}
      </p>

      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.to}>
            <NavLink
              to={row.to}
              className={({ isActive }) =>
                cn(
                  // The 40px icon-and-label row at body scale. Semibold at rest and semibold
                  // when active: the label's weight never moves, so selecting a row does not
                  // nudge the ones under it (owner call 2026-08-21). Selection is carried by
                  // colour, plus the filled glyph.
                  'relative flex h-10 items-center gap-[11px] rounded-md px-2.5 text-start text-body font-semibold',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-gold',
                  // Active is a SOLID pill of the action blue in both themes (round 14,
                  // 2026-08-27) rather than the quiet wash it used to be. The fill-weight
                  // icon is the second, non-colour signal; the gold marker bar that used to
                  // sit in the gutter went with the wash, since a solid pill already says
                  // "here" and the two together said it twice.
                  // The hover wash belongs to the INACTIVE branch only. On the base list it
                  // applied to every row including the selected one, and `.hover\:bg-*:hover`
                  // carries a class plus a pseudo-class where `.bg-nav-selected` carries one
                  // class, so hover outranked selected permanently — same layer, so no amount
                  // of source order could beat it. The row you had just clicked kept the pale
                  // hover wash under your resting pointer and only turned blue once the mouse
                  // moved off it, which reads as the selection lagging behind the click
                  // (owner report 2026-08-27). Measured: identical on a 21ms page and a 173ms
                  // one, which is what ruled out a slow render as the cause.
                  isActive
                    ? 'bg-nav-selected text-nav-selected-ink'
                    : 'text-nav-muted hover:bg-nav-active/60 hover:text-nav-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  {/* The destination glyph carries the reserved `fill` active weight
                      (iconography.md); decorative — the label names the link. */}
                  <Icon name={row.icon} size="lg" active={isActive} className="size-5" />
                  <span className="max-w-full truncate">{t(row.labelKey)}</span>
                  {/* The new-assignments pill (#136), at the row's inline end. */}
                  {row.to === '/tasks' && !isActive && unseen > 0 ? (
                    <UnseenTasksBadge count={unseen} className="ms-auto" />
                  ) : null}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      {/* Account foot — pushed to the bottom, divided from the rows. Opens the account panel
          as a popover rising from the foot. */}
      <div className="mt-auto border-t border-nav-border pt-4">
        <AccountMenu principal={principal} />
      </div>
    </nav>
  )
}
