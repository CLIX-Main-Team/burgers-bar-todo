import { Outlet } from 'react-router-dom'
import { useSession } from '../auth/session.js'
import { cn } from '../lib/cn.js'
import { CONTENT_INNER } from './frame.js'
import { SideNav } from './side-nav.js'

// The navigational shell: the layout route at `/` that draws the app's chrome once and
// renders the routed feature screen into its Outlet (PRD, "the `/` route becomes a
// layout route"). Feature screens render into the Outlet and never draw their own chrome.
//
// One shell at every width since the v2 handoff (§7): a navigation rail at the inline-start
// beside a content region. The rail changes measure at `md` (74px of icons over labels on a
// phone, 240px of icon-and-label rows above it) and nothing else moves — the phone's header
// and bottom tab bar are gone, which hands each screen its own top edge for its title, and
// leaves the app with a single active state instead of two that had to agree.
//
// The content region is capped at --bb-content-wide and centred; each screen's own header
// owns its primary action, and a phone screen that wants a create affordance draws its own
// FAB (#176).
//
// The whole thing is logical-property-only (ms/me/ps/pe, border-inline, inset-inline) so a
// single definition mirrors: the side nav sits at the inline-start — the right in Hebrew,
// the left in English — with no direction-specific CSS. Both shells pin to the viewport
// height and scroll the content region within it (the model the desktop shell always had,
// extended to mobile for the assistant's pinned composer, owner ask 2026-08): the rail never
// moves, and a screen that wants an inner scrolling pane — the chat — gets a height-bounded
// column to build it in (the content wrapper is a min-h-full
// flex column, so a screen opts in with flex-1 min-h-0 and every other screen just flows).
export function AppLayout() {
  const { principal } = useSession()

  // RequireAuth guarantees a principal before this renders; the check narrows the type.
  if (!principal) {
    return null
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* The navigation rail — the inline-start column at every width (74px of icons on a
          phone, 240px of rows from md). */}
      <SideNav principal={principal} />

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
            // The frame's own breathing room. The Counter's 30px is the measure at the width
            // it was drawn for; it reads mean once the window is wide, so the inset steps up
            // with the monitor (owner call 2026-08-16) — 16px phone, 30px desktop, 40px from
            // `xl`, 56px from `2xl`. The top follows so the page title never sits tighter to
            // the chrome than the content does to the rail.
            'flex min-h-full flex-col p-4 has-[[data-fills-shell]]:h-full md:px-[30px] md:pt-[26px] md:pb-12',
            'xl:px-10 xl:pt-8 2xl:px-14 2xl:pt-10',
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
    </div>
  )
}
