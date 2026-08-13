import type { PrincipalResponse } from '@burgers/shared'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslations } from 'use-intl'
import { useSession } from '../auth/session.js'
import { LanguageToggle } from '../components/language-toggle.js'
import { ThemeToggle } from '../components/theme-toggle.js'
import { AlertDialog } from '../components/ui/alert-dialog.js'
import { Button } from '../components/ui/button.js'
import { Icon } from '../components/ui/icon.js'
import { roleLabelKey } from '../i18n/labels.js'
import { cn } from '../lib/cn.js'

// The account menu: the signed-in identity, the theme and language toggles, and the logout
// actions, gathered off the everyday chrome so it stays down to two destinations (PRD,
// story 6). One component serves both shells:
//
//  - `header` (mobile, the default): the avatar button in the sticky AppHeader opens the
//    panel dropping *down* from the top-inline-end. This is the built mobile behaviour,
//    unchanged.
//  - `foot` (desktop): an account row at the bottom of the side nav opens the same panel
//    *rising* from the foot — the desktop equivalent of the mobile popover (shell spec #175).
//    Only the trigger and rise direction differ from the header. Neither placement carries
//    nav rows any more: the side nav owns People/Locations on desktop (Ticket B, #209) and
//    the tab bar owns them on mobile (owner call 2026-08), so the menu never offers a second
//    door to the same place.
//
// It is built from the app's own primitives (Button, the toggles) rather than a menu
// library: a trigger that toggles a popover panel, closing on Escape or a click outside.
// The panel is a labelled group, not a strict WAI menu, because it mixes read-only identity
// text and toggles with the logout actions.
//
// Identity is the role we read from /auth/me (the principal carries no name or email, and
// this adds no API): enough to confirm the right account is signed in on a shared device.
// The role-gated links are presentation only — the API authorises every request regardless
// (ADR-0007).

interface AccountMenuProps {
  principal: PrincipalResponse
  /** Which shell the menu lives in: the mobile header (default) or the desktop nav foot. */
  placement?: 'header' | 'foot'
}

export function AccountMenu({ principal, placement = 'header' }: AccountMenuProps) {
  const t = useTranslations()
  const { signOut, signOutAll } = useSession()
  const [open, setOpen] = useState(false)
  // Log out of all devices asks first (owner call 2026-08): the row sat one tap under the everyday
  // Log out as its twin, and a misclick there revokes every session — the menu-then-AlertDialog
  // shape every other destructive action already uses makes a stray tap cost nothing.
  const [confirmingLogoutAll, setConfirmingLogoutAll] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const logout = useMutation({ mutationFn: signOut })
  const logoutAll = useMutation({ mutationFn: signOutAll })
  const busy = logout.isPending || logoutAll.isPending

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
        // foot row. It sits on the fixed black nav (design refresh 2026-08-12), so it reads
        // through the nav-* inks, not the theme tokens — the gold-washed disc matching the
        // active row's wash. The gear signals the settings this opens; the button's
        // aria-label names the control for assistive tech.
        <button
          type="button"
          aria-label={t('app.account')}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-start text-nav-ink hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-gold"
        >
          <span className="grid size-8 flex-none place-items-center rounded-full bg-nav-active text-nav-gold">
            {/* Decorative — the principal carries no name or photo; the button's aria-label
                names the control. */}
            <Icon name="account" />
          </span>
          <span className="me-auto text-sm font-semibold">{roleLabel}</span>
          {/* The gear signals "account settings"; decorative, the label names the control. */}
          <Icon name="settings" className="text-nav-muted" />
        </button>
      ) : (
        <button
          type="button"
          aria-label={t('app.account')}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex size-11 items-center justify-center rounded-full border border-border-strong bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring focus-visible:ring-offset-background"
        >
          {/* A generic person glyph through the registry (iconography.md, ADR-0020): the
              principal carries no name or photo to key an avatar off, so it is decorative and
              the button's aria-label names the control. `lg` matches the former inline svg. */}
          <Icon name="account" size="lg" />
        </button>
      )}

      {open && (
        <div
          id={panelId}
          className={cn(
            'absolute z-20 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg',
            // The header panel drops from the top-inline-end; the foot panel rises from the
            // foot, aligned to the nav column's inline-start.
            placement === 'foot' ? 'bottom-full start-0 mb-2' : 'end-0 mt-2',
          )}
        >
          <p className="text-sm text-muted-foreground">
            {t('app.signedInAs', { role: roleLabel })}
          </p>

          {/* The theme toggle sits above the language toggle, both the same segmented
              control (ui-flow: a labelled row above the language toggle). */}
          <ThemeToggle />
          <LanguageToggle />

          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="gap-2"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                logout.mutate()
              }}
            >
              {/* Directional sign-out glyph (mirrored in RTL by the wrapper), decorative —
                  the button text names the action. */}
              <Icon name="logout" />
              {t('app.logout')}
            </Button>
            {/* Quieter than its Log out twin (ghost, muted) so the everyday action and the
                revoke-everything one stop reading as interchangeable; the tap only opens the
                confirmation, so a misclick is recoverable. */}
            <Button
              variant="ghost"
              className="gap-2 text-muted-foreground"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                setConfirmingLogoutAll(true)
              }}
            >
              <Icon name="logout" />
              {t('app.logoutAll')}
            </Button>
          </div>
        </div>
      )}

      {/* Confirm before revoking every session (this device included). On confirm the session
          clears and the app returns to login, unmounting this tree — no explicit close needed on
          the success path; signOutAll never throws (best-effort contract). */}
      <AlertDialog
        open={confirmingLogoutAll}
        title={t('app.logoutAllConfirmTitle')}
        description={t('app.logoutAllConfirmBody')}
        confirmLabel={t('app.logoutAll')}
        cancelLabel={t('common.cancel')}
        confirmDisabled={logoutAll.isPending}
        onCancel={() => setConfirmingLogoutAll(false)}
        onConfirm={() => logoutAll.mutate()}
      />
    </div>
  )
}
