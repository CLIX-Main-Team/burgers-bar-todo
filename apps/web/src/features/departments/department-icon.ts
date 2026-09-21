import type { IconRole } from '../../components/ui/icon-registry.js'

// The mark for a department, by the slug the seed gave it (migration 0050). Slugs are the one
// stable handle on the seven: ids are minted per database and names follow the UI language, so
// neither can key a picture. An unknown slug wears the plain briefcase rather than nothing, so a
// department added later still reads as a department until someone draws it a mark.
const DEPARTMENT_ICON: Record<string, IconRole> = {
  management: 'department-management',
  operations: 'department-operations',
  procurement: 'department-procurement',
  marketing: 'department-marketing',
  call_center: 'department-call-center',
  finance: 'department-finance',
  customer_service: 'department-customer-service',
}

export function departmentIconName(slug: string): IconRole {
  return DEPARTMENT_ICON[slug] ?? 'change-department'
}
