import {
  OPENING_PROJECT_COLOUR,
  OPENING_PROJECT_ICON,
  OPENING_PROJECT_PHASE,
} from '@burgers/shared'
import { asc, desc, eq, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createDb } from './db/client.js'
import {
  locations,
  projectChecklistItems,
  projects,
  taskAssignees,
  taskChecklistItemAssignees,
  taskChecklistItems,
  tasks,
  users,
} from './db/schema.js'
import { loadRootEnv } from './load-env.js'

// One-off data reset for the client rollout (owner ask 2026-08-27, run against localhost and
// then production after PR merge): clear the demo tasks and projects, collapse the old demo
// branches into a single unnumbered testing branch that keeps every existing account, and
// create the chain's real 46 branches — unstaffed — from the client's own numbered sheet.
// Two generic testing projects are seeded back (one chain-wide, one on the testing branch),
// each with a 12-item checklist, so the Projects surface is testable without inventing data.
//
// Idempotent by construction rather than by flag: run twice, the second run finds the testing
// branch already the only survivor, the 46 already present (upserted by number), and reseeds
// the two testing projects fresh (they are deleted with every other project at the top).

const TESTING_BRANCH_NAME = 'סניף בדיקות'

// The client's branch sheet, verbatim (2026-08-27). #46 ראשונים is marked "not yet opened"
// on the sheet and is created like the rest — an unstaffed branch — until branch lifecycle
// states exist.
const BRANCHES: readonly { number: number; name: string }[] = [
  { number: 1, name: 'אילת ביג' },
  { number: 2, name: 'אילת פנינה' },
  { number: 3, name: 'אפרת' },
  { number: 4, name: 'אשדוד' },
  { number: 5, name: 'באר שבע' },
  { number: 6, name: 'בית שמש' },
  { number: 7, name: 'בן יהודה' },
  { number: 8, name: 'גבעת שאול' },
  { number: 9, name: 'גבעת שמואל' },
  { number: 10, name: 'גבעתיים' },
  { number: 11, name: 'גילה' },
  { number: 12, name: 'הגבעה הצרפתית' },
  { number: 13, name: 'הדסה עין כרם' },
  { number: 14, name: 'הרובע היהודי' },
  { number: 15, name: 'הרצליה' },
  { number: 16, name: 'חולון' },
  { number: 17, name: 'יפו' },
  { number: 18, name: 'מבשרת ציון' },
  { number: 19, name: 'מודיעין מליבו' },
  { number: 20, name: 'מודיעין עזריאלי' },
  { number: 21, name: 'מושבה גרמנית' },
  { number: 22, name: 'מחנה יהודה' },
  { number: 23, name: 'מלחה' },
  { number: 24, name: 'מעלה אדומים' },
  { number: 25, name: 'נתניה' },
  { number: 26, name: 'נתיבות' },
  { number: 27, name: 'עזריאלי תל אביב' },
  { number: 28, name: 'פסגת זאב' },
  { number: 29, name: 'פתח תקווה' },
  { number: 30, name: 'צור הדסה' },
  { number: 31, name: 'קניון הדר' },
  { number: 32, name: 'ראשון לציון' },
  { number: 33, name: 'רמות' },
  { number: 34, name: 'רמלה' },
  { number: 35, name: 'רמת אביב' },
  { number: 36, name: 'רמת בית שמש' },
  { number: 37, name: 'רעננה' },
  { number: 38, name: 'שערי צדק' },
  { number: 39, name: 'שדרות' },
  { number: 40, name: 'תחנה מרכזית' },
  { number: 41, name: 'תלפיות' },
  { number: 42, name: 'דן אילת' },
  { number: 43, name: 'מצפה רמון' },
  { number: 44, name: 'הר חומה' },
  { number: 45, name: 'באר יעקב' },
  { number: 46, name: 'ראשונים' },
]

const CHECKLIST_SIZE = 12

const envSchema = z.object({ DATABASE_URL: z.string().url() })

