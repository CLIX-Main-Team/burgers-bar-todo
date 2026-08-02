# Continuous integration on GitHub Actions: gates, triggers, and advisory-only enforcement

Status: accepted. This is the first continuous-integration decision in the repo. It sits under
ADR-0009's stack (an npm-workspaces monorepo, a Fastify API, a Vite SPA) and ADR-0010's build
tooling (npm workspaces with a package-lock, Node 22, a dockerized dev environment), and it runs
the test harness those decisions produced — the vitest suite that boots a real Postgres through
Testcontainers (ADR-0010), Biome, and the workspace typecheck. It does not touch the auth
mechanism (ADR-0006), the enforcement model (ADR-0007), or the logging policy (ADR-0011); it
references them only as code the gates now protect. It arose from map #40 (Burgers Bar CI on
GitHub Actions): the platform pass in #41, the core workflow in #42, the stubbed Playwright lane
in #43, and the enforcement question in #44.

## Context

The repo has a test suite, a linter, and a typechecker but nothing ran them automatically. The
API integration suite boots an ephemeral Postgres through Testcontainers and drives the Fastify
app in-process (ADR-0010); Biome lints; each workspace typechecks. Until now these ran only on a
developer's machine, so a pull request could merge red. The gap this decision closes is
automation: every pull request and every push to main should run those checks and show their
result, so a regression is caught at the PR rather than after merge.

