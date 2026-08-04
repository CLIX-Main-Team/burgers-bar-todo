# End-to-end tests

Playwright specs that drive the built SPA under `vite preview`. This folder's map: the live
backbone and how to run it, the specs themselves, and the **fixture cast** the live specs read
from a real database.

## The live backbone

The lane runs the browser against the **real** API on a real Postgres, not a wall of route
stubs (part of the full-stack e2e lane, #151). Two webServers come up before any test
([`playwright.config.ts`](../playwright.config.ts)):

1. the real `server.ts` on `:3000`, readiness polled on `/health`, fed an e2e env that clears
   the whole boot — a dummy provider key past the ADR-0018 fail-fast (the assistant is never
   exercised here), SMTP pointed at mailpit, and `CORS_ORIGIN` set to the preview origin;
2. `vite build && vite preview` on `:4173`, built with `VITE_API_BASE_URL=http://localhost:3000`
   so the bundle's fetches hit the API above.

A **setup project** ([`auth.setup.ts`](./auth.setup.ts)) then resets + migrates the database,
loads the fixture cast (below), and signs each of the three personas in through the real
`POST /auth/sign-in`, saving a per-role `storageState` under `.auth/` (gitignored, regenerated
every run).

### Projects

| Project | Specs | Session |
| --- | --- | --- |
| `setup` | `auth.setup.ts` | — (seeds the DB, writes the sessions) |
| `chromium` | every `*.spec.ts` **except** `*.live.spec.ts` | stubbed at the browser edge — no live backend |
| `live-admin` / `live-manager` / `live-employee` | `session.live.spec.ts` | the persona session the setup saved, attached per role |
| `live-people` | `people.live.spec.ts` | all three persona sessions — attached per role at the `describe` level (`test.use`), since each read test is role-specific |
| `live-account-menu` | `account-menu.live.spec.ts` | all three persona sessions — attached per role at the `describe` level (`test.use`), since the menu is role-branched; the spec pins a phone viewport (mobile menu only) |
| `live-shell` | `shell.live.spec.ts` | all three persona sessions — attached per role at the `describe` level (`test.use`); the spec pins a phone viewport, so it covers the bottom-bar shell (the desktop side nav stays stubbed in `shell.spec.ts`) |
| `live-login-form` | `login-form.live.spec.ts` | none — drives the real login form to obtain one |

The naming convention is the whole rule: a **`*.live.spec.ts`** spec uses the live backbone (and
depends on `setup`); every other spec stubs the API with `page.route` and needs neither Postgres
nor the setup, so the pre-existing suite keeps passing untouched.

### Running the lane locally

The stubbed specs need nothing but `npx playwright test`. The live specs need Postgres and
mailpit up:

```sh
docker compose up -d db mailpit      # the repo's local infra (Postgres 17 + mailpit)
npx playwright test                  # from apps/web — builds the SPA, boots the API, runs the lane
```

The live lane uses a **dedicated `burgers_e2e` database** so it never clobbers the `burgers` dev
DB the same Postgres hosts; the setup **creates it if absent**, so the `docker compose` line is
the only manual step. One footgun: the API webServer sets `reuseExistingServer` locally, so if
your own dev API is already running on `:3000` (pointed at the `burgers` dev DB) Playwright reuses
it, and every persona sign-in 401s against the wrong database. Stop the dev API before running the
live lane. Override the whole URL with `E2E_DATABASE_URL` if your Postgres differs
(this is exactly what CI sets to point at its `postgres:17` service). To run only part of the
live lane, target its projects, e.g.
`npx playwright test --project live-manager --project live-login-form`.

In CI the same two servers run, with `postgres:17` and `mailpit` declared as job `services:` at
fixed ports sharing that one `DATABASE_URL` (see [`ci.yml`](../../../.github/workflows/ci.yml)).

## The fixture cast

The fixture cast is a fixed, deterministic set of Locations and Users that the live e2e lane
loads into a fresh migrated Postgres before the browser runs (part of the full-stack e2e lane,
#151). Personas sign in through the real API; list/scope specs read the roster the real API
scopes and returns. It is **test-only** and has nothing to do with the production seed — see
[Not the production seed](#not-the-production-seed).

It is eight users spanning **3 roles × 3 statuses × 2 Locations, plus a Location-less admin**,
so every `/people` list section and every scope branch has real data behind it:

| Name         | Role     | Location | Status      | Logs in?         |
| ------------ | -------- | -------- | ----------- | ---------------- |
| Ada Admin    | admin    | — (chain-wide) | active      | yes (persona)    |
| Mia Manager  | manager  | A        | active      | yes (persona)    |
| Eli Employee | employee | A        | active      | yes (persona)    |
| Ivy Invitee  | employee | A        | invited     | no               |
| Ash Active   | employee | A        | active      | no               |
| Mona Manager | manager  | A        | invited     | no               |
| Ben Bee      | employee | B        | active      | no               |
| Dan Gone     | employee | B        | deactivated | no               |

- **Personas** (Ada, Mia, Eli) are the only rows that carry a known password, so they are the
  only rows a test signs in as.
- The two **invited** rows (Ivy, Mona) are genuine Invites: a real `user(status=invited)` plus a
  live `auth_tokens(purpose=invite)` row, produced by the same token primitive the app's
  create-invite path uses.
- **Preferred language** is left at the column default; the `/people` list does not render
  language, so it is fixture data no test reads.

### Pinned ids

Every row has a pinned, deterministic UUID so specs can address known rows. Locations take the
`2`/`3` nibbles; the eight users take `4`–`b`, one nibble each (`4` Ada … `b` Dan). The ids and
persona passwords are exported alongside the loader as `FIXTURE_LOCATION_IDS`,
`FIXTURE_USER_IDS`, `FIXTURE_PERSONA_PASSWORDS`, and `FIXTURE_USERS`.

### How it is built — `loadFixtureCast`

The cast is realized by a single seam,
[`loadFixtureCast(deps)`](../../api/test/helpers/fixture-cast.ts), which lives with the API
integration harnesses (`apps/api/test/helpers/*`) because it composes over the API's own
repositories and services and its focused check needs a real migrated database.

`loadFixtureCast` builds every row **only over the seams the app already uses**, the same way
`createAuthComponents` and the integration harness compose them — no raw SQL, no new low-level
seam:

- `createLocation` writes the two Locations (with pinned ids).
- Each user starts as a pending invite via `createInvitedUser` (role and Location baked in).
- Active rows are then activated with `activateInvitedUser`, which sets the password
  (personas get their known password; the never-login rows get a shared throwaway).
- The two invited rows instead mint a real invite token via the token service and stop there.
- The deactivated row is activated and then cut with `deactivateUser`.

Its focused check — [`apps/api/test/fixture-cast.test.ts`](../../api/test/fixture-cast.test.ts)
— runs `loadFixtureCast` against a fresh Testcontainers Postgres and asserts the cast's shape
and per-role/scope contents through the real `listUsers` seam. The live e2e lane also exercises
it implicitly: if the cast is wrong, the list specs fail.

### How specs use it

The cast is a **read-only baseline**. List / scope / visibility specs only read it, so they are
inherently parallel- and retry-safe. Mutating specs (invite / duplicate-409 / revoke / resend)
never touch the baseline; each creates its own uniquely-keyed invite through the real API and
asserts on that row, so `fullyParallel` stays on and retries never collide on shared state.

### Not the production seed

The fixture cast is a distinct, test-only concept. "Seed" stays reserved for the ADR-0005
first-admin insert (`seedAdmin` / `apps/api/src/seed.ts`). `loadFixtureCast` is never wired into
the production boot path, so its fake people can never reach a production database. That is why
it is documented here, next to the tests that use it, rather than in `CONTEXT.md` — it is test
infrastructure, not domain ubiquitous language.
