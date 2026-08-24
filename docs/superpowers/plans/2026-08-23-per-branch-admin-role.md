# Per-branch admin role Implementation Plan (PR 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Narrow `admin` to a single branch it owns, leave `super_admin` as the only chain-wide role, and enforce that boundary in the API rather than the UI.

**Architecture:** `isChainAdmin` currently answers two different questions with one function, so it is replaced by `isSuperAdmin` (chain-wide authority) and `hasAdminAuthority` (admin-level power over the branch in question). Both are added first so the build stays green, every call site is then migrated one slice at a time, and `isChainAdmin` is deleted last, at which point the compiler proves no site kept the old ambiguous meaning. A database check constraint makes "only a super_admin is branch-less" structural rather than a rule the service has to remember.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM (versioned SQL migrations, never `drizzle-kit push`), Postgres, Zod via `fastify-type-provider-zod`, Vitest with testcontainers, React 19 + React Router 6, Tailwind v4, Biome.

**Spec:** `docs/superpowers/specs/2026-08-23-locations-redesign-design.md`

## Global Constraints

- Never pass `--no-verify` or `--no-gpg-sign`. If a hook fails, fix the cause.
- Versioned SQL migrations only, committed and reviewed. Never `drizzle-kit push` (ADR-0010).
- The API is the security boundary (ADR-0007). Web-side predicates are presentation gating only and are never the enforcement.
- A branch admin reaching for another branch gets **404, not 403**, matching the non-enumerating answer the location-scoped board writes already use.
- Comments explain WHY only. Never restate what the code says.
- End every file with a newline.
- Run from the repo root unless a step says otherwise. `npm -w apps/api run test` uses testcontainers and needs Docker Desktop running; it does not need the compose database.
- Full verification, run before the final commit of each task: `npm run typecheck && npm run test && npm run lint`.

---

### Task 1: The two predicates

Add both new predicates alongside `isChainAdmin`. Nothing is deleted yet, so the build and every existing test stay green. `packages/shared` has no test runner of its own, so the unit test lives with the API suite, which already imports `@burgers/shared`.

**Files:**
- Modify: `packages/shared/src/index.ts:26-29`
- Test: `apps/api/test/role-predicates.test.ts` (create)

**Interfaces:**
- Consumes: `Role` from `@burgers/shared`
- Produces: `isSuperAdmin(role: Role): boolean` and `hasAdminAuthority(role: Role): boolean`, both exported from `@burgers/shared`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/role-predicates.test.ts`:

```ts
import { type Role, hasAdminAuthority, isSuperAdmin } from '@burgers/shared'
import { describe, expect, it } from 'vitest'