async function main(): Promise<void> {
  loadRootEnv()
  const env = envSchema.parse(process.env)
  const { db, pool } = createDb(env.DATABASE_URL)

  try {
    await db.transaction(async (tx) => {
      // 1. All demo work goes. Child tables first — the FKs carry no cascade (by design,
      // schema.ts) — and the project checklists ride their own cascade but are named anyway
      // so this list reads as the complete answer to "what does the reset delete".
      await tx.delete(taskChecklistItemAssignees)
      await tx.delete(taskChecklistItems)
      await tx.delete(taskAssignees)
      await tx.delete(tasks)
      await tx.delete(projectChecklistItems)
      await tx.delete(projects)

      // 2. The surviving testing branch: the one already carrying that name if a previous run
      // made it, else the branch with the most people (their new shared home should displace
      // the fewest), else the oldest branch, else a fresh row when the table is empty.
      const named = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.name, TESTING_BRANCH_NAME))
        .limit(1)
      const byStaff = named[0]
        ? []
        : await tx
            .select({ id: locations.id, staff: sql<number>`count(${users.id})::int` })
            .from(locations)
            .leftJoin(users, eq(users.locationId, locations.id))
            .groupBy(locations.id)
            .orderBy(desc(sql`count(${users.id})`), asc(locations.createdAt))
            .limit(1)
      let keepId = named[0]?.id ?? byStaff[0]?.id
      if (keepId === undefined) {
        const created = await tx
          .insert(locations)
          .values({ name: TESTING_BRANCH_NAME })
          .returning({ id: locations.id })
        keepId = created[0]?.id
        if (keepId === undefined) throw new Error('reset: could not create the testing branch')
      }
      await tx
        .update(locations)
        .set({
          name: TESTING_BRANCH_NAME,
          number: null,
          address: null,
          city: null,
          phone: null,
          updatedAt: new Date(),
        })
        .where(eq(locations.id, keepId))

      // 3. Every branch-holding account moves to the testing branch (super_admins hold none
      // and stay that way), then every other old branch — now empty of people, work and
      // projects — is deleted.
      const moved = await tx
        .update(users)
        .set({ locationId: keepId, updatedAt: new Date() })
        .where(sql`${users.locationId} is not null and ${users.locationId} <> ${keepId}::uuid`)
        .returning({ id: users.id })
      const removed = await tx
        .delete(locations)
        .where(ne(locations.id, keepId))
        .returning({ id: locations.id })

      // 4. The real chain, upserted by number so a re-run refreshes names instead of
      // duplicating rows.
      for (const branch of BRANCHES) {
        await tx
          .insert(locations)
          .values({ name: branch.name, number: branch.number })
          .onConflictDoUpdate({
            target: locations.number,
            set: { name: branch.name, updatedAt: new Date() },
          })
      }

      // 5. The two testing projects, authored by the earliest super_admin (production's owner
      // account; the fixture cast's ada on localhost). Skipped with a warning when none exists,
      // since projects.created_by must reference a real user.
      const owner = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.role, 'super_admin'))
        .orderBy(asc(users.createdAt))
        .limit(1)
      const ownerId = owner[0]?.id
      if (ownerId === undefined) {
        console.warn('reset: no super_admin account found, skipping the testing projects.')
      } else {
        const seedProject = async (name: string, locationIds: string[]) => {
          const rows = await tx
            .insert(projects)
            .values({
              name,
              locationIds,
              // Visible to all four roles so any test account can open it.
              roles: ['super_admin', 'admin', 'manager', 'employee'],
              icon: OPENING_PROJECT_ICON,
              colour: OPENING_PROJECT_COLOUR,
              phase: OPENING_PROJECT_PHASE,
              startDate: new Date(),
              createdBy: ownerId,
            })
            .returning({ id: projects.id })
          const projectId = rows[0]?.id
          if (projectId === undefined) throw new Error(`reset: could not create "${name}"`)
          await tx.insert(projectChecklistItems).values(
            Array.from({ length: CHECKLIST_SIZE }, (_, index) => ({
              projectId,
              title: `Item ${index + 1}`,
              position: index,
            })),
          )
        }
        await seedProject('Testing Project (Chain)', [])
        await seedProject('Testing Project (Testing Branch)', [keepId])
      }

      console.log(
        `reset: cleared tasks and projects, kept "${TESTING_BRANCH_NAME}" (${moved.length} account(s) moved onto it), ` +
          `deleted ${removed.length} old branch(es), upserted ${BRANCHES.length} client branches, ` +
          `seeded 2 testing projects with ${CHECKLIST_SIZE} checklist items each.`,
      )
    })
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
