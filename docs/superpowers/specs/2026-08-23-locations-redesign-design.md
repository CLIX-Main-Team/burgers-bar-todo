# Locations redesign: a per-branch admin role and a branch detail dashboard

Date: 2026-08-23
Branch: `feat/locations-page`
Status: approved, ready for planning

## Why

Two things are true today that the owner wants changed.

`super_admin` exists in the schema but is a twin of `admin`. It was added with the v2 design on
2026-08-20 and `packages/shared/src/index.ts` says so plainly: both roles are chain wide, both hold
a null `location_id`, and every site asks `isChainAdmin(role)` so the two cannot drift. The role was
created in anticipation of a divergence that never happened. This spec is that divergence.

A branch is only a name. `locations` carries `id`, `name`, `created_at`, `updated_at` and nothing
else, so "edit the branch" today means one text field, and the Locations page is a table over a
single column with two actions hanging off a dialog.

## Decisions

Settled with the owner before this document was written.

1. The role change is enforced for real, everywhere it matters, not just on the Locations page. A
   boundary enforced on one page and not the others is not a boundary.
2. It lands as two pull requests: the role model first, the redesign on top of it.
3. An admin holds **exactly one** branch, reusing the existing `users.location_id` column. No join
   table, no regional admins.
4. A branch admin is the **owner of their branch**: inside it they do everything a super_admin can.
   They cannot create a branch, delete a branch, appoint another admin, or see any branch but their
   own. super_admin owns the chain.
5. A branch gains **address, city, phone**, and nothing else. No opening hours, no operating status,
   no photo, no notes. Leadership is displayed on the branch page but stays owned by People.
6. The branch detail surface is **its own route**, `/locations/:id`.

## Out of scope

Opening hours, operating status, branch photos, free text notes, assigning managers from the branch
page, and any regional or multi branch admin. Each was considered and cut.

---

# PR 1: the role model

## 1.1 A live bug this PR must fix

`apps/api/src/assistant/document-metadata.ts` maps sensitivities to roles:

```ts
const ROLES_BY_SENSITIVITY: Record<Sensitivity, readonly Role[]> = {
  general: ['admin', 'manager', 'employee'],
  internal: ['admin', 'manager'],
  confidential: ['admin'],
}
```

`super_admin` appears in none of the three rows, so `sensitivitiesVisibleTo('super_admin')` returns
an empty array and every document is filtered out of retrieval for that role. A super_admin cannot
read the knowledge base at all, in production, right now. This is the merge order collision between
`fix/rag-hardening` and `feat/design-v2` that was flagged when both were in flight. `super_admin`
joins `admin` on all three rows.

## 1.2 The predicate split

`isChainAdmin` answers two different questions with one function, so it is replaced by two and then
deleted. It is not kept as an alias: deleting it makes the compiler find every call site, and no
site can quietly keep the old ambiguous meaning.

```ts
// Chain wide authority. Create and delete branches, appoint branch admins, see every branch.
export function isSuperAdmin(role: Role): boolean {
  return role === 'super_admin'
}

// Admin level power over the branch in question. Edit the branch record, invite and deactivate
// managers and employees, run the board.
export function hasAdminAuthority(role: Role): boolean {
  return role === 'admin' || role === 'super_admin'
}
```

## 1.3 Every call site, classified

Every place across the two apps that asks the question, listed with the question it is really
asking. Deleting `isChainAdmin` is what guarantees this table is complete: the build fails until
each one has been classified.

### API

| Site | Becomes |
|---|---|
| `auth/invite-service.ts:81` (who may invite) | `hasAdminAuthority`, plus a new branch check: an admin may only invite into their own `locationId`, and only a super_admin may invite an `admin` or a `super_admin` |
| `auth/invite-service.ts:82` (invitee is branch less) | `isSuperAdmin(input.role)`. Only a super_admin is branch less |
| `auth/repository.ts:351` (`listUsers` scope) | `isSuperAdmin`. An admin now falls into the existing `eq(users.locationId, scope.locationId)` path beside a manager |
| `auth/repository.ts:482` (`inviteScopePredicate`) | Three way: super_admin gets a tautology; admin gets `eq(users.locationId, scope.locationId)` with any role below super_admin; manager keeps `employee` at their own location |
| `task-board/task-write-service.ts:127` (must name a location) | `isSuperAdmin`. An admin now resolves their own location like a manager |
| `task-board/scope.ts` (board rows) | super_admin returns the tautology; admin returns `eq(tasks.locationId, principal.locationId)`; manager and employee unchanged |
| `routes/locations.ts:47` (`createRequireRole('admin')`) | Split per route, see 1.4 |
| `auth/require-auth.ts:81` (the `admin` implies `super_admin` expansion) | Removed. This is the line the comment predicted would go on the day the roles diverged |
| `assistant/document-metadata.ts:18` | `super_admin` added to all three sensitivity rows |