// The two questions that used to be one. `isChainAdmin` answered both "is this the chain's owner"
// and "does this person hold admin-level power here", which was harmless only while the two roles
// were twins. These cases pin the split so neither predicate can quietly widen back.
describe('role predicates', () => {
  const roles: Role[] = ['super_admin', 'admin', 'manager', 'employee']

  it('names only super_admin as chain-wide', () => {
    expect(roles.filter(isSuperAdmin)).toEqual(['super_admin'])
  })

  it('names both admin roles as holding admin-level authority', () => {
    expect(roles.filter(hasAdminAuthority)).toEqual(['super_admin', 'admin'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/api run test -- role-predicates`
Expected: FAIL, `hasAdminAuthority` and `isSuperAdmin` are not exported members of `@burgers/shared`.

- [ ] **Step 3: Write the implementation**

In `packages/shared/src/index.ts`, leave `isChainAdmin` exactly where it is and add below it:

```ts
// Chain-wide authority: create and delete branches, appoint branch admins, see every branch.
// This is the narrow half of the old `isChainAdmin`, and the one that must never widen.
export function isSuperAdmin(role: Role): boolean {
  return role === 'super_admin'
}

// Admin-level power over the branch in question: edit the branch record, invite and deactivate
// managers and employees, run the board. Says nothing about *which* branch — the caller supplies
// the scope, because that is exactly the part a single global predicate got wrong.
export function hasAdminAuthority(role: Role): boolean {
  return role === 'admin' || role === 'super_admin'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/api run test -- role-predicates`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts apps/api/test/role-predicates.test.ts
git commit -m "feat(shared): split chain-wide authority from admin-level authority"
```

---

### Task 2: Today's admins become chain owners

Every existing admin is chain-wide and branch-less, so the only migration that does not invent a branch assignment for a real person is to promote them. This task also fixes the bootstrap: `upsertSeedAdmin` hardcodes `role: 'admin', locationId: null`, which is a shape that stops being legal once Task 5 adds the constraint, and which every fresh database and every test run goes through.

**Files:**
- Create: `apps/api/drizzle/0019_admin_holds_a_branch.sql`
- Modify: `apps/api/drizzle/meta/_journal.json`
- Modify: `apps/api/src/auth/repository.ts:307-319` (`upsertSeedAdmin`)
- Test: `apps/api/test/super-admin-role.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: every seeded first user is now `super_admin`. Tests that call `seedAdmin(...)` get a chain-wide principal, which is what they already assumed.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/super-admin-role.test.ts`, inside the existing `describe`:

```ts
  it('seeds the first user as a chain owner, not a branch admin', async () => {
    const principal = await get('/auth/me', await signIn(SEED_EMAIL, SEED_PASSWORD))
    expect(principal.statusCode).toBe(200)
    // The seed is the only account with no inviter, so it must be the chain-wide role: a
    // branch-less `admin` is no longer a legal row.
    expect(principal.json()).toMatchObject({ role: 'super_admin', locationId: null })
  })

```

Only the one case. The check constraint that makes the invariant structural cannot land yet: the
invite service still bakes a branch-less admin, so adding the constraint here would turn that
invite into a 500 instead of a clean refusal. The constraint lands in Task 5, immediately after the
service can no longer produce a violating row. Asserting through the API rather than by reading
rows is also the harness's own rule, stated in its header: it deliberately exposes no `db` handle.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/api run test -- super-admin-role`
Expected: FAIL. The first new case reports `role: 'admin'`; the second resolves instead of rejecting because no constraint exists.

- [ ] **Step 3: Write the migration**

Create `apps/api/drizzle/0019_admin_holds_a_branch.sql`:

```sql
-- admin narrows to a single branch it owns; super_admin becomes the only chain-wide role
-- (2026-08-23 owner decision). Two steps, in this order, because they depend on each other.

-- 1. Every existing admin is chain-wide and branch-less today, so promoting them is the only
-- move that satisfies the constraint below without inventing a branch assignment for a real
-- person. Nobody loses access on deploy day; branch admins are appointed by hand afterwards.
UPDATE "users" SET "role" = 'super_admin' WHERE "role" = 'admin';

-- 2. location_id has always been nullable with only the service enforcing "a manager or employee
-- has a branch", so a legacy or seeded row could violate the constraint and fail this migration
-- halfway through a deploy. Fail loudly, naming the rows, rather than on a constraint error.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO offenders
  FROM "users" WHERE "role" <> 'super_admin' AND "location_id" IS NULL;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'users without a branch cannot be migrated: %', offenders;
  END IF;
END $$;

```

The constraint itself is deliberately not here. It arrives in Task 5 as `0020`, once the invite
service can no longer bake a branch-less admin.

- [ ] **Step 4: Register the migration**

Append to the `entries` array in `apps/api/drizzle/meta/_journal.json`, after the `0018_priority_medium` entry:

```json
  {
   "idx": 19,
   "version": "7",
   "when": 1787900000000,
   "tag": "0019_admin_holds_a_branch",
   "breakpoints": true
  }
```

- [ ] **Step 5: Fix the bootstrap**

In `apps/api/src/auth/repository.ts`, `upsertSeedAdmin`, change the inserted role and update the comment above it:

```ts
    // Idempotent by construction (ADR-0005, stories 1-2): a first run inserts the one owner; a
    // second run conflicts on the lower(email) unique index and does nothing. The seed mints a
    // super_admin (2026-08-23): it is the account with no inviter, and a branch admin would need
    // a branch that does not exist yet on a fresh database.
    upsertSeedAdmin: async ({ email, displayName, passwordHash }) => {
      await db
        .insert(users)
        .values({
          email,
          displayName,
          role: 'super_admin',
          locationId: null,
          status: 'active',
          passwordHash,
        })
        .onConflictDoNothing()
    },
```

- [ ] **Step 6: Run the migration against the local database**

Run: `npm run db:migrate`
Expected: completes without error and reports `0019_admin_holds_a_branch` applied.

- [ ] **Step 7: Run the tests**

Run: `npm -w apps/api run test -- super-admin-role`
Expected: PASS, including the new case.

- [ ] **Step 8: Commit**

```bash
git add apps/api/drizzle apps/api/src/auth/repository.ts apps/api/test/super-admin-role.test.ts
git commit -m "feat(api): promote today's admins to the chain-wide role"
```

---

### Task 3: The board narrows for an admin

`taskScopePredicate` is the single predicate the whole board trusts, and it currently hands an admin the entire chain. This task also removes the `admin` implies `super_admin` expansion inside `createRequireRole`, which is the line its own comment predicted would go on the day the roles diverged. Both role-guard call sites are updated in the same task so no route loses `super_admin` in between.

**Files:**
- Modify: `apps/api/src/task-board/scope.ts:22-45`
- Modify: `apps/api/src/auth/require-auth.ts:73-88`
- Modify: `apps/api/src/routes/task-board.ts:95`
- Modify: `apps/api/src/routes/locations.ts:47`
- Modify: `apps/api/src/task-board/task-write-service.ts:127`
- Test: `apps/api/test/task-board.test.ts`

**Interfaces:**
- Consumes: `isSuperAdmin` from Task 1
- Produces: an `admin` principal is scoped exactly like a `manager` on the board. Later tasks rely on `createRequireRole` no longer expanding `admin`, so every call site must name `'super_admin'` explicitly when it means both.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/task-board.test.ts`. Follow the file's existing harness setup; if it seeds tasks through `harness.seedTask`, reuse that helper rather than inserting rows directly.

```ts
  it('shows a branch admin only their own branch', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const theirs = await harness.seedLocation({ name: 'Haifa' })
    await harness.seedTask({ locationId: mine.id, title: 'Wipe down the grill' })
    await harness.seedTask({ locationId: theirs.id, title: 'Restock cups' })

    const admin = await inviteAndAccept(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: mine.id,
    })

    const board = await get('/tasks', admin)
    expect(board.statusCode).toBe(200)
    const titles = board.json<{ tasks: { title: string }[] }>().tasks.map((t) => t.title)
    expect(titles).toContain('Wipe down the grill')
    // The whole point of the change: another branch's work is not theirs to see.
    expect(titles).not.toContain('Restock cups')
  })
```

If the file has no `inviteAndAccept` helper, copy the `ownerToken` pattern from `apps/api/test/super-admin-role.test.ts:66-80`, parameterised by the invite payload.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/api run test -- task-board`
Expected: FAIL. The admin's board contains `Restock cups`, because `taskScopePredicate` returns a tautology for the role.

- [ ] **Step 3: Narrow the predicate**

In `apps/api/src/task-board/scope.ts`, replace the two-case fallthrough and update the doc comment's Admin line:

```ts
    case 'super_admin':
      return sql`true`
    case 'admin':
    case 'manager':
      // A branch admin and a manager are scoped identically: their one branch. A principal in
      // either role that somehow carries no location fails closed to an empty board rather than
      // widening to the whole chain.
      if (!principal.locationId) return sql`false`
      return eq(tasks.locationId, principal.locationId)
```

The doc comment above the function currently reads `Admin — either admin role, chain-wide`. Replace that line with:

```
//   - super_admin — the chain: no location filter (a `true` tautology keeps the call site uniform).
//   - Admin      — their own branch only, exactly like a manager (2026-08-23).
```

- [ ] **Step 4: Remove the guard's role expansion**

In `apps/api/src/auth/require-auth.ts`, delete the `admits` line and the paragraph of comment describing the expansion, and compare against `allowed` directly:

```ts
// Build a tier-one coarse role guard (ADR-0007): gate a whole endpoint by role. Runs after
// requireAuth, so the principal is already resolved on the request; a role outside the allowed
// set is one flat 403. It reads only the resolved principal, so it needs no session service.
//
// Every call site names the roles it admits in full. Until 2026-08-23 naming 'admin' silently
// admitted 'super_admin' too, which was correct only while the two were twins; now that an admin
// is bound to one branch, an implicit widening here would be a bug at every call site.
export function createRequireRole(
  ...allowed: Role[]
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply) => {
    const principal = request.principal as Principal
    if (!allowed.includes(principal.role)) {
      await reply.code(403).send(FORBIDDEN)
    }
  }
}
```

- [ ] **Step 5: Name the roles at both call sites**

`apps/api/src/routes/task-board.ts:95`:

```ts
  const requireManagerOrAdmin = createRequireRole('super_admin', 'admin', 'manager')
```

`apps/api/src/routes/locations.ts:47`:

```ts
  const requireAdmin = createRequireRole('super_admin', 'admin')
```

- [ ] **Step 6: Let an admin resolve their own branch on write**

In `apps/api/src/task-board/task-write-service.ts:127`, an admin currently has to name a target location because they hold none. Swap the predicate so only a super_admin does:

```ts
  if (isSuperAdmin(principal.role)) {
```

Update the import on line 1 from `isChainAdmin` to `isSuperAdmin`.

- [ ] **Step 7: Run the tests**

Run: `npm -w apps/api run test -- task-board`
Expected: PASS, including the new case.

- [ ] **Step 8: Run the whole API suite**

Run: `npm -w apps/api run test`
Expected: PASS. Any failure here is a route that was relying on the removed expansion; fix it by naming `'super_admin'` at that call site.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/task-board apps/api/src/auth/require-auth.ts apps/api/src/routes apps/api/test/task-board.test.ts
git commit -m "feat(api): a branch admin sees only their own branch's board"
```

---

### Task 4: The locations API narrows

`listLocations()` takes no scope today because "the whole table is an admin's to see". That is no longer true. The scope is composed into the query rather than filtered after the read, so an out-of-remit id resolves nothing instead of being fetched and then rejected.

**Files:**
- Modify: `apps/api/src/locations/repository.ts:26-46` and its implementation
- Modify: `apps/api/src/routes/locations.ts:36-140`
- Test: `apps/api/test/locations-api.test.ts`

**Interfaces:**
- Consumes: `isSuperAdmin`, `hasAdminAuthority` from Task 1
- Produces: `LocationScope = { role: Role; locationId: string | null }`; `listLocations(scope)`, `renameLocation(id, name, scope)`. PR 2 turns `renameLocation` into a multi-field patch, so keep the scope parameter last and it will not have to move.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/locations-api.test.ts`:

```ts
  it('shows a branch admin only their own branch', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    await harness.seedLocation({ name: 'Haifa' })
    const admin = await inviteAndAccept(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: mine.id,
    })

    const list = await get('/locations', admin)
    expect(list.statusCode).toBe(200)
    expect(list.json<{ locations: { name: string }[] }>().locations).toEqual([
      expect.objectContaining({ name: 'Dizengoff' }),
    ])
  })

  it('refuses a branch admin creating or deleting a branch', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const admin = await inviteAndAccept(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: mine.id,
    })

    const created = await harness.app.inject({
      method: 'POST',
      url: '/locations',
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: 'Rogue branch' },
    })
    expect(created.statusCode).toBe(403)

    const deleted = await harness.app.inject({
      method: 'POST',
      url: `/locations/${mine.id}/delete`,
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(deleted.statusCode).toBe(403)
  })

  it('answers 404, not 403, when a branch admin renames another branch', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const theirs = await harness.seedLocation({ name: 'Haifa' })
    const admin = await inviteAndAccept(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: mine.id,
    })

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/locations/${theirs.id}`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: 'Not yours' },
    })
    // 403 would confirm the branch exists and let them map the chain by walking ids.
    expect(renamed.statusCode).toBe(404)
  })

  it('lets a branch admin rename their own branch', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const admin = await inviteAndAccept(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: mine.id,
    })

    const renamed = await harness.app.inject({
      method: 'PATCH',
      url: `/locations/${mine.id}`,
      headers: { authorization: `Bearer ${admin}` },
      payload: { name: 'Dizengoff Centre' },
    })
    expect(renamed.statusCode).toBe(200)
    expect(renamed.json()).toMatchObject({ name: 'Dizengoff Centre' })
  })
