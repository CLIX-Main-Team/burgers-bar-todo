import { useTranslations } from 'use-intl'
import { Card } from '../../components/ui/card.js'
import { LocationForm } from './location-form.js'
import { LocationList } from './location-list.js'

// The admin Locations surface (Slice L2, #165): see every branch, add one, rename one inline. A
// single-purpose admin screen, gated to admins by the route (RequireAdmin) with the API the real
// authority (ADR-0007). Stacked, not two-up — the shell caps content at one readable column
// (frame.ts), so the create card sits above the list rather than beside it, the same shape
// PeopleManagement takes.
export function LocationManagement() {
  const t = useTranslations()
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">{t('locations.heading')}</h1>
      <Card>
        <LocationForm />
      </Card>
      <Card>
        <LocationList />
      </Card>
    </div>
  )
}