### Web (presentation gating only, ADR-0007 keeps the API authoritative)

| Site | Becomes |
|---|---|
| `auth/roles.ts:11` `canProvision` | `hasAdminAuthority(role) || role === 'manager'`, unchanged in effect |
| `auth/roles.ts:21` `canManageLocations` | `hasAdminAuthority`. A branch admin reaches `/locations`, it just resolves to their own branch |
| `routes/guards.tsx:55` `RequireAdmin` | `hasAdminAuthority` |
| `features/dashboard/dashboard-screen.tsx:53` | `isSuperAdmin`. The branch league table is a chain view and a branch admin has one branch |
| `features/people/invite-form.tsx:43` | `hasAdminAuthority` for reaching the full form |
| `features/people/invite-form.tsx:60` `needsLocation` | True for admin, manager and employee alike. False only for super_admin |
| `features/people/invite-form.tsx:100` | `isSuperAdmin(values.role) ? null : values.locationId` |
| `features/people/people-management.tsx:31` | `hasAdminAuthority` for the role filter tabs |
| `features/tasks/task-form-dialog.tsx:232` | `isSuperAdmin`. Only a super_admin picks a target branch |
| `features/tasks/tasks-screen.tsx:129` | `isSuperAdmin`. Grouping by branch only means something chain wide |

The invite form gains one more rule: the role select offers `super_admin` and `admin` only to a
super_admin. A branch admin sees `manager` and `employee`, with the branch fixed to their own and
shown read only, exactly the treatment a manager already gets.

## 1.4 The locations API

The single `requireAdmin` guard is replaced by two guards used per route.

| Route | Guard | Scope |
|---|---|---|
| `GET /locations` | `hasAdminAuthority` | super_admin gets the table; admin gets an array holding their one branch |
| `POST /locations` | `isSuperAdmin` | Unchanged otherwise |
| `PATCH /locations/:id` | `hasAdminAuthority` | super_admin any row; admin only their own, otherwise 404 |
| `POST /locations/:id/delete` | `isSuperAdmin` | Keeps the 409 `location_in_use` guard and its transaction |

A branch admin asking for a branch that is not theirs gets **404, not 403**, matching the non
enumerating answer the location scoped board writes already use. A 403 would confirm the branch
exists and let them map the chain by walking ids.

## 1.5 Schema and migration

A new check constraint makes the invariant structural rather than a rule the service remembers:

- `role = 'super_admin'` implies `location_id IS NULL`
- `role IN ('admin', 'manager', 'employee')` implies `location_id IS NOT NULL`

The migration runs in this order:

1. `UPDATE users SET role = 'super_admin' WHERE role = 'admin'`. Every existing admin is chain wide
   and branch less today, so promoting them is the only move that satisfies the new constraint
   without inventing a branch assignment. Nobody loses access on deploy day.
2. Assert no `manager` or `employee` row holds a null `location_id`. The column has always been
   nullable and only the service enforced the rule, so a legacy or seeded row could violate it and
   would fail step 3 in the middle of a deploy. The migration checks first and reports the offending
   ids rather than aborting on a constraint error.
3. Add the constraint.

Consequence, accepted by the owner: on deploy day the chain has zero branch admins. They are
appointed by hand from People, which now asks for a branch when the admin role is picked.

## 1.6 Tests

- `taskScopePredicate` returns a location filter for `admin` and a tautology for `super_admin`.
- `GET /locations` returns one row for an admin and the table for a super_admin.
- `PATCH /locations/:id` on another branch returns 404 for an admin.
- `POST /locations` and the delete route return 403 for an admin.
- The invite service refuses an admin inviting into another branch, and refuses an admin inviting
  an admin.
- `sensitivitiesVisibleTo('super_admin')` returns all three levels.
- The check constraint rejects a branch less admin and a branch holding super_admin.

