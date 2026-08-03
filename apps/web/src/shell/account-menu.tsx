import type { PrincipalResponse } from '@burgers/shared'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslations } from 'use-intl'
import { canProvision } from '../auth/roles.js'
import { useSession } from '../auth/session.js'
import { LanguageToggle } from '../components/language-toggle.js'
import { ThemeToggle } from '../components/theme-toggle.js'
import { Button } from '../components/ui/button.js'
import { roleLabelKey } from '../i18n/labels.js'

// The header avatar and its account menu (Ticket 2). The non-tab surfaces — the
// signed-in identity, the language toggle, and the logout actions — live here rather
// than in the tab bar or inline in the header, so the everyday chrome stays down to two
// tabs and an avatar (PRD, story 6). This is the final home for what Ticket 1 kept
// temporarily inline.
//
// It is built from the app's own primitives (Button, LanguageToggle) rather than a menu
// library: a trigger button that toggles a popover panel, closing on Escape or a click
// outside. The panel is a labelled group, not a strict WAI menu, because it mixes
// read-only identity text and a toggle with the two logout actions.
//
// Identity is the role we read from /auth/me (there is no name or email on the
// principal, and this slice adds no API): enough to confirm the right account is signed
// in on a shared device. Manage users appears only for admin/manager, and that gating is
// presentation only — the API authorises every /people request regardless (ADR-0007).
export function AccountMenu({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  const { signOut, signOutAll } = useSession()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  const logout = useMutation({ mutationFn: signOut })
  const logoutAll = useMutation({ mutationFn: signOutAll })
  const busy = logout.isPending || logoutAll.isPending

  // UI-only gating (ADR-0007): the entry is a convenience, not the security boundary.
  const showManageUsers = canProvision(principal)

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
      <button
        type="button"
        aria-label={t('app.account')}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex size-11 items-center justify-center rounded-full border border-input bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring focus-visible:ring-offset-background"
      >
        {/* A generic person glyph: the principal carries no name or photo to key an
            avatar off, so the icon is decorative and the button is named for a11y. */}
        <svg
          viewBox="0 0 24 24"
          className="size-6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20a8 8 0 0 1 16 0" />
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute end-0 z-20 mt-2 flex w-64 max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-lg"
        >
          <p className="text-sm text-muted-foreground">
            {t('app.signedInAs', { role: t(roleLabelKey(principal.role)) })}
          </p>

          {/* The theme toggle sits above the language toggle, both the same segmented
              control (ui-flow: a labelled row above the language toggle). */}
          <ThemeToggle />
          <LanguageToggle />

          {showManageUsers && (
            <Link
              to="/people"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-[44px] items-center rounded-md px-1 text-sm font-medium text-foreground underline-offset-2 hover:underline"
            >
              {t('app.manageUsers')}
            </Link>
          )}

          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                logout.mutate()
              }}
            >
              {t('app.logout')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                logoutAll.mutate()
              }}
            >
              {t('app.logoutAll')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
