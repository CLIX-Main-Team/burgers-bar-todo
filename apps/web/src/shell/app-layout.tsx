import { Outlet } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { useSession } from '../auth/session.js'
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
//  - **Below `md`** — the phone shell, unchanged: a sticky AppHeader that clears the notch,
//    a single readable column capped at --bb-content-max, and a fixed bottom TabBar that
//    clears the home indicator. Everything the header and bar own is authored phone-first.
//  - **From `md`** — a two-region row: a persistent SideNav (fixed --bb-sidenav) at the
//    inline-start owns the brand, the two role-invariant destinations, and the account
//    block, beside a content region capped at --bb-content-wide and centred. The mobile
//    header and TabBar collapse (md:hidden); each screen's own content-header owns its
//    primary action (so the mobile FAB has no desktop counterpart here — that is each
//    screen's concern, #176). The role-gated admin destinations move into the nav in the
//    next ticket; for now managers reach them through the account foot menu.
//
// The whole thing is logical-property-only (ms/me/ps/pe, border-inline, inset-inline) so a
// single definition mirrors: the side nav sits at the inline-start — the right in Hebrew,
// the left in English — with no direction-specific CSS. On desktop the row is pinned to the
// viewport height and the content region scrolls within it, so the nav stays put; on mobile
// the document scrolls as before.
export function AppLayout() {
  const t = useTranslations()
  const { principal } = useSession()

  // RequireAuth guarantees a principal before this renders; the check narrows the type.
  if (!principal) {
    return null
  }

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:flex-row md:overflow-hidden">
      {/* Desktop side nav — inline-start column, hidden below md. */}
      <SideNav principal={principal} />

      {/* Mobile header — hidden from md, where the side nav owns brand + account. */}
      <header className="sticky top-0 z-10 border-b border-border bg-card pt-[env(safe-area-inset-top)] md:hidden">
        <div className={cn(CONTENT_COLUMN, 'flex items-center justify-between gap-2 p-4')}>
          <p className="font-semibold text-foreground">{t('common.appName')}</p>
          <AccountMenu principal={principal} />
        </div>
      </header>

      {/* Content region — scrolls within the pinned desktop row; the inner column caps at
          30rem on mobile and widens to 70rem centred from md. */}
      <main className="flex-1 md:min-h-0 md:overflow-y-auto">
        <div className={cn(CONTENT_INNER, 'p-4 md:px-6 md:pt-8 md:pb-12')}>
          <Outlet />
        </div>
      </main>

      {/* Mobile tab bar — hidden from md, replaced by the side nav. */}
      <TabBar className="md:hidden" />
    </div>
  )
}