```

Reuse the file's existing `signIn`/`get` helpers, and add `inviteAndAccept` the same way Task 3 did if the file lacks it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/api run test -- locations-api`
Expected: FAIL. The admin sees both branches, create and delete return 201/200, and the cross-branch rename succeeds.

- [ ] **Step 3: Add scope to the repository**

In `apps/api/src/locations/repository.ts`, add the scope type and thread it through the two read/update methods. Import `and` from `drizzle-orm` alongside `asc, eq`, and `Role` from `@burgers/shared`:

```ts
// The principal's reach over the locations table (ADR-0007 tier two). A super_admin holds the
// chain; every other admin-level caller holds exactly one branch. Composed into the WHERE rather
// than filtered after the read, so an out-of-remit id resolves nothing instead of being fetched
// and then rejected.
export interface LocationScope {
  role: Role
  locationId: string | null
}

// The rows this scope may see: the whole table for a super_admin, one branch otherwise. A
// non-super_admin carrying no location matches nothing, which is the safe direction.
function scopePredicate(scope: LocationScope): SQL {
  if (isSuperAdmin(scope.role)) return sql`true`
  if (!scope.locationId) return sql`false`
  return eq(locations.id, scope.locationId)
}
```

Change the two signatures in the `LocationRepository` interface and update their comments to say the list is scoped:

```ts
  listLocations(scope: LocationScope): Promise<LocationRow[]>
  renameLocation(id: string, name: string, scope: LocationScope): Promise<LocationRow | null>
```

In the implementation, compose the predicate in:

```ts
    listLocations: async (scope) =>
      db
        .select({ id: locations.id, name: locations.name })
        .from(locations)
        .where(scopePredicate(scope))
        .orderBy(asc(locations.name)),

    renameLocation: async (id, name, scope) => {
      const rows = await db
        .update(locations)
        .set({ name, updatedAt: new Date() })
        .where(and(eq(locations.id, id), scopePredicate(scope)))
        .returning({ id: locations.id, name: locations.name })
      return rows[0] ?? null
    },
```

Add `sql` and `SQL` to the `drizzle-orm` import, and `isSuperAdmin` to the `@burgers/shared` import.

- [ ] **Step 4: Re-guard the routes**

In `apps/api/src/routes/locations.ts`, replace the single `requireAdmin` with two guards and pass the principal through. Update the module's header comment, which currently claims the surface is scope-free:

```ts
  // Tier one. Reading and editing a branch is admin-level work, so both admin roles pass; creating
  // and deleting one is a chain act, so only the owner does (2026-08-23).
  const requireAdminLevel = createRequireRole('super_admin', 'admin')
  const requireSuperAdmin = createRequireRole('super_admin')
```

Apply `requireAdminLevel` to `GET /locations` and `PATCH /locations/:id`, and `requireSuperAdmin` to `POST /locations` and `POST /locations/:id/delete`.

In the two scoped handlers, build the scope from the principal, never from the request:

```ts
      const principal = request.principal as Principal
      const locations = await deps.locationRepository.listLocations({
        role: principal.role,
        locationId: principal.locationId,
      })
```

```ts
      const principal = request.principal as Principal
      const location = await deps.locationRepository.renameLocation(
        request.params.id,
        request.body.name,
        { role: principal.role, locationId: principal.locationId },
      )
      if (!location) {
        return reply.code(404).send(NOT_FOUND)
      }
```

Import `Principal` from `../auth/principal.js`. The `NOT_FOUND` comment above line 30 says an unknown id has nothing to hide; extend it to note that a scoped miss deliberately answers the same way.

- [ ] **Step 5: Run the tests**

Run: `npm -w apps/api run test -- locations-api`
Expected: PASS, including all four new cases.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/locations apps/api/src/routes/locations.ts apps/api/test/locations-api.test.ts
git commit -m "feat(api): scope the locations surface to the caller's branch"
```

---

### Task 5: Invites and the roster narrow

Three related sites: who may invite whom, which roster rows a caller sees, and which pending invites they may act on.

**Files:**
- Modify: `apps/api/src/auth/invite-service.ts:69-107`
- Modify: `apps/api/src/auth/repository.ts:349-357` (`listUsers`) and `:477-489` (`inviteScopePredicate`)
- Create: `apps/api/drizzle/0020_branchless_is_owner_only.sql`
- Modify: `apps/api/drizzle/meta/_journal.json`
- Modify: `apps/api/src/db/schema.ts:44-62` (the `users` table)
- Test: `apps/api/test/invite.test.ts`

**Interfaces:**
- Consumes: `isSuperAdmin`, `hasAdminAuthority` from Task 1
- Produces: no new exported names.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/invite.test.ts`, reusing that file's harness helpers:

```ts
  it('lets a branch admin invite into their own branch', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const admin = await inviteAndAccept(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: mine.id,
    })

    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: {
        email: 'noa@burgers.local',
        displayName: 'Noa Levi',
        role: 'manager',
        locationId: mine.id,
      },
    })
    expect(invited.statusCode).toBe(201)
  })

  it('refuses a branch admin inviting into another branch', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const theirs = await harness.seedLocation({ name: 'Haifa' })
    const admin = await inviteAndAccept(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: mine.id,
    })

    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: {
        email: 'noa@burgers.local',
        displayName: 'Noa Levi',
        role: 'employee',
        locationId: theirs.id,
      },
    })
    expect(invited.statusCode).toBe(403)
  })

  it('refuses a branch admin appointing another admin', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const admin = await inviteAndAccept(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: mine.id,
    })

    const invited = await harness.app.inject({
      method: 'POST',
      url: '/invites',
      headers: { authorization: `Bearer ${admin}` },
      payload: {
        email: 'rival@burgers.local',
        displayName: 'Rival Admin',
        role: 'admin',
        locationId: mine.id,
      },
    })
    // Appointing admins is the chain owner's act, not a branch's.
    expect(invited.statusCode).toBe(403)
  })

  it('shows a branch admin the roster of their own branch alone', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const mine = await harness.seedLocation({ name: 'Dizengoff' })
    const theirs = await harness.seedLocation({ name: 'Haifa' })
    await inviteAndAccept(owner, {
      email: 'far@burgers.local',
      displayName: 'Far Away',
      role: 'employee',
      locationId: theirs.id,
    })
    const admin = await inviteAndAccept(owner, {
      email: 'dana@burgers.local',
      displayName: 'Dana Cohen',
      role: 'admin',
      locationId: mine.id,
    })

    const roster = await get('/users', admin)
    expect(roster.statusCode).toBe(200)
    const emails = roster.json<{ users: { email: string }[] }>().users.map((u) => u.email)
    expect(emails).toContain('dana@burgers.local')
    expect(emails).not.toContain('far@burgers.local')
    expect(emails).not.toContain(SEED_EMAIL)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/api run test -- invite`
Expected: FAIL. The cross-branch invite returns 201, the admin appointment returns 201, and the roster carries every user.

- [ ] **Step 3: Rewrite the invite resolution**

In `apps/api/src/auth/invite-service.ts`, replace the `isChainAdmin` branch of `resolveBakedFields` with a super_admin branch and a branch-admin branch, and update the doc comment above it:

```ts
// Resolve the role and Location to bake into the invite from the acting principal (ADR-0007),
// never from the request body:
//
// - A super_admin may invite any role to any Location. Only an admin-level invitee with the
//   chain-wide role is Location-less; every other role needs one, and its absence is `invalid`.
// - A branch admin may invite a manager or an employee, and only into their own Location.
//   Appointing another admin is the chain owner's act, so it is `forbidden` here.
// - A manager may create only employee invites, and only for their own Location.
// - No other role reaches here (the route guard admits only the admin roles and manager).
function resolveBakedFields(
  principal: Principal,
  input: CreateInviteInput,
): { role: Role; locationId: string | null } | { reason: 'forbidden' | 'invalid' } {
  if (isSuperAdmin(principal.role)) {
    if (isSuperAdmin(input.role)) {
      return { role: input.role, locationId: null }
    }
    if (!input.locationId) {
      return { reason: 'invalid' }
    }
    return { role: input.role, locationId: input.locationId }
  }

  if (principal.role === 'admin') {
    if (input.role !== 'manager' && input.role !== 'employee') {
      return { reason: 'forbidden' }
    }
    if (!principal.locationId) {
      return { reason: 'forbidden' }
    }
    // Targeting any Location but their own is refused, not silently redirected, the same rule a
    // manager already lives under; an omitted Location defaults to their own.
    if (input.locationId != null && input.locationId !== principal.locationId) {
      return { reason: 'forbidden' }
    }
    return { role: input.role, locationId: principal.locationId }
  }
```

Leave the manager branch and the trailing `return { reason: 'forbidden' }` exactly as they are. Update the import on line 1 from `isChainAdmin` to `isSuperAdmin`.

- [ ] **Step 4: Narrow the roster read**

In `apps/api/src/auth/repository.ts`, `listUsers`, swap the predicate and update its comment:

```ts
    // The scoped list (ADR-0007 tier two): a super_admin sees everyone; a branch admin, a manager
    // and an employee see only their own Location. Derived here from the principal, never from
    // client input, so there is no unscoped path a caller could reach.
    listUsers: async (scope) => {
      const query = db.select(userRowColumns).from(users)
      if (isSuperAdmin(scope.role)) {
        return query
      }
      // A null location matches nothing rather than widening the view, the safe direction.
      return query.where(eq(users.locationId, scope.locationId as string))
    },
```

- [ ] **Step 5: Narrow the invite-action predicate**

Replace `inviteScopePredicate` and its comment:

```ts
// The scope predicate every by-id invite action is guarded with (ADR-0007 tier two): a super_admin
// reaches any row; a branch admin reaches any pending invite at their own Location; a manager
// reaches only an employee invite at theirs, the pair they were allowed to create. Composed into
// the WHERE, never applied after the read, so an out-of-remit id resolves nothing.
function inviteScopePredicate(scope: InviteActionScope): SQL {
  if (isSuperAdmin(scope.role)) {
    return sql`true`
  }
  if (scope.role === 'admin') {
    return eq(users.locationId, scope.locationId as string) as SQL
  }
  return and(eq(users.role, 'employee'), eq(users.locationId, scope.locationId as string)) as SQL
}
```

Change the file's `@burgers/shared` import from `isChainAdmin` to `isSuperAdmin`.

- [ ] **Step 6: Run the tests**

Run: `npm -w apps/api run test -- invite`
Expected: PASS, including all four new cases.

- [ ] **Step 7: Make the invariant structural**

No code path can now produce a branch-less admin, so the constraint can land without turning a
legitimate request into a 500. Create `apps/api/drizzle/0020_branchless_is_owner_only.sql`:

```sql
-- Only the chain-wide role is branch-less (2026-08-23). The service already enforces this in
-- resolveBakedFields; the constraint is defence in depth for any path that bypasses it, and it is
-- what makes the rule true of the data rather than merely remembered by the code.
--
-- location_id has always been nullable with only the service enforcing "a manager or employee has
-- a branch", so a legacy or seeded row could violate this and fail the migration halfway through a
-- deploy. Fail loudly, naming the rows, rather than on an opaque constraint error.
DO $$
DECLARE offenders text;
BEGIN
  SELECT string_agg(id::text, ', ') INTO offenders
  FROM "users" WHERE "role" <> 'super_admin' AND "location_id" IS NULL;
  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION 'users without a branch cannot be migrated: %', offenders;
  END IF;
END $$;

ALTER TABLE "users" ADD CONSTRAINT "users_role_location_check" CHECK (
  ("role" = 'super_admin' AND "location_id" IS NULL)
  OR ("role" <> 'super_admin' AND "location_id" IS NOT NULL)
);
```

Register it in `apps/api/drizzle/meta/_journal.json` after the `0019` entry:

```json
  {
   "idx": 20,
   "version": "7",
   "when": 1787900100000,
   "tag": "0020_branchless_is_owner_only",
   "breakpoints": true
  }
```

- [ ] **Step 8: Mirror the constraint in the Drizzle schema**

In `apps/api/src/db/schema.ts`, the `users` table's third argument currently returns a
single-element array. Add the check beside the existing unique index. `check` is already imported
at line 8:

```ts
  (table) => [
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
    // Only the chain-wide role is branch-less (2026-08-23). Expressed here as well as in the
    // migration so `drizzle-kit generate` does not propose dropping it on the next schema change.
    check(
      'users_role_location_check',
      sql`(${table.role} = 'super_admin' and ${table.locationId} is null)
          or (${table.role} <> 'super_admin' and ${table.locationId} is not null)`,
    ),
  ],
```

