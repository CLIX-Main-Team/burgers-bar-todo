import { type Department, departmentLabel } from '@burgers/shared'
import { useQuery } from '@tanstack/react-query'
import { useLocale } from '../../i18n/locale.js'
import { departmentsApi } from '../../lib/api.js'

// The one query key for the chain's departments (GET /departments, 2026-09-20). The invite
// picker, the roster and the Tasks page's chips all read this single key, and it never
// invalidates: the list is seeded by migration and not editable in the app, so once read it is
// the truth for the session.
export const DEPARTMENTS_QUERY_KEY = ['departments'] as const

async function fetchDepartments(): Promise<Department[]> {
  const response = await departmentsApi.list()
  return response.departments
}

// The shared department-list query, ordered as the API orders it (the client's own order).
// Returns the raw query so a consumer can branch on pending/error for its own empty and failed
// states; the endpoint is open to any signed-in person, so no `enabled` gate is needed.
export function useDepartments() {
  return useQuery({
    queryKey: DEPARTMENTS_QUERY_KEY,
    queryFn: fetchDepartments,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

// The printable name of a department in the UI language, and null for an id the list does not
// hold (or while it is still loading), so a caller prints nothing rather than a raw uuid.
export function useDepartmentName(): (departmentId: string | null | undefined) => string | null {
  const { locale } = useLocale()
  const { data } = useDepartments()
  return (departmentId) => {
    if (!departmentId) return null
    const department = data?.find((candidate) => candidate.id === departmentId)
    return department ? departmentLabel(department, locale) : null
  }
}
