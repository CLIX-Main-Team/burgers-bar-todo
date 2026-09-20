import type { Department } from '@burgers/shared'
import { asc } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { departments } from '../db/schema.js'

// The data-access seam for Department (owner ask 2026-09-20). One read: the whole list, which is
// the client's seven in the client's order. There is no write path because the list is not
// editable in the app — migration 0049's seed is the table's only author. Deliberately unscoped:
// every signed-in person may know the chain's departments, whatever they may see inside them.
export interface DepartmentRepository {
  listDepartments(): Promise<Department[]>
}

export function createDepartmentRepository(db: Db): DepartmentRepository {
  return {
    listDepartments: async () =>
      db
        .select({
          id: departments.id,
          slug: departments.slug,
          nameHe: departments.nameHe,
          nameEn: departments.nameEn,
          position: departments.position,
        })
        .from(departments)
        .orderBy(asc(departments.position)),
  }
}