Also update the `locationId` comment at line 47-49, which still reads "Admins are chain-wide and
hold a null location":

```ts
    // Only a super_admin is chain-wide and holds a null location; an admin, manager and employee
    // each reference a real Location. Enforced by users_role_location_check below (2026-08-23).
```

- [ ] **Step 9: Run the migration and the tests**

Run: `npm run db:migrate && npm -w apps/api run test`
Expected: `0020_branchless_is_owner_only` applies, and the whole API suite passes.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src apps/api/drizzle apps/api/test/invite.test.ts
git commit -m "feat(api): a branch admin hires into their branch and no other"
```

---

### Task 6: The chain owner can read the knowledge base

A standalone bug fix that this PR must carry. `super_admin` appears in none of the three sensitivity rows, so `sensitivitiesVisibleTo('super_admin')` returns an empty array and every document is filtered out of retrieval for that role. This is live in production.

**Files:**
- Modify: `apps/api/src/assistant/document-metadata.ts:15-22`
- Test: `apps/api/test/document-metadata.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/document-metadata.test.ts`:

```ts
  it('lets the chain owner read every sensitivity', () => {
    // super_admin landed with the v2 design while this table was being written on another branch,
    // and was never added to it — leaving the chain's own owner able to read nothing at all.
    expect(sensitivitiesVisibleTo('super_admin')).toEqual(['general', 'internal', 'confidential'])
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/api run test -- document-metadata`
Expected: FAIL, received `[]`.

- [ ] **Step 3: Add the role to the policy table**

```ts
const ROLES_BY_SENSITIVITY: Record<Sensitivity, readonly Role[]> = {
  general: ['super_admin', 'admin', 'manager', 'employee'],
  internal: ['super_admin', 'admin', 'manager'],
  confidential: ['super_admin', 'admin'],
}
```

The comment above it says "for whoever runs a branch and above"; that reading is now literally true, so leave it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w apps/api run test -- document-metadata`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/assistant/document-metadata.ts apps/api/test/document-metadata.test.ts
git commit -m "fix(assistant): super_admin could read no documents at all"
```

---

### Task 7: The web app's presentation gating

Presentation only. The API is already the boundary after Tasks 3 to 5; this stops the UI offering controls that would 403 or 404.

**Files:**
- Modify: `apps/web/src/auth/roles.ts:11,21`
- Modify: `apps/web/src/routes/guards.tsx:55`
- Modify: `apps/web/src/features/dashboard/dashboard-screen.tsx:53`
- Modify: `apps/web/src/features/people/invite-form.tsx:43,60,100,167-174`
- Modify: `apps/web/src/features/people/people-management.tsx:31`
- Modify: `apps/web/src/features/tasks/task-form-dialog.tsx:232`
- Modify: `apps/web/src/features/tasks/tasks-screen.tsx:129`
- Test: `apps/web/src/features/people/invite-form.test.tsx` (create)

**Interfaces:**
- Consumes: `isSuperAdmin`, `hasAdminAuthority` from Task 1
- Produces: nothing new

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/people/invite-form.test.tsx`, mirroring the provider setup in
`apps/web/src/features/locations/location-management.test.tsx:11-24`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { PrincipalResponse } from '@burgers/shared'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'use-intl'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../i18n/messages.js'
import { locationsApi } from '../../lib/api.js'
import { InviteForm } from './invite-form.js'

const BRANCH = { id: '11111111-1111-1111-1111-111111111111', name: 'Dizengoff' }

function renderInviteForm(principal: Pick<PrincipalResponse, 'role' | 'locationId'>): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en" messages={messages.en}>
        <InviteForm
          principal={{
            userId: '22222222-2222-2222-2222-222222222222',
            displayName: 'Someone',
            status: 'active',
            ...principal,
          }}
          onClose={() => {}}
        />
      </IntlProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  // The branch picker reads the locations list; one branch keeps every case deterministic.
  vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [BRANCH] })
})

afterEach(() => {
  vi.restoreAllMocks()
})

