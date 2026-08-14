import { Outlet } from 'react-router-dom'
import { useSession } from '../auth/session.js'
import { Wordmark } from '../components/wordmark.js'
import { cn } from '../lib/cn.js'
import { AccountMenu } from './account-menu.js'
import { CONTENT_COLUMN, CONTENT_INNER } from './frame.js'
import { SideNav } from './side-nav.js'
import { TabBar } from './tab-bar.js'

// The navigational shell: the layout route at `/` that draws the app's chrome once and
// renders the routed feature screen into its Outlet (PRD, "the `/` route becomes a
// layout route"). Feature screens render into the Outlet and never draw their own chrome.
//
// Two shells share this one frame, flipping at `md` (768px) — the desktop shell decided and
// mocked in #175 (docs/design-system/mockups/shell/):
//
//  - **Below `md`** — the phone shell: an AppHeader that clears the notch, a single readable
//    column capped at --bb-content-max, and a bottom TabBar that clears the home indicator.
//    Everything the header and bar own is authored phone-first.
//  - **From `md`** — a two-region row: a persistent SideNav (fixed --bb-sidenav) at the
//    inline-start owns the brand, the destinations (the two role-invariant ones plus the
//    role-gated People/Locations rows, #209), and the account block, beside a content region
//    capped at --bb-content-wide and centred. The mobile header and TabBar collapse
//    (md:hidden); each screen's own content-header owns its primary action (so the mobile FAB
//    has no desktop counterpart here — that is each screen's concern, #176).
//
// The whole thing is logical-property-only (ms/me/ps/pe, border-inline, inset-inline) so a
// single definition mirrors: the side nav sits at the inline-start — the right in Hebrew,
// the left in English — with no direction-specific CSS. Both shells pin to the viewport
// height and scroll the content region within it (the model the desktop shell always had,
// extended to mobile for the assistant's pinned composer, owner ask 2026-08): header, tab
// bar, and side nav never move, and a screen that wants an inner scrolling pane — the
// chat — gets a height-bounded column to build it in (the content wrapper is a min-h-full
// flex column, so a screen opts in with flex-1 min-h-0 and every other screen just flows).
export function AppLayout() {
  const { principal } = useSession()

  // RequireAuth guarantees a principal before this renders; the check narrows the type.
  if (!principal) {
    return null
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden md:flex-row">
      {/* Desktop side nav — inline-start column, hidden below md. */}
      <SideNav principal={principal} />

      {/* Mobile header — hidden from md, where the side nav owns brand + account. In flow, not
          sticky: the content region below is the scroll container, so the header never moves.
          Brand black in BOTH themes since The Counter rev 4 (owner's question, answered yes):
          the phone header wears the same fixed board the desktop rail does, so both shells
          hang off one anchor. Revert = bg-card/border-border + the default Wordmark tone. */}
      <header className="border-b border-nav-border bg-nav-surface pt-[env(safe-area-inset-top)] md:hidden">
        <div
          className={cn(CONTENT_COLUMN, 'flex items-center justify-between gap-2 px-4 pt-2.5 pb-3')}
        >
          {/* The same wordmark device the desktop side nav opens with — bold BURGERS, light
              BAR, gold parentheses — in the fixed nav inks, a step smaller than the nav's. */}
          <Wordmark tone="nav" className="text-[0.9375rem]" />
          <AccountMenu principal={principal} />
        </div>
      </header>

      {/* Content region — the one scroll container on both shells; the inner column caps at
          30rem on mobile and widens to 70rem centred from md. A screen that must fill the
          viewport instead of flowing (the assistant's chat pane) stamps `data-fills-shell` on
          its root: the `has-[...]` variant then hard-bounds the wrapper to the region's height
          (`h-full`), which a min-height alone cannot do — min-h-full lets the wrapper grow
          with an overflowing thread, and the screen's flex-1/min-h-0 chain never binds against
          a grown parent. Every other screen leaves the attribute off and scrolls as normal
          flowing content.

          A second opt-in, `data-bleeds-shell`, releases the frame itself from `lg`: the cap,
          centring, and padding come off so the screen can pin a full-height rail directly
          against the side nav (the assistant's thread rail, owner ask 2026-08). The screen
          then owns its own interior padding and reading measure. Below `lg` the attribute is
          inert — the phone/tablet frame is untouched. */}
      {/* relative guards the document, not the layout: an absolutely-positioned descendant
          with no positioned ancestor (a sr-only label, a stray absolute) otherwise anchors to
          the *viewport* at its static position — escaping this scroller's clip entirely and
          stretching the page itself when it lands below the fold (the prod two-scrollbars /
          unpinned-tab-bar bug, 2026-08-12). Positioned, this scroller contains them all. */}
      <main className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div
          className={cn(
            CONTENT_INNER,
            'flex min-h-full flex-col p-4 has-[[data-fills-shell]]:h-full md:px-[30px] md:pt-[26px] md:pb-12',
            'lg:has-[[data-bleeds-shell]]:max-w-none lg:has-[[data-bleeds-shell]]:p-0',
            // A third opt-in, `data-fills-width` (owner call 2026-08-13, matching the
            // approved replica): the screen keeps the frame's padding but sheds the 70rem
            // cap, so a board runs its lanes to the frame's edge the way the replica draws
            // it. Form and list screens stay capped — a 1600px input row reads absurd.
            'md:has-[[data-fills-width]]:max-w-none',
          )}
        >
          <Outlet />
        </div>
      </main>

      {/* Mobile tab bar — hidden from md, replaced by the side nav. Role-aware: it draws the
          same shared destinations list as the side nav. */}
      <TabBar principal={principal} className="md:hidden" />
    </div>
  )
}
