# Branch detail redesign Implementation Plan (PR 2 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a branch a record worth editing and a page worth opening: address, city and phone on the row, a `/locations/:id` detail page that reads as a mini dashboard, and a list recut that navigates to it.

**Architecture:** The detail page invents no new reads and no new metrics. It joins three things the caller is already entitled to (the scoped locations list, the roster, the board) and passes the board slice for one branch through `shiftMetrics`, the same function the Dashboard uses, so the two can never disagree about a number. The only new API surface is three columns and a widened PATCH body.

**Tech Stack:** TypeScript, Fastify, Drizzle ORM (versioned SQL migrations, never `drizzle-kit push`), Postgres, Zod via `fastify-type-provider-zod`, React 19 + React Router 6, TanStack Query, Tailwind v4, Vitest + Testing Library, Biome.

**Spec:** `docs/superpowers/specs/2026-08-23-locations-redesign-design.md`, section 2. PR 1 (the per-branch admin role) is already merged into this branch.

## Global Constraints

- Never pass `--no-verify` or `--no-gpg-sign`. If a hook fails, fix the cause.
- Versioned SQL migrations only, committed and reviewed. Never `drizzle-kit push`.
- The API is the security boundary (ADR-0007). A branch admin may PATCH only their own branch; the scope predicate added in PR 1 already enforces this and must keep doing so.
- Every user-visible string is added to **both** locales in `apps/web/src/i18n/messages.ts`: `en` (block starts line ~370) and `he` (block starts line ~762). A string in one locale only is a defect.
- Hebrew-first, right-to-left. Logical properties only (`ps-`, `pe-`, `ms-`, `me-`, `start-`, `end-`), never `pl-`/`pr-`/`left`/`right`. `dir="auto"` on any user-authored text (branch name, address, task title, person name).
- `apps/web` redefines `--spacing-*`, so `max-w-3xl` resolves to about 68px and folds a column to one word per line. Use explicit values like `max-w-[46rem]`, never the named max-width scale.
- Never mix named and arbitrary `min-[]` breakpoint variants on one element; the arbitrary one silently loses the cascade.
- Phone touch targets stay at `h-11` (44px). Every control carries the existing `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`. Transitions 150 to 300ms.
- Reuse the existing UI kit in `apps/web/src/components/ui/` (`Button`, `Input`, `Field`, `Alert`, `Dialog`, `AlertDialog`, `Icon`, `Skeleton`, `Card`). Do not introduce a new primitive.
- Available `Icon` names, from `apps/web/src/components/ui/icon-registry.ts`: `glyph dashboard tasks assistant create search account back profile language settings role location logout close selected disclosure priority overdue backlog edit delete drag overflow send threads folder retry`. Do not invent one.
- Comments explain WHY only, never WHAT the code already says. Match the density and voice of the surrounding comments, which are unusually thorough in this codebase.
- End every file with a newline.
- Known pre-existing environment condition, not yours to fix: `core.autocrlf=true` with no `.gitattributes` makes Biome report a line-ending error on essentially every file (290 of 291 at baseline). Ignore those; never reformat a file to chase them.
- Verification: `npm run typecheck`, `npm -w apps/web run test` (fast), `npm -w apps/api run test` (slow, testcontainers, Docker must be running).

---

### Task 1: A branch gains an address, a city and a phone

**Files:**
- Create: `apps/api/drizzle/0021_branch_contact.sql`
- Modify: `apps/api/drizzle/meta/_journal.json`
- Modify: `apps/api/src/db/schema.ts` (the `locations` table, around line 35)
- Modify: `packages/shared/src/index.ts` (`locationSchema`, `updateLocationRequestSchema`)
- Modify: `apps/api/src/locations/repository.ts` (`LocationRow`, `renameLocation` becomes `updateLocation`)
- Modify: `apps/api/src/routes/locations.ts` (the PATCH handler)
- Test: `apps/api/test/locations-api.test.ts`