// The invite form is where the new role boundary is most visible: a branch admin may staff their
// own branch and may not appoint peers, so the role select and the branch picker both change shape
// with the principal. Presentation only — the API refuses either way (ADR-0007).
describe('invite form, by principal role', () => {
  it('offers a super_admin every role', () => {
    renderInviteForm({ role: 'super_admin', locationId: null })
    const options = screen.getAllByRole('option').map((o) => o.getAttribute('value'))
    expect(options).toEqual(
      expect.arrayContaining(['super_admin', 'admin', 'manager', 'employee']),
    )
  })

  it('offers a branch admin only the roles beneath them', () => {
    renderInviteForm({ role: 'admin', locationId: 'branch-1' })
    const options = screen.getAllByRole('option').map((o) => o.getAttribute('value'))
    expect(options).toEqual(expect.arrayContaining(['manager', 'employee']))
    expect(options).not.toContain('admin')
    expect(options).not.toContain('super_admin')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/web run test -- invite-form`
Expected: FAIL, the branch admin is offered `admin` and `super_admin`.

- [ ] **Step 3: Update the two shared predicates**

`apps/web/src/auth/roles.ts`. `canProvision` keeps its meaning; `canManageLocations` widens to admin-level because a branch admin does reach `/locations`, it simply resolves to their own branch. Update both comments to say so.

```ts
export function canProvision(principal: PrincipalResponse): boolean {
  return hasAdminAuthority(principal.role) || principal.role === 'manager'
}

export function canManageLocations(principal: PrincipalResponse): boolean {
  return hasAdminAuthority(principal.role)
}
```

- [ ] **Step 4: Update the remaining call sites**

Each one, with the question it is asking:

- `routes/guards.tsx:55` (`RequireAdmin`): `hasAdminAuthority`
- `features/dashboard/dashboard-screen.tsx:53`: `isSuperAdmin`. The branch league table is a chain view and a branch admin has one branch
- `features/people/people-management.tsx:31`: `hasAdminAuthority`
- `features/tasks/task-form-dialog.tsx:232`: `isSuperAdmin`. Only a chain owner picks a target branch
- `features/tasks/tasks-screen.tsx:129`: `isSuperAdmin`. Grouping by branch only means something chain-wide
- `features/people/invite-form.tsx:43`: `hasAdminAuthority`
- `features/people/invite-form.tsx:60`: `const needsLocation = isAdmin && !isSuperAdmin(selectedRole)`
- `features/people/invite-form.tsx:100`: `locationId: isSuperAdmin(values.role) ? null : values.locationId`

Update each file's `@burgers/shared` import to match.

- [ ] **Step 5: Gate the role options**

In `apps/web/src/features/people/invite-form.tsx`, wrap the two admin-level options so only a chain owner sees them:

```tsx
                <option value="employee">{t('invites.roleEmployee')}</option>
                <option value="manager">{t('invites.roleManager')}</option>
                {isSuperAdmin(principal.role) ? (
                  <>
                    <option value="admin">{t('invites.roleAdmin')}</option>
                    <option value="super_admin">{t('invites.roleSuperAdmin')}</option>
                  </>
                ) : null}
```

- [ ] **Step 6: Run the tests**

Run: `npm -w apps/web run test`
Expected: PASS, including the two new cases.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): stop offering controls a branch admin cannot use"
```

---

### Task 8: Delete the old predicate

The compiler is the proof that every site was classified. Nothing should reference `isChainAdmin` by now; if anything does, it was missed, and this is where it surfaces.

**Files:**
- Modify: `packages/shared/src/index.ts:26-29`

**Interfaces:**
- Consumes: everything from Tasks 1 to 7
- Produces: `isChainAdmin` no longer exists

- [ ] **Step 1: Confirm nothing still calls it**

Run: `git grep -n "isChainAdmin" -- ':!docs'`
Expected: matches only in `packages/shared/src/index.ts`. Any other file is a missed call site; classify it against the spec's table before continuing.

- [ ] **Step 2: Delete the function and its comment**

Remove `isChainAdmin` and the paragraph above it. Update the surviving comment on `roleSchema` (lines 15 to 21), which still describes the two roles as carrying identical abilities:

```ts
// The four roles and the account lifecycle statuses (ADR-0001, ADR-0005), shared so the SPA
// and API name them identically. locationId is null for a super_admin alone.
//
// super_admin arrived with the v2 design (2026-08-20) as a twin of admin and diverged from it on
// 2026-08-23: a super_admin holds the chain, an admin holds exactly one branch and owns it.
// Nothing asks `role === 'admin'` directly — every site goes through one of the two predicates
// below, so which question is being asked is visible at the call site.
```

- [ ] **Step 3: Typecheck both apps**

Run: `npm run typecheck`
Expected: PASS with no errors.

- [ ] **Step 4: Run the full suite**

Run: `npm run test`
Expected: PASS across `apps/api` and `apps/web`.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: no diagnostics. If Biome reports formatting, run `npm run format` and re-run.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts
git commit -m "refactor(shared): retire isChainAdmin now that the roles have diverged"
```

---

## Manual verification before opening the PR

The automated suite covers the boundary; these two confirm the deploy-day story, which no test can.

- [ ] Run `npm run db:migrate` against a database that still holds a plain `admin` row and confirm it is promoted rather than rejected.
- [ ] Sign in locally as `admin@burgers.local` (web 5630, API 3820), confirm the account now reads as the chain owner, invite a branch admin from People with a branch attached, sign in as them, and confirm they see one branch on Locations, their own branch's board, and no "Add branch" control.

## What this plan deliberately leaves for PR 2

The `address`, `city` and `phone` columns, the `/locations/:id` route, the branch detail page, and the Locations list recut. All of it is specified in section 2 of the spec and none of it is required for the role boundary to be real.
