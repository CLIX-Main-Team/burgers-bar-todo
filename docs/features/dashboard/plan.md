# Dashboard, round 3: implementation plan

> For agentic workers: use superpowers:executing-plans (or subagent-driven-development) to work
> through the tasks in order. Steps use checkbox syntax for tracking.

**Goal:** ship the design in design.md: the cool grey day palette app-wide and the new dashboard.

**Architecture:** pure metric functions over the one board read (unit tested), one small file per
card, and a thin screen that owns the queries, the two filters, the role gating and the entrance
score. No new endpoint and no charting library: the charts are hand-drawn SVG like the round-11 ring.

**Tech stack:** React 19, TanStack Query, Tailwind v4 tokens in apps/web/src/index.css, use-intl,
vitest, Playwright.

## Global constraints

- Worktree `.claude/worktrees/dashboard-redesign`, branch `feat/dashboard-redesign`.
- Local stack: API 3590, web 5650, database `burgers_dashboard` (demo seed in the gitignored
  `temp-folder/scripts/seed-dashboard-demo.mjs`).
- Every colour is a token; semantic tokens reference primitives, never literals (tokens.md rule).
- Never a named `max-w-*` utility (the spacing scale redefines them); never mix named and arbitrary
  breakpoints on one property.
- A Hebrew value in a shared column sits in `<bdi>`, never `dir="auto"` on the cell.
- Entrances fill `backwards`, never `both` (a filled transform breaks menus and drag).
- Every i18n key exists in both `en` and `he`. No em dashes in copy.
- Lint runs on touched files only (CRLF makes a whole-tree run meaningless on Windows).

## Task 1: the cool grey day palette

**Files:** modify `apps/web/src/index.css` (the `--bb-neutral-*` ramp, `--bb-ink`, the rgb literals
built on the old ink, the status, soft-status and priority tones in both themes, the green, red and
orange primitives), `docs/design-system/tokens.md` (a leading round-16 block).