---

# PR 2: the branch record and the redesign

## 2.1 Schema and contracts

`locations` gains `address`, `city`, `phone`, all `text` and all nullable. Nullable because every
row that exists today has none of them, and a rename must not become impossible until someone fills
in an address.

`locationSchema` grows the same three fields. `updateLocationRequestSchema` changes from `{ name }`
to a partial patch across all four, with `name` still refusing blank when present.

## 2.2 Routing

`/locations/:id` is added under the authenticated shell in `App.tsx`, behind the same
`RequireAdmin` guard the list uses. A branch admin hitting `/locations` is redirected to their own
`/locations/:id`, since a list of exactly one row is not worth a screen.

## 2.3 The branch detail page

The page reads three things it is already entitled to: the location record, the people list, and the
board. All three are existing queries on existing cache keys. No new read endpoint is added.

The metrics are not new either. `features/dashboard/dashboard-metrics.ts` exports
`shiftMetrics(tasks, now)` (total, done, inProgress, notStarted, open, dueToday, overdue,
percentDone) and `assigneeLoad(tasks)`. Filtering the board read to one `locationId` and passing it
through those same functions produces the whole page, so the branch dashboard and the Dashboard can
never disagree about a number.

### The plate that becomes the form

The header reads as a storefront plate: the gold on black branch disc, the name, then address and
city on one line and the phone beneath. Pressing "Edit branch" turns that same block into fields in
place, at the same positions and widths. Nothing opens and nothing moves. This is the page's one
deliberate risk and it is where "you can edit everything" is answered literally.

Save issues one PATCH across all four fields, matching the app's existing form grammar and keeping
it to a single request. Cancel restores the plate. Errors render in the existing `Alert` beside the
fields, never as a toast, because the fix is in the field the reader is already looking at.

### Below the plate

A four tile KPI row from `shiftMetrics`: people, open, overdue, percent done. Overdue is the only
tile that takes colour, and only when it is not zero. With 40 to 50 branches coming, "which branch
needs me" is the question this surface answers, so overdue is the one number allowed to shout.

Two panels beneath it. **Roster** lists this branch's people with their role, and links to People.
**Open work** lists this branch's open tasks with their due state, and links to the board. Both link
out rather than reimplementing those pages, which holds the decision that leadership stays owned by
People.

**Delete branch** sits at the bottom, away from Save, rendered for super_admin only. It keeps the
existing 409 `location_in_use` refusal, read by status rather than guessed from the counts on
screen.

## 2.4 The list recut

- The row navigates to `/locations/:id`. `BranchDialog`, `RenameForm` and `DeleteConfirm` are
  deleted from `location-management.tsx`: rename becomes the detail page's edit mode and delete
  becomes its danger zone.
- The branch cell gains a second line carrying city, giving the list the same plate grammar as the
  detail header. The table stays at four columns.
- The open tasks cell carries an overdue marker when there is one, so the scan works without
  opening a branch.
- "Add branch" renders for super_admin only.
- The phone card list keeps its shape, gains city on its sub line, and its chevron now navigates.

## 2.5 The floor

RTL first, since the interface defaults to Hebrew. Logical properties only (`ps-`, `start-`,
`dir="auto"`), and the back affordance flips with direction. Phone targets stay at `h-11` (44px),
which the current file already respects. Every new control carries the existing
`focus-visible:ring-2 ring-ring`. Transitions 150 to 300ms and `prefers-reduced-motion` respected.
Checked at 375, 768, 1024 and 1440.

Two known traps in this codebase that this page walks straight into:

- `apps/web` redefines `--spacing-*`, so `max-w-3xl` resolves to 68px and folds a column to one word
  per line. Panel widths use explicit values such as `max-w-[46rem]`, never the named scale.
- Named and arbitrary `min-[]` breakpoint variants must never be mixed on one element: the arbitrary
  one silently loses the cascade.

## 2.6 Tests

- The list renders "Add branch" for a super_admin and not for an admin.
- A row click navigates to the branch route.
- The detail page renders the plate, and "Edit branch" swaps it to fields without unmounting the
  page.
- Save sends one PATCH carrying all four fields.
- Delete is absent for an admin and present for a super_admin.
- A 409 on delete renders the in use instruction and leaves the page open.