The repo is hosted on GitHub, so GitHub Actions is the platform with no separate account or
integration to stand up. Two constraints shape the design. First, the repo is private on a Free
personal account, and Actions minutes are metered (2,000 free minutes a month, 3,000 on Pro, per
the platform pass in #41), so the workflow must not burn minutes on superseded runs or redundant
downloads. Second, the stack is fixed by ADR-0010 and the scaffold that followed it — npm
workspaces with a committed package-lock, Node 22, a Fastify API whose tests need a real
Postgres, and a Vite SPA — so the runner uses npm ci and Node 22, not pnpm, and it needs Docker
available for Testcontainers (ubuntu-latest ships it).

## Decision

### Platform and triggers

GitHub Actions, one workflow file at `.github/workflows/ci.yml`. It runs on two triggers: every
pull request, and every push to the main branch. A concurrency group keyed on the workflow and
the git ref, with cancel-in-progress, kills a superseded in-flight run when a fast-follow commit
lands on the same ref — so a burst of commits burns one run's minutes, not one per commit. The
workflow's token is scoped to `contents: read`; it needs nothing more.

### Jobs: parallel and independent

Four jobs run in parallel, each reporting its own status check, because none depends on another's
output and fanning them out is faster than a single serial job:

- `lint` — `biome ci .`.
- `typecheck` — `npm run typecheck` across the workspaces.
- `test-api` — the API integration suite, `npm test` in apps/api.
- `e2e` — the Playwright lane (below).

Every job runs on ubuntu-latest, checks out, sets up Node 22 with setup-node's npm cache, and
runs `npm ci` (the committed package-lock, ADR-0010, makes the install reproducible). There is no
path-filtering: every job runs on every trigger. At this scale the added minutes are small and
path-filters are a source of subtle "why didn't CI run" bugs; filtering is revisited only if
minutes become tight (see Not-yet-specified on map #40).

### Postgres via Testcontainers, not a service container

`test-api` does not use a GitHub `services:` Postgres. It keeps the Testcontainers harness
(ADR-0010), which spins up an ephemeral Postgres 17 by driving the runner's own Docker daemon.
This is the deliberate choice to run the same harness locally and in CI: one code path, migrated
fresh per run, no second Postgres configuration to keep in sync. Testcontainers adds no cost
beyond runner minutes (no Testcontainers Cloud), and ubuntu-latest provides the Docker daemon it
needs. No secret or service definition is required.

### The Playwright lane: a real pipe, stubbed content

`e2e` is a real end-to-end lane with trivial content. Playwright is installed and configured in
apps/web; its config's webServer runs `vite build && vite preview`, so the job builds the SPA and
serves the static bundle before the test hits it through a real browser. One permanent smoke test
asserts the SPA mounts React into `#root`. The point is to prove the pipe end-to-end now, so that
adding real coverage later is writing tests, not standing up infrastructure. Playwright's browser
download is the expensive part, so the Chromium binary is cached on the resolved Playwright
version; the trace and HTML report upload as an artifact only on failure. This lane stays out of
the required set until real E2E coverage exists (map #40, Not-yet-specified).

### Enforcement: advisory only, by plan constraint

Making the checks required to merge — a red check blocking the merge button — is desirable but is
not possible on the current plan, and this is the correction to #41's platform pass. On a Free
personal account with a private repo, both mechanisms that could require a status check —
per-repository rulesets and classic branch protection — return a hard 403 demanding GitHub Pro
(#44). #41 had recorded that per-repo rulesets were free on a private repo; that was wrong, and
#44 supersedes it.

So CI is advisory: every check runs and shows green or red on the pull request, but none blocks
merge. Merge discipline is social until the plan changes. The fallback costs nothing to reverse:
GitHub already records the four check contexts (`lint`, `typecheck`, `test-api`, `e2e`) from the
runs, so requiring them later is a configuration change with no edit to the workflow. Enforcement
is therefore ruled out of scope for this map, returning only if the owner upgrades to Pro or the
repo goes public — a one-way door that is nobody's to force now, and cheap to walk through later.

## Considered options

A GitHub `services:` Postgres container for `test-api` was rejected in favour of keeping
Testcontainers. A service container would be a second Postgres configuration, wired through
environment variables and diverging from the local harness, for no benefit — the app already
provisions its own database in-process, identically in both places. One harness, one code path.

Path-filtering the jobs (skip test-api when only docs change, and so on) was considered and
deferred. At four small jobs on a low-traffic private repo the saved minutes are marginal, and
filters routinely cause a required check to be silently skipped and then block a merge that is
waiting for a run that will never come. Revisited only if minutes bite.

pnpm was not reconsidered: ADR-0010 settled npm workspaces, so CI uses `npm ci` against the
committed lockfile. Reopening the package manager here would reverse ADR-0010, not configure CI.

Enabling required status checks now was the preferred outcome and was blocked by the plan (#44),
not chosen against. Advisory-only is the graceful fallback, taken because it delivers the visible
gates the map's destination asks for without a plan upgrade, and because it is config-only to
promote later.

## Consequences

Every pull request and every push to main now runs lint, typecheck, the API integration suite,
and the Playwright smoke test in parallel on GitHub Actions, each with its own green-or-red check,
with superseded runs cancelled and npm and Playwright caches keeping minutes and wall-clock down.
The core workflow shipped in PR #46 and the Playwright lane in PR #47; both are green.

Because enforcement is advisory, a red check does not block merge — the guarantee is visibility,
not a hard gate, and it holds only as long as contributors honour it. Promoting to required
checks is a configuration change against the already-recorded contexts once the account is on Pro
or the repo is public; it needs no change to `ci.yml`.

Doc ripple. This ADR is referenced from the Engineering Design's new CI and testing section and
from the ADR index; the Engineering Design's "CI/CD — not yet specified" deferral is narrowed to
note that CI now exists and only the deploy/CD pipeline remains unspecified. The README's testing
section gains a note on how CI gates a pull request. It corrects the enforcement finding of the
#41 platform research (rulesets are Pro-gated on a private Free repo, not free), the correction
having been made on map #40 in #44. It notes forward, without editing, its relationship to
ADR-0009 (the stack the jobs build), ADR-0010 (the npm-workspaces lockfile the install relies on
and the Testcontainers harness the test job runs), and ADR-0011 (logging, unaffected) — those
records stand unchanged (rule 6). CONTEXT.md is untouched: this decision introduces no domain
vocabulary. Deploy and CD automation, Capacitor mobile-build CI, and release/versioning
automation remain out of scope (map #40).
