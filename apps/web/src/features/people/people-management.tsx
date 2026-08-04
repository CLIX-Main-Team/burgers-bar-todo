import type { PrincipalResponse } from '@burgers/shared'
import { useRef } from 'react'
import { useTranslations } from 'use-intl'
import { Card } from '../../components/ui/card.js'
import { InviteForm } from './invite-form.js'
import { UserList } from './user-list.js'

// The provisioning surface for an Admin or Manager: invite someone, and read the people
// already on the board. The screen carries its own page heading (Slice U1's first-class
// shape #59 asked for) so the list below no longer borrows one. Both halves are gated to
// admin/manager by the shell that renders this; the API enforces the finer scoping (a
// Manager's own Location, Admin-only deactivation) on every call (ADR-0007).
export function PeopleManagement({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  // The empty roster's "Invite someone" CTA points here. Slice A keeps the invite form as a
  // sibling card above the list (the Sheet/drawer is Slice C), so the CTA scrolls it into view
  // and drops focus on its first field — a real affordance, not a dead button.
  const inviteRef = useRef<HTMLDivElement | null>(null)
  const focusInvite = () => {
    inviteRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    inviteRef.current?.querySelector<HTMLElement>('input, button, [tabindex]')?.focus()
  }

  return (
    // Stacked, not two-up: the shell caps content at one readable ~30rem column even on a
    // wide screen (frame.ts), so the invite action sits above the list rather than beside
    // it — a side-by-side split would squeeze both halves into unreadable half-columns.
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">{t('users.heading')}</h1>
      <div ref={inviteRef}>
        <Card>
          <InviteForm principal={principal} />
        </Card>
      </div>
      <Card>
        <UserList principal={principal} onInvite={focusInvite} />
      </Card>
    </div>
  )
}