**Interfaces:**
- Consumes: `LocationScope` and the scope predicate added in PR 1.
- Produces: `LocationRow` gains `address: string | null`, `city: string | null`, `phone: string | null`. `updateLocation(id, patch, scope)` where `patch` is `{ name?, address?, city?, phone? }`. Task 3 calls this through `locationsApi.update`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/locations-api.test.ts`, reusing that file's existing helpers:

```ts
  it('patches a branch across all four fields in one call', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const branch = await harness.seedLocation({ name: 'Dizengoff' })

    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/locations/${branch.id}`,
      headers: { authorization: `Bearer ${owner}` },
      payload: {
        name: 'Dizengoff Centre',
        address: '12 Dizengoff St',
        city: 'Tel Aviv',
        phone: '03-555-0123',
      },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({
      name: 'Dizengoff Centre',
      address: '12 Dizengoff St',
      city: 'Tel Aviv',
      phone: '03-555-0123',
    })
  })

  it('leaves an omitted field alone and clears one sent as null', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const branch = await harness.seedLocation({ name: 'Dizengoff' })
    const patch = (payload: Record<string, unknown>) =>
      harness.app.inject({
        method: 'PATCH',
        url: `/locations/${branch.id}`,
        headers: { authorization: `Bearer ${owner}` },
        payload,
      })

    await patch({ address: '12 Dizengoff St', phone: '03-555-0123' })
    // A second patch naming only the phone must not wipe the address.
    const second = await patch({ phone: '03-555-9999' })
    expect(second.json()).toMatchObject({ address: '12 Dizengoff St', phone: '03-555-9999' })
    // An explicit null is how the form clears a field, and must be distinguishable from omission.
    const third = await patch({ address: null })
    expect(third.json()).toMatchObject({ address: null, phone: '03-555-9999' })
  })

  it('still refuses a blank name', async () => {
    const owner = await signIn(SEED_EMAIL, SEED_PASSWORD)
    const branch = await harness.seedLocation({ name: 'Dizengoff' })
    const patched = await harness.app.inject({
      method: 'PATCH',
      url: `/locations/${branch.id}`,
      headers: { authorization: `Bearer ${owner}` },
      payload: { name: '   ' },
    })
    expect(patched.statusCode).toBe(400)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/api run test -- locations-api`
Expected: FAIL. The extra fields are stripped by the response schema and the partial patch is rejected or ignored.

- [ ] **Step 3: The migration**

Create `apps/api/drizzle/0021_branch_contact.sql`:

```sql
-- A branch was only a name (2026-08-23 owner ask). It now carries the three things you need to
-- actually reach or find one, which is also what gives the new branch detail page something to
-- edit. All three are nullable: every row that exists today has none of them, and a rename must
-- not become impossible until someone fills in an address.
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "address" text;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "city" text;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "phone" text;
```

Register it in `apps/api/drizzle/meta/_journal.json` after the `0020` entry:

```json
  {
   "idx": 21,
   "version": "7",
   "when": 1787900200000,
   "tag": "0021_branch_contact",
   "breakpoints": true
  }
```

- [ ] **Step 4: The schema and the shared contract**

In `apps/api/src/db/schema.ts`, add the three columns to `locations`, with one comment explaining why they are nullable rather than restating the column list.

In `packages/shared/src/index.ts`, add `address`, `city` and `phone` as `z.string().nullable()` to `locationSchema`, and replace `updateLocationRequestSchema` with a partial patch. The distinction the test pins is that an omitted key means "leave it" and an explicit `null` means "clear it", so the three optional fields are `.nullable().optional()` while `name`, when present, still refuses blank:

```ts
// A patch over the branch record (2026-08-23). Every field is optional because the detail page
// sends one PATCH for whatever the editor actually touched; a key that is absent is left alone and
// an explicit null clears the column, which is how the form empties a field it had a value in.
// `name` is the one field with no null: a branch must always be called something.
export const updateLocationRequestSchema = z.object({
  name: z.string().trim().min(1).optional(),
  address: z.string().trim().min(1).nullable().optional(),
  city: z.string().trim().min(1).nullable().optional(),
  phone: z.string().trim().min(1).nullable().optional(),
})
```

- [ ] **Step 5: The repository and the route**

In `apps/api/src/locations/repository.ts`, widen `LocationRow` to carry the three columns, select them everywhere a row is returned (`createLocation`, `listLocations`, and the update), and rename `renameLocation` to `updateLocation(id, patch, scope)`. Build the `set` object from only the keys present on the patch, so an omitted key is not written as null:

```ts
    updateLocation: async (id, patch, scope) => {
      const set: Partial<typeof locations.$inferInsert> = { updatedAt: new Date() }
      // Only keys the caller actually sent are written. `in` rather than a truthiness test, so an
      // explicit null clears the column while an omitted key leaves it untouched.
      if ('name' in patch && patch.name !== undefined) set.name = patch.name
      if ('address' in patch) set.address = patch.address
      if ('city' in patch) set.city = patch.city
      if ('phone' in patch) set.phone = patch.phone

      const rows = await db
        .update(locations)
        .set(set)
        .where(and(eq(locations.id, id), scopePredicate(scope)))
        .returning(locationColumns)
      return rows[0] ?? null
    },
```

Introduce a `locationColumns` constant holding the five selected columns so the three read paths cannot drift apart.

In `apps/api/src/routes/locations.ts`, the PATCH handler passes `request.body` straight through as the patch. Update the route's comment, which currently describes a rename.

- [ ] **Step 6: Run the tests**

Run: `npm -w apps/api run test -- locations-api`
Expected: PASS, including the three new cases.

- [ ] **Step 7: Apply the migration and run the full API suite**

Run: `npm run db:migrate && npm -w apps/api run test`
Expected: `0021_branch_contact` applies; the whole API suite passes.

- [ ] **Step 8: Commit**

```bash
git add apps/api packages/shared
git commit -m "feat(api): a branch carries an address, a city and a phone"
```

---

### Task 2: The route, and the list that navigates to it

**Files:**
- Modify: `apps/web/src/lib/api.ts` (`locationsApi.rename` becomes `update`)
- Modify: `apps/web/src/App.tsx` (add `locations/:id`)
- Modify: `apps/web/src/features/locations/locations-screen.tsx`
- Modify: `apps/web/src/features/locations/location-management.tsx`
- Modify: `apps/web/src/features/locations/use-locations.ts`
- Modify: `apps/web/src/i18n/messages.ts` (both locales)
- Test: `apps/web/src/features/locations/location-management.test.tsx`

**Interfaces:**
- Consumes: `locationSchema`'s three new fields from Task 1.
- Produces: the route `/locations/:id`; `useLocation(id)` selecting one branch out of the existing `LOCATIONS_QUERY_KEY` cache so the detail page adds no second network read. Task 3 renders at that route and uses that hook.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/features/locations/location-management.test.tsx`. The screen now needs a router, so wrap the render in `MemoryRouter` and assert navigation by rendering a `Routes` with a stub detail element:

```tsx
  it('opens the branch page when a row is clicked', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({ locations: [DOWNTOWN] })
    renderScreen()
    await screen.findByRole('table')

    fireEvent.click(screen.getByRole('button', { name: /Downtown/ }))
    // The row is a link to the branch, not a dialog opener, since round 12.
    expect(await screen.findByTestId('branch-route')).toBeTruthy()
  })

  it('shows the city beneath the branch name', async () => {
    vi.spyOn(locationsApi, 'list').mockResolvedValue({
      locations: [{ ...DOWNTOWN, city: 'Tel Aviv' }],
    })
    renderScreen()
    expect(await screen.findByText('Tel Aviv')).toBeTruthy()
  })
