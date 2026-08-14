import type { PrincipalResponse } from '@burgers/shared'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { canProvision } from '../auth/roles.js'
import { useSession } from '../auth/session.js'
import { LanguageToggle } from '../components/language-toggle.js'
import { ThemeToggle } from '../components/theme-toggle.js'
import { Icon } from '../components/ui/icon.js'
import { roleLabelKey } from '../i18n/labels.js'
import { cn } from '../lib/cn.js'

// The account menu, recut to The Counter's compact settings popover (round 8, 2026-08-14):
// the signed-in identity, a slim People menu row (the oversized bordered button of #291 is
// gone), the Day/Night and language segments under small overlines, and one quiet Log out.
// "Log out of all devices" is removed entirely (owner call, rev 2) — one everyday action,
// nothing to misclick. One component serves both shells:
//
//  - `header` (mobile, the default): the avatar button in the black AppHeader opens the
//    panel dropping *down* from the top-inline-end.
//  - `foot` (desktop): the account row at the bottom of the side nav opens the same panel
//    *rising* from the foot.
//
// It is built from the app's own primitives rather than a menu library: a trigger that
// toggles a popover panel, closing on Escape or a click outside. The panel is a labelled
// group, not a strict WAI menu, because it mixes read-only identity text and toggles with
// the navigation row and the logout action.
//
// Identity is the role we read from /auth/me (the principal carries no name or email, and
// this adds no API): enough to confirm the right account is signed in on a shared device.
// The role-gated People row is presentation only — the API authorises every request
// regardless (ADR-0007).

interface AccountMenuProps {
  principal: PrincipalResponse
  /** Which shell the menu lives in: the mobile header (default) or the desktop nav foot. */
  placement?: 'header' | 'foot'
}

export function AccountMenu({ principal, placement = 'header' }: AccountMenuProps) {
  const t = useTranslations()
  const { signOut } = useSession()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const logout = useMutation({ mutationFn: signOut })

  const roleLabel = t(roleLabelKey(principal.role))

  // While open, dismiss on a click outside the menu or on Escape — the two ways a user
  // expects a lightweight popover to close without picking one of its actions.
  useEffect(() => {
    if (!open) {
      return
    }
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      {placement === 'foot' ? (
        // The desktop foot trigger: the account Avatar, the role, and a gear, filling the
        // foot row. It sits on the fixed black nav, so it reads through the nav-* inks —
        // the gold-washed disc matching the active row's wash. The gear signals the
        // settings this opens; the button's aria-label names the control.
        <button
          type="button"
          aria-label={t('app.account')}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-nav-ink hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-gold"
        >
          <span className="grid size-[30px] flex-none place-items-center rounded-full bg-nav-active text-nav-gold">
            {/* Decorative — the principal carries no name or photo; the button's aria-label
                names the control. */}
            <Icon name="account" />
          </span>
          <span className="me-auto text-body font-semibold">{roleLabel}</span>
          {/* The gear signals "account settings"; decorative, the label names the control. */}
          <Icon name="settings" className="text-nav-muted" />
        </button>
      ) : (
        // The mobile header trigger, on the brand-black header both themes now (The
        // Counter, rev 4): the gold-washed disc in the fixed nav inks, ringed so it holds
        // an edge on the black.
        <button
          type="button"
          aria-label={t('app.account')}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex size-[34px] items-center justify-center rounded-full border border-white/20 bg-nav-active text-nav-gold hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-gold"
        >
          {/* A generic person glyph through the registry (iconography.md, ADR-0020): the
              principal carries no name or photo to key an avatar off, so it is decorative and
              the button's aria-label names the control. */}
          <Icon name="account" size="lg" />
        </button>
      )}

      {open && (
        <div
          id={panelId}
          className={cn(
            'absolute z-20 flex w-[244px] max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-lg',
            // The header panel drops from the top-inline-end; the foot panel rises from the
            // foot, aligned to the nav column's inline-start.
            placement === 'foot' ? 'bottom-full start-0 mb-2' : 'end-0 mt-2',
          )}
        >
          {/* Identity block, divided from the rows below. The testid keeps the e2e's
              identity assertion off the same role word the nav foot also prints. */}
          <div
            data-testid="account-identity"
            className="border-b border-border px-2.5 pt-1.5 pb-2.5"
          >
            <p className="text-caption text-muted-foreground">{t('app.signedInLabel')}</p>
            <p className="text-body font-semibold text-foreground">{roleLabel}</p>
          </div>

          {/* People as a slim menu row (The Counter, rev 2 — the bordered min-h-11 button
              read too big), gated exactly as the old destination was. */}
          {canProvision(principal) && (
            <NavLink
              to="/people"
              onClick={() => setOpen(false)}
              className="mt-1.5 flex h-9 items-center gap-2.5 rounded-md px-2.5 text-body font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon name="manage-users" size="sm" />
              {t('common.navPeople')}
              <Icon name="row-forward" size="sm" className="ms-auto text-muted-foreground" />
            </NavLink>
          )}

          <div className="my-2 h-px bg-border" />

          {/* Theme and language as labelled segments — the overline names each control the
              way the artifact's popover draws it. */}
          <p className="px-2.5 pb-1 text-caption font-bold uppercase tracking-wider text-muted-foreground">
            {t('common.theme')}
          </p>
          <ThemeToggle className="mx-0.5 w-auto" />
          <p className="px-2.5 pt-2 pb-1 text-caption font-bold uppercase tracking-wider text-muted-foreground">
            {t('common.language')}
          </p>
          <LanguageToggle className="mx-0.5 w-auto" />

          <div className="my-2 h-px bg-border" />

          {/* One quiet Log out — the menu's only session action (logout-all is gone,
              owner call rev 2). */}
          <button
            type="button"
            disabled={logout.isPending}
            onClick={() => {
              setOpen(false)
              logout.mutate()
            }}
            className="flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-start text-body font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {/* Directional sign-out glyph (mirrored in RTL by the wrapper), decorative —
                the button text names the action. */}
            <Icon name="logout" size="sm" />
            {t('app.logout')}
          </button>
        </div>
      )}
    </div>
  )
}