- [ ] Recut `--bb-neutral-100..900` to the cool ramp (100 #F6F7F9, 200 #F1F2F4, 300 #E7E9ED,
  400 #E0E3E8, 500 and 600 #C9CDD4, 700 #5D6370, 800 #464B55, 900 #353943) and `--bb-ink` to
  #14161A. Step names stay, so every reference follows.
- [ ] Re-base the alpha literals on the new ink (`--bb-lane`, `--selected-soft`, the day shadows,
  `--priority-normal-soft`, `--filetype-generic-soft`).
- [ ] Crisper tones. Day: done #16A34A / ink #15803D, in progress #2563EB / #1D4ED8, to do #D97706 /
  #B45309, soft pairs success #E3F5EA/#15803D, warning #FDF1DD/#B45309, destructive #FDE8E8/#B91C1C,
  priority medium #A16207, high #7C3AED; primitives green-600 #15803D, red-600 #DC2626, orange-600
  #B45309. Night: done #4ADE80, in progress #60A5FA, to do #FBBF24, red-400 #F87171, green-300
  #4ADE80, orange-300 #FBBF24, soft pairs #13291C/#86EFAC, #33260D/#FCD34D, #3A1717/#FCA5A5,
  priority medium #EAB308, high #A78BFA.
- [ ] Measure every text pair at 4.5:1 and every mark at 3:1 on the surfaces it lands on (script
  in the scratchpad, WCAG relative luminance). Fix any miss before moving on.
- [ ] Screenshot Tasks, Projects, Users, Knowledge, Locations, Assistant and sign-in in light and
  dark and look for anything that meant "greige" implicitly.
- [ ] Commit: `feat(web): day turns cool grey and the status tones sharpen`.

## Task 2: the metrics

**Files:** modify `apps/web/src/features/dashboard/dashboard-metrics.ts` and its test.

**Interfaces produced** (all pure, all take `now: Date`, all ignore nothing but what they say):

- `overviewMetrics(tasks: SharedTask[], now): Overview` with `open, overdue, dueToday,
  dueTodayStarted, inProgress, inProgressPlaces, oldestOverdueDays (number | null), doneThisWeek,
  doneLastWeek`. "This week" is the last 7 local days including today; "last week" the 7 before.
- `activitySeries(tasks, now, days: number): ActivityDay[]` with `{ date: Date (local midnight),
  created, completed }`, oldest first, exactly `days` entries, zero-filled.
- `workload(tasks, now): PersonWorkload[]` with `{ userId, name, avatarTone, overdue, todo,
  inProgress, open }`; a task counts once per assignee and in exactly one of the three parts; sorted
  overdue desc, open desc, name.
- `placeRows(tasks, names: Map<string,string>, now): PlaceRow[]` with `{ id, name, open, overdue }`
  for every named place holding open work; sorted overdue desc, open desc, name.
- `branchHealth(tasks, branchIds: string[], now): { behind, onTrack, clear }` over exactly the given
  branches (a branch with no tasks is clear).
- `departmentRows(tasks, subjectDepartment: Map<string,string>, departments: {id,name}[], now):
  PlaceRow[]` in the same shape and order as placeRows.
- `attention(tasks, now): { overdue, dueToday, high }` lists of open tasks: overdue most late first,
  due today high priority first, high by nearest due date (undated last).
- Keep `shiftMetrics` and `priorityMix` (the branch page reads the first). Delete `assigneeLoad`,
  `branchBreakdown` and `paginate` with their tests once nothing imports them.

- [ ] Write the failing tests, one `describe` per function, pinning the cases a naive count gets
  wrong: a done task is never overdue or due, the partition in `workload` never double counts, a
  branch with no tasks is clear, activity buckets by LOCAL day, a done task completed outside the
  window is not counted, the head office is never counted as a branch.
- [ ] Run `npx vitest run src/features/dashboard` from apps/web: expect failures.
- [ ] Implement until green.
- [ ] Commit: `feat(web): the dashboard's new arithmetic`.

## Task 3: the chart geometry

**Files:** create `apps/web/src/features/dashboard/chart-geometry.ts` and its test.

- `monotonePath(points: [number, number][]): string`: a Fritsch-Carlson monotone cubic through the
  points (smooth, never overshoots below zero or above a peak), `M` plus one `C` per segment.
- `niceMax(value: number): number`: the smallest of 4, 8, 12, 16, 20, 40, 60, 80, 100, then
  multiples of 50, that is at least `value`, so the four grid steps land on round numbers.

- [ ] Tests: a flat series gives flat control points, a peak is never exceeded, niceMax(0) is 4,
  niceMax(13) is 16, niceMax(101) is 150.
- [ ] Implement, run, commit with Task 4.

## Task 4: the cards

**Files:** create `hero-card.tsx`, `overview-card.tsx`, `activity-card.tsx`, `workload-card.tsx`,
`chain-card.tsx`, `attention-card.tsx`, `projects-card.tsx`, `dashboard-card.tsx` (the shared card
shell and head) under `apps/web/src/features/dashboard/`; modify `status-donut.tsx` (thicker ring,
round-trip unchanged API); add the keys to `apps/web/src/i18n/messages.ts` in both languages.

Each card takes already-computed data plus its entrance delay and renders nothing it has not been
handed; the screen decides whether a card exists at all. The visual spec is the approved mockup:
20px card corners, 14px tile corners, tiles on `bg-surface-sunken`, pills that fill with the ink when
chosen, legends always present for two or more series, text in text tokens (never the series
colour), marks carry the colour.

- [ ] Hero, overview, projects (no interaction).
- [ ] Activity: range pills 7/14/30 (default 14), SVG sized by a ResizeObserver, crosshair tooltip on
  pointer and keyboard (the chart is focusable, arrows move the day), mirrored in RTL.
- [ ] Workload: search, eight rows, count of the rest.
- [ ] Chain: two Donut rings with legends, Branches/Departments tabs, six rows, link to Locations.
- [ ] Attention: three tabs with counts, six rows each, link to the board.
- [ ] Commit: `feat(web): the dashboard's new cards`.

## Task 5: the screen

**Files:** rewrite `dashboard-screen.tsx`; delete `dashboard-table.tsx` and `dashboard-fixtures.ts`.

- [ ] Queries: the board (as today), locations when the viewer holds `page.locations` or
  `locations.manage`, departments always, every subject when the department filter could apply,
  projects when the viewer holds `page.projects`.
- [ ] Filters applied before every metric; Branch and Department chips shown only when they can
  narrow something.
- [ ] Role gating: workload not for an employee, chain card only across more than one place.
- [ ] Loading silhouettes shaped like the new grid; the board error state as today.
- [ ] One entrance score for the page.
- [ ] Commit: `feat(web): the dashboard takes its new shape`.

## Task 6: verify and ship

- [ ] `npm -w apps/web run typecheck`, `npx vitest run` in apps/web, `npx biome check` and
  `npx biome lint` on every touched file, `npm -w apps/web run build`.
- [ ] Playwright chromium lane locally (the specs that touch the shell and the dashboard route).
- [ ] Screenshots: super admin, a branch manager and an employee; English and Hebrew; light and dark;
  1440 and 390 wide. Fix what the screenshots show.
- [ ] docs: this folder, its readme, the features map. Push, open the PR, report. Do not merge
  without the owner's word.