```

Update `renderScreen` to mount inside a `MemoryRouter` with two routes: `/locations` rendering `LocationManagement`, and `/locations/:id` rendering `<p data-testid="branch-route" />`. `DOWNTOWN` gains `address: null, city: null, phone: null`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w apps/web run test -- location-management`
Expected: FAIL. The row opens a dialog rather than navigating, and no city renders.

- [ ] **Step 3: The API client and the route**

In `apps/web/src/lib/api.ts`, rename `locationsApi.rename` to `update` (same PATCH, the body is now the patch) and update its comment.

In `apps/web/src/App.tsx`, add a sibling route beneath the existing `locations` one:

```tsx
          <Route
            path="locations/:id"
            element={
              <RequireAdmin>
                <BranchScreen />
              </RequireAdmin>
            }
          />
```

Task 3 writes `BranchScreen`. For this task, create `apps/web/src/features/locations/branch-screen.tsx` as a minimal placeholder that renders the branch name and nothing else, so the route is real and the navigation test passes. Task 3 replaces its body.

- [ ] **Step 4: The list recut**

In `apps/web/src/features/locations/location-management.tsx`:

- Replace the row's `onClick={() => setOpenBranch(location)}` with a `Link` from `react-router-dom` to `/locations/${location.id}`, keeping the `after:absolute after:inset-0` overlay so the whole row stays one tab stop and one click target.
- Delete `BranchDialog`, `BranchAction`, `RenameForm` and `DeleteConfirm`, and the `openBranch` state with them. Rename and delete now live on the detail page. Remove any import left unused.
- In the branch cell, render `location.city` on a second line beneath the name, in `text-caption text-muted-foreground`, `dir="auto"`, omitted entirely when null.
- On the phone card list, add the city to the existing `sub` line, and make the card a `Link` to the same route.
- In the "Open tasks" cell, when the branch has at least one overdue task, render the count with the `overdue` icon beside it in `text-destructive`. Compute overdue from the board query the screen already holds: a task whose `dueDate` is before now and whose `status` is not `done`.

