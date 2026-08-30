import type { PrincipalResponse } from '@burgers/shared'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { canProvision, hasCapability } from '../auth/roles.js'
import { useSession } from '../auth/session.js'
import { LanguageToggle } from '../components/language-toggle.js'
import { ThemeToggle } from '../components/theme-toggle.js'
import { Icon } from '../components/ui/icon.js'
import { roleLabelKey } from '../i18n/labels.js'
import { cn } from '../lib/cn.js'

// The account menu, recut to The Counter's compact settings popover (round 8, 2026-08-14):
// the signed-in identity, a slim Users menu row (the oversized bordered button of #291 is
// gone), the Day/Night and language segments under small overlines, and one quiet Log out.
// "Log out of all devices" is removed entirely (owner call, rev 2) — one everyday action,
// nothing to misclick. One component serves both shells:
//
// One component, one placement: the rail's account foot at both measures (the phone header
// it used to also serve is gone with the v2 shell).
//
// It is built from the app's own primitives rather than a menu library: a trigger that
// toggles a popover panel, closing on Escape or a click outside. The panel is a labelled
// group, not a strict WAI menu, because it mixes read-only identity text and toggles with
// the navigation row and the logout action.
//
// Identity is the name and role from /auth/me (the principal carries the display name since
// the v2 handoff): enough to confirm the right account is signed in on a shared device.
// The role-gated Users row is presentation only — the API authorises every request
// regardless (ADR-0007).

interface AccountMenuProps {
  principal: PrincipalResponse
}

export function AccountMenu({ principal }: AccountMenuProps) {
  const t = useTranslations()
  const { signOut } = useSession()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const logout = useMutation({ mutationFn: signOut })

  const roleLabel = t(roleLabelKey(principal.role))
  // The phone rail is 74px wide, so the trigger prints one word: whatever the person's name
  // starts with. Split on whitespace, never on a fixed character count, so a Hebrew or an
  // English name both cut at a word rather than mid-glyph.
  const firstName = principal.displayName.split(' ')[0]

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
      {/* One trigger at both measures: a coin over the first name where the rail is 74px
          wide, and the coin beside the full name and role from md. It sits on the nav
          surface, so it reads through the nav-* inks. */}
      <button
        type="button"
        aria-label={t('app.account')}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full flex-col items-center gap-1.5 rounded-md px-1 py-1.5 text-nav-ink hover:bg-nav-active/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-nav-gold md:flex-row md:gap-2.5 md:px-2 md:text-start"
      >
        <span className="grid size-8 flex-none place-items-center rounded-full bg-nav-active text-nav-gold">
          {/* Decorative — the principal carries no photo; the button's aria-label and the
              name beside it carry the meaning. */}
          <Icon name="account" />
        </span>
        {/* The phone rail has room for one word, so it takes the first name. */}
        <span dir="auto" className="max-w-full truncate text-caption text-nav-muted md:hidden">
          {firstName}
        </span>
        <span className="hidden min-w-0 flex-col md:me-auto md:flex">
          <span dir="auto" className="truncate text-body font-semibold leading-tight">
            {principal.displayName}
          </span>
          <span className="truncate text-caption leading-tight text-nav-muted">{roleLabel}</span>
        </span>
        {/* The gear signals "account settings"; decorative, the label names the control. */}
        <Icon name="settings" className="hidden text-nav-muted md:block" />
      </button>

      {open && (
        <>
          {/* The phone sheet dims the screen behind it the way every other overlay does; on
              desktop the panel is a small popover and needs no wash. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-40 cursor-default bg-scrim md:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            id={panelId}
            className={cn(
              'flex flex-col border border-border bg-popover p-2 text-popover-foreground shadow-lg',
              // Phone: a sheet across the bottom edge, clearing the home indicator. From md it
              // becomes the popover rising from the rail foot, aligned to the rail's start.
              'fixed inset-x-0 bottom-0 z-50 rounded-t-2xl pb-[max(0.5rem,var(--bb-safe-bottom))]',
              'md:absolute md:inset-auto md:bottom-full md:start-0 md:z-20 md:mb-2 md:w-[15.25rem] md:max-w-[calc(100vw-2rem)] md:rounded-xl md:pb-2',
            )}
          >
            {/* Identity block, divided from the rows below. The testid keeps the e2e's
              identity assertion off the same role word the nav foot also prints. */}
            <div
              data-testid="account-identity"
              className="border-b border-border px-2.5 pt-1.5 pb-2.5"
            >
              <p className="text-caption text-muted-foreground">{t('app.signedInLabel')}</p>
              <p dir="auto" className="text-body font-semibold text-foreground">
                {principal.displayName}
              </p>
              <p className="text-caption text-muted-foreground">{roleLabel}</p>
            </div>

            {/* Users as a slim menu row (The Counter, rev 2 — the bordered min-h-11 button
              read too big), gated exactly as the old destination was. */}
            {canProvision(principal) && (
              <NavLink
                to="/people"
                onClick={() => setOpen(false)}
                className="mt-1.5 flex h-9 items-center gap-2.5 rounded-md px-2.5 text-body font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon name="manage-users" size="sm" />
                {t('common.navUsers')}
                <Icon name="row-forward" size="sm" className="ms-auto text-muted-foreground" />
              </NavLink>
            )}

            {/* Access — the role-capability map (owner ask 2026-08-24), the chain owner's alone
              since 2026-08-25. A hidden page hides its way in too, so the row goes with it. */}
            {hasCapability(principal, 'page.access') && (
              <NavLink
                to="/access"
                onClick={() => setOpen(false)}
                className={cn(
                  'flex h-9 items-center gap-2.5 rounded-md px-2.5 text-body font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  !canProvision(principal) && 'mt-1.5',
                )}
              >
                <Icon name="role" size="sm" />
                {t('common.navAccess')}
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
        </>
      )}
    </div>
  )
}
