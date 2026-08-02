import type { PrincipalResponse } from '@burgers/shared'
import { useTranslations } from 'use-intl'
import { Card } from '../../components/ui/card.js'
import { InviteForm } from './invite-form.js'
import { UserList } from './user-list.js'

// The provisioning surface for an Admin or Manager: invite someone, and act on the
// people already in the list. Both halves are gated to admin/manager by the shell that
// renders this; the API enforces the finer scoping (a Manager's own Location, Admin-only
// deactivation) on every call.
export function PeopleManagement({ principal }: { principal: PrincipalResponse }) {
  const t = useTranslations()
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <InviteForm principal={principal} />
      </Card>
      <Card>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">{t('users.heading')}</h2>
        <UserList principal={principal} />
      </Card>
    </div>
  )
}