Add a `useLocation(id)` hook to `use-locations.ts` that reads the existing list query and selects the one branch, returning `undefined` while the list is loading and `null` when no branch has that id.

- [ ] **Step 5: New strings, both locales**

Add to `apps/web/src/i18n/messages.ts` under `locations`, in **both** the `en` block and the `he` block:

| key | en | he |
|---|---|---|
| `colOverdue` | `Overdue` | `באיחור` |
| `backToBranches` | `Branches` | `סניפים` |
| `overdueOnBranch` | `{count, plural, one {# overdue} other {# overdue}}` | `{count, plural, one {# באיחור} other {# באיחור}}` |

- [ ] **Step 6: Run the tests**

Run: `npm -w apps/web run test`
Expected: PASS, including both new cases. Existing cases that drove the deleted dialog must be removed or rewritten to the new behaviour, not left asserting a surface that no longer exists.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): a branch row opens the branch"
```

---

### Task 3: The branch page

This is the visible deliverable. Read the spec's section 2.3 before starting; it describes the intended surface and the one deliberate design risk on it.

**Files:**
- Modify: `apps/web/src/features/locations/branch-screen.tsx` (replace the Task 2 placeholder)
- Modify: `apps/web/src/i18n/messages.ts` (both locales)
- Test: `apps/web/src/features/locations/branch-screen.test.tsx` (create)

**Interfaces:**
- Consumes: `useLocation(id)` from Task 2, `locationsApi.update` and `locationsApi.remove`, `authApi.listUsers`, `tasksApi.board`, and `shiftMetrics` from `apps/web/src/features/dashboard/dashboard-metrics.ts`.
- Produces: nothing other tasks consume.

**The surface, top to bottom:**

1. **A back affordance** to `/locations`, using the `back` icon, labelled with `locations.backToBranches`. It flips with direction for free because the icon set and logical properties already do.

2. **The plate.** The `BranchDisc` (lift it out of `location-management.tsx` into a shared spot rather than copying it), the branch name at `text-heading-lg font-extrabold`, then address and city on one line and the phone beneath, both `text-body text-muted-foreground`, `dir="auto"`, each omitted when null. If all three are null, show one muted line inviting the first edit rather than a blank block. An "Edit branch" `Button` sits at the end of the header row.

3. **Edit in place.** Pressing Edit swaps the plate's text for `Input` fields at the same positions and widths, inside a `form`. Nothing opens and nothing moves. The footer gains Cancel and "Save changes". Save sends **one** `locationsApi.update` call carrying only the fields that actually changed, invalidates `LOCATIONS_QUERY_KEY`, and returns to the plate. Cancel restores the original values. A failure renders an `Alert tone="error"` above the fields and leaves the editor open with the user's input intact.

4. **The KPI row**, four tiles reusing the existing `StatTile` pattern: people on this branch, open tasks, overdue, percent done. Take them from `shiftMetrics(branchTasks, new Date())` where `branchTasks` is the board filtered to this `locationId`, plus the roster count. The overdue tile is the only one that takes colour, `text-destructive`, and only when its value is above zero.

5. **Two panels**, side by side on desktop and stacked on phone. **Roster**: this branch's people, each an `Avatar` (or the existing initial disc), name `dir="auto"`, and role label from `apps/web/src/i18n/labels.ts`. **Open work**: this branch's open tasks, title `dir="auto"`, with an overdue or due-today marker. Each panel caps at about six rows and ends with a link out, to `/people` and `/tasks` respectively. Each panel shows its own empty state.

6. **The danger zone**, rendered only when `isSuperAdmin(principal.role)`: a single destructive-tone "Delete branch" control at the bottom, well clear of Save, opening the existing `AlertDialog` to confirm. It keeps the current 409 behaviour: on `ApiError` with status 409, show the "move them first" instruction and leave the page open; on success, navigate back to `/locations`.

**States:** while any of the three queries is pending, render `Skeleton` in the shape of the page rather than a spinner. If the branch id matches nothing once the list has loaded, render a short not-found block with the back link, since a branch admin asking for another branch legitimately sees this.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/features/locations/branch-screen.test.tsx`, mirroring the provider setup in `location-management.test.tsx` and adding a `MemoryRouter` with `initialEntries={['/locations/<id>']}` plus a `Routes` entry for `locations/:id`. Cover:

- renders the branch name, address, city and phone from the record
- pressing "Edit branch" reveals inputs holding the current values, and the page does not unmount (assert an element present before the click is still present after)
- editing the phone and saving sends exactly one `locationsApi.update` call whose body carries the changed field
- Cancel restores the plate and sends no call
- the overdue tile carries the destructive class only when the count is above zero
- "Delete branch" renders for a `super_admin` principal and does not for an `admin` principal
- a 409 on delete shows the in-use instruction and stays on the page

Stub `locationsApi.list`, `authApi.listUsers` and `tasksApi.board` the way the sibling test file does.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w apps/web run test -- branch-screen`
Expected: FAIL against the Task 2 placeholder, which renders only a name.

- [ ] **Step 3: Build the page**

Follow the surface described above. Keep the file focused: if it grows past roughly 300 lines, split the plate, the KPI row and the two panels into sibling components in the same folder rather than letting one file do everything.

- [ ] **Step 4: New strings, both locales**

Every label the page introduces goes into both `en` and `he`: the edit and save controls, the four tile labels, the two panel headings and their empty states, the two links out, the delete control and its confirmation, the not-found block, and the invitation to add contact details. Write real Hebrew, not transliterated English.

- [ ] **Step 5: Run the tests**

Run: `npm -w apps/web run test`
Expected: PASS, whole web suite.

- [ ] **Step 6: Full verification**

Run: `npm run typecheck && npm -w apps/api run test && npm -w apps/web run test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web
git commit -m "feat(web): the branch page reads as its own small dashboard"
```

---

## Manual verification before opening the PR

Localhost runs on web 5630 and API 3820 against the `burgers_locations` database, seeded with two branches (Dizengoff, Haifa Port), five tasks and two accounts: `admin@burgers.local` / `change-me-locally` (chain owner) and `dana@burgers.local` / `Branch-2026!` (admin of Dizengoff).

- [ ] As the owner, open a branch, add an address, a city and a phone, save, and confirm the plate shows them and a reload keeps them.
- [ ] Confirm the KPI numbers for a branch match that branch's rows on the Tasks board.
- [ ] As Dana, confirm the list shows one branch, opening it works, editing it works, and no Delete control renders.
- [ ] Switch the interface to Hebrew and confirm the page mirrors: the back affordance, the plate, the panels and the KPI row all flip, and no text is clipped.
- [ ] Check the page at 375px wide and confirm nothing scrolls sideways.
