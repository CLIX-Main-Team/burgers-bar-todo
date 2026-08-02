# Research: SPA + native auth options for the invite-only email/password flow

Investigation for issue #11 (parent #10; feeds the auth grilling #12). This captures facts
the auth decision waits on. It does not pick a winner.

## Scope

The architecture is decided: a Vite + React 19 SPA, later wrapped in Capacitor (Android then
iOS), talking cross-origin over HTTPS to a dedicated Hono/Node API on Postgres via Drizzle ORM,
with a shared zod package. There is no Supabase; auth is rebuilt in the API. (This note framed
the API as Hono; grilling #13 later fixed the framework as Fastify — see ADR-0009. The Hono
references throughout are preserved as the point-in-time record of what #11 investigated.)

The flow to support (ADR-0005): invite-only with no public signup and the first admin seeded at
deploy; email + password login; an invite that is a single-use, roughly 7-day-expiry, one-time
set-password link; role and location baked into the invite and immutable by the recipient;
persistent sessions until explicit logout; forgot-password reset email; soft deactivation that
blocks login and revokes the session while retaining the row (status invited, active, or
deactivated). Roles are admin (cross-location), manager (single location), and employee;
location is a tenant-scope attribute.

Three options were compared: better-auth, Lucia, and a hand-rolled JWT (access + refresh) with
argon2. Each was evaluated on six axes: native token storage and refresh, invite and reset,
session revocation, role/location claims, stack fit, and maintenance burden.

## Current status of each option (2026)

better-auth is actively developed and well past 1.0. The stable line is 1.6.x (1.6.14 cited in a
June 2026 security post); 1.4 (Nov 2025) introduced stateless sessions, 1.5 (Feb 2026) added
stateless auth and SCIM, and 1.7 was in beta/RC by mid-2026. It is a maintained framework.
Sources: https://github.com/better-auth/better-auth/releases , https://better-auth.com/blog/1-4 ,
https://better-auth.com/blog/security-update-june-2026 .

Lucia is deprecated as a library. The official site states verbatim: "Lucia was deprecated in
March 2025. This website was updated in July 2026" (https://lucia-auth.com/). The maintainer's
announcement explains it: "Lucia, in the current state, is not working. I now implement sessions
from scratch and don't use the library for my personal projects," citing database adapters as "a
significant complexity tax" and the library being "too low level and simple for the burden to be
worthwhile." The plan was to keep v3 alive roughly six more months and convert Lucia into "a
learning resource on implementing auth from scratch" where "you'll essentially recreate Lucia v3
in your project" (https://github.com/lucia-auth/lucia/discussions/1707). Practical meaning for a
team adopting in 2026: there is no maintained npm package to adopt. Using Lucia means copying
reference code into your repo and owning it, which is functionally a hand-rolled approach with a
good template. The related libraries Arctic and Oslo (OAuth and crypto primitives) remain
maintained. Migration guide: https://lucia-auth.com/lucia-v3/migrate ; v3 archive docs:
https://v3.lucia-auth.com/ .

Hand-rolled JWT + argon2 is a pattern, not a product. The libraries it leans on are maintained:
`@node-rs/argon2` or `argon2` (node-argon2) for hashing, plus a JWT library such as jose.

## Option A: better-auth

Native token storage and refresh. better-auth is cookie-first by default, and its cookies are
httpOnly and secure in production (https://better-auth.com/docs/concepts/cookies). That default
is the problem inside a Capacitor shell because the WebView origin and the API origin are
different registrable domains, making the auth cookie cross-site. Capacitor origins are fixed by
the platform: Android defaults to androidScheme https with hostname localhost, so the app runs at
https://localhost; iOS uses capacitor://localhost, and the iOS scheme "can't be set to schemes
that the WKWebView already handles, such as http or https"
(https://capacitorjs.com/docs/config). Your API on some api.example.com is therefore a different
site. On iOS/WKWebView, WebKit blocks cross-site cookies by default under ITP: "Cookies for
cross-site resources are now blocked by default across the board" (Safari 13.1 / iOS 13.4,
https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/). better-auth's own docs
acknowledge this: "If your Better Auth API is hosted on a different domain than your frontend,
Safari may block authentication cookies entirely" (https://better-auth.com/docs/concepts/cookies).
On Android WebView, third-party cookies are disabled by default since Android 5.0 and require an
explicit CookieManager.setAcceptThirdPartyCookies() call; from Android 12 (target API 31+),
cookies without SameSite are treated as Lax and SameSite=None requires Secure
(https://developer.android.com/reference/android/webkit/CookieManager ,
https://developer.android.com/about/versions/12/behavior-changes-12).

This is why header-based bearer tokens are the recommended native path. better-auth ships a bearer
plugin: after sign-in the server returns the token in a set-auth-token response header; the docs
say to store the token securely and configure the client to send Authorization: Bearer. The
server still authenticates via auth.api.getSession as long as the Authorization header is present,
so the token is looked up against the DB session and this is not a stateless JWT. The plugin
carries an explicit warning: "Use this cautiously; it is intended only for APIs that don't support
cookies or require Bearer tokens for authentication" and has a requireSignature option (default
false) (https://www.better-auth.com/docs/plugins/bearer). The doc's storage example uses
localStorage; inside Capacitor you would instead persist the token in device-secure storage
(Keychain on iOS, AndroidKeyStore on Android) via a plugin such as capacitor-secure-storage-plugin
(https://github.com/martinkasa/capacitor-secure-storage-plugin), because @capacitor/preferences is
"a simple key/value persistent store for lightweight data" with no encryption claim
(https://capacitorjs.com/docs/apis/preferences). better-auth's only first-party native story is
Expo, which confirms the difficulty: it uses expo-secure-store and requires manual cookie handling
because "to make authenticated requests to your server that require the user's session, you have
to retrieve the session cookie from SecureStore and manually add it to your request headers,"
using credentials: "omit" (https://www.better-auth.com/docs/integrations/expo). There is no
Capacitor-specific integration doc; you would adapt the bearer plugin yourself. Refresh: sessions
default to a 7-day expiry that auto-extends when the updateAge threshold (default 1 day) is
reached; there is no separate short-lived-access plus refresh-token rotation in the core model,
the session token itself is the credential and its DB expiry is extended on use
(https://www.better-auth.com/docs/concepts/session-management).

Invite and reset. Password reset is first-party: requestPasswordReset() triggers a
sendResetPassword callback that you wire to your emailer, resetPassword() consumes the token, and
expiry is configurable (https://www.better-auth.com/docs/authentication/email-password). Sign-up
can be closed with emailAndPassword: { disableSignUp: true }. There is no built-in generic
single-use set-password invite primitive for plain email+password; the closest first-party feature
is the organization plugin's invitation system (createInvitation/inviteMember, acceptInvitation,
invitationExpiresIn default 48 hours, per-member roles, members tied to an organization,
https://www.better-auth.com/docs/plugins/organization). That maps onto "location as tenant" (org =
location) and "role baked into invite," but brings org semantics you would accept or bend. Without
the org plugin, the roughly 7-day single-use set-password invite is something you build on top of
better-auth.

Session revocation. Sessions are DB-backed by default, so revocation is a row operation:
revokeSession, revokeOtherSessions, revokeSessions, listSessions
(https://www.better-auth.com/docs/concepts/session-management). For deactivation, the admin plugin
models it directly: banUser "bans a user, preventing them from signing in and revokes all of their
existing sessions," with revokeUserSessions and setRole
(https://www.better-auth.com/docs/plugins/admin). Ban approximates your deactivated status though
the vocabulary (ban, banReason, banExpires) does not match invited/active/deactivated exactly. One
caveat undercuts instant revocation: if cookieCache is enabled, session data is cached client-side,
"potentially delaying revocation across devices until cache expiry"
(https://www.better-auth.com/docs/concepts/session-management).

Role and location claims. Two mechanisms. Custom fields via additionalFields on user or session
(for example a role union and a location string, with input: false to make them server-owned and
immutable by the recipient) automatically appear in session objects and API responses
(https://www.better-auth.com/docs/concepts/database). Because the session is a DB lookup, the API
reads role/location from the resolved session, trustworthy without signature verification.
Alternatively the JWT plugin issues signed JWTs with custom claims and a JWKS endpoint, but the
docs stress "the JWT plugin is not meant as a replacement for the session"
(https://www.better-auth.com/docs/plugins/jwt). For a single Hono API the session-lookup path
covers role and location without JWTs.

Stack fit. First-class Drizzle adapter (drizzleAdapter(db, { provider: "pg" })) with CLI schema
generation (npx @better-auth/cli generate) (https://www.better-auth.com/docs/adapters/drizzle).
Hono integration is documented: mount with app.on(["POST","GET"], "/api/auth/*", c =>
auth.handler(c.req.raw)), hono/cors with credentials: true, and session middleware via
auth.api.getSession (https://www.better-auth.com/docs/integrations/hono). TypeScript-native, but
it owns its own schema and tables rather than composing into your existing zod-typed schema; your
shared zod validators would wrap the API surface, not better-auth's internal tables.

Maintenance. You adopt a maintained dependency: login, reset, session lifecycle, hashing, and
CLI-generated schema come for free, and security fixes are the vendor's. Costs at small scale: it
pulls in schema and plugin surface you do not fully control, the Capacitor bearer path is
self-assembled, and mapping its org/admin/ban vocabulary onto your model is adaptation work. The
password-hashing default is scrypt, not argon2: "Better Auth uses scrypt to hash passwords"
(https://www.better-auth.com/docs/authentication/email-password); argon2 would be a custom hasher
override.

## Option B: Lucia

Status gate first. Because Lucia is deprecated as a library, every axis is really "what the
learning-resource code gives you if you copy it in." There is no package to npm install and track;
adopting Lucia in 2026 means vendoring reference code you then own and maintain
(https://lucia-auth.com/ , https://github.com/lucia-auth/lucia/discussions/1707 ,
https://lucia-auth.com/lucia-v3/migrate).

Native token storage and refresh. Lucia's model is a session ID (an opaque token) validated
against a DB row, so it is transport-agnostic. v3 defaulted to cookies, but because you own the
code, sending the session token as an Authorization: Bearer header and storing it in Capacitor
secure storage is a trivial change with no plugin boundary to fight. The cross-site-cookie
constraints from Option A (WKWebView ITP, Android WebView defaults, the Capacitor origins) apply
identically; they are platform facts, not library facts. Refresh uses sliding expiration (extend
expiresAt on validation), the same shape as better-auth, not access+refresh rotation
(https://v3.lucia-auth.com/ , https://github.com/lucia-auth/lucia/discussions/1707).

Invite and reset. Nothing built-in as a shipped feature; the learning resource covers "full
implementations (2FA, password reset, email verification, rate limiting, passkeys)" as guides you
adapt (https://github.com/lucia-auth/lucia/discussions/1707). Invite single-use set-password links
are entirely yours. For invite and reset, Lucia is essentially hand-rolled with reference
snippets.

Session revocation. Strong fit conceptually: DB-backed sessions by design, so revoke = delete the
row, and deactivation = block login on the user row plus delete sessions. Exactly the stateful
revocation soft-deactivation wants, no denylist needed, but you implement the deactivate semantics
yourself.

Role and location claims. Lucia v3 exposes session and user attributes you define and surface
through getUserAttributes when validating a session; since it is a DB lookup you add role and
location columns and read them off the validated session, trustworthy with no signing. You own the
typing (https://v3.lucia-auth.com/).

Stack fit. v3 had a Drizzle adapter, but adapters were the earliest-deprecated part ("database
adapters have been a significant complexity tax ... adapters may be deprecated earlier",
https://github.com/lucia-auth/lucia/discussions/1707). The 2026 direction is no adapter at all;
you write the couple of Drizzle queries directly, which composes cleanly with your Drizzle schema
and shared zod. No official Hono adapter, but session-in-header validation is a few lines of your
own middleware. Everything is TypeScript.

Maintenance. Two-sided. No dependency to track and no vendor schema imposed; the code is "very
short and simple, and infinitely customizable" and you own it outright, which suits a small team's
preference for legible code. But there are no upstream security patches, bug fixes, or feature
additions; maintenance is entirely yours, and you build invite/reset/deactivation from templates.
For a small team this is essentially the hand-rolled option with a vetted starting point and a
good conceptual guide.

## Option C: Hand-rolled JWT (access + refresh) with argon2

Native token storage and refresh. This pattern is header-native from the start, which sidesteps
every cross-site-cookie problem in Option A (WKWebView ITP, Android WebView defaults, the
https://localhost / capacitor://localhost origin mismatch). You issue a short-lived access JWT plus
a long-lived refresh token; the SPA sends Authorization: Bearer and, in Capacitor, persists both in
secure storage (Keychain / AndroidKeyStore via
https://github.com/martinkasa/capacitor-secure-storage-plugin, not the unencrypted
@capacitor/preferences, https://capacitorjs.com/docs/apis/preferences). Refresh is fully yours to
design: the access token expires in minutes, the client calls a /refresh endpoint with the refresh
token to mint a new access token, and you decide rotation, reuse-detection, and refresh-token
storage. Most work, most control, cleanest native fit.

Invite and reset. Entirely yours: the invite token (single-use, roughly 7-day expiry, role and
location baked in and server-owned), the set-password endpoint, and the forgot-password reset token
and email. No library gives these, but they are standard token-table patterns and your shared zod
package types the request/response bodies.

Session revocation, the central JWT trade-off. This is where stateless JWT bites. A signed access
JWT is self-validating and cannot be revoked before it expires; there is no server lookup to fail.
So soft-deactivation cannot instantly kill an in-flight access token. The standard mitigation is to
keep the access token short-lived (window of minutes) and make the refresh token stateful: store
refresh tokens (or a session row) in Postgres and revoke by deleting/denylisting on deactivation so
the user cannot mint new access tokens. This is the concrete contrast: stateful (better-auth or
Lucia: revoke = delete session row, effect immediate) versus stateless JWT (revoke the refresh side
plus rely on short access expiry; the live access token lingers until it expires). If you instead
use DB-backed sessions with an opaque token and no JWT, you get instant revocation but have
essentially rebuilt Lucia/better-auth's session model.

Role and location claims. You embed role and location as signed JWT claims; the API verifies the
signature and trusts them with no DB lookup, the lowest-latency option for carrying tenant scope.
The cost is the flip side of revocation: claims are only as fresh as the token, so a role/location
change or deactivation does not take effect until the access token expires and is refreshed. You
own the claim schema and can type it with zod.

Stack fit. Best raw fit because you write it against your exact stack: your Drizzle tables (users,
sessions or refresh tokens, invites, reset tokens), your shared zod validators as the single source
of truth, plain Hono middleware verifying the bearer token. Nothing imposes a schema. A JWT library
(jose) and an argon2 library are the only dependencies. On hashing: @node-rs/argon2 is a Rust/NAPI
binding with no node-gyp, default variant Argon2id, defaults memoryCost 19456, timeCost 2,
parallelism 1, outputLen 32 (https://github.com/napi-rs/node-rs/tree/main/packages/argon2); argon2
(node-argon2) defaults to argon2id and outputs PHC-format strings with embedded salt, and "for
password hashing there is no need to modify" the defaults (https://github.com/ranisalt/node-argon2).
Either gives argon2id with sane defaults. This is the one place better-auth differs: its default is
scrypt, so wanting argon2 specifically is itself an argument toward hand-rolling or overriding.

Maintenance. Highest build cost, lowest dependency surface. You own login, hashing wiring, JWT
issue/verify/refresh, invite, reset, deactivation, and all their edge cases (token reuse, refresh
rotation, clock skew, denylist cleanup) plus their security correctness, which is exactly the kind
of logic the project's rule-5 human-review gate flags. Upside for a small team: no framework schema
to track, no upstream churn, code shaped exactly to the three roles plus location. Downside: no free
security patches.

## Cross-cutting summary by axis

Native token transport: all three end up at bearer-header plus secure storage in Capacitor.
better-auth reaches it via an opt-in plugin flagged "use cautiously"; Lucia and hand-rolled are
header-native because you own transport. The cookie problem is a platform fact (ITP, Android
WebView, Capacitor origins), not a library defect.

Invite and reset: better-auth gives reset first-party and invites only via the org plugin (48h
default, org semantics); Lucia gives templates; hand-rolled gives nothing but is straightforward
token-table work. The specific "single-use roughly 7-day set-password invite, role and location
baked and immutable" is custom in all three unless you adopt better-auth's org plugin.

Revocation: better-auth and Lucia are DB-backed, so revoke is instant by row delete (better-auth
caveat: cookieCache delays it). Pure stateless JWT cannot revoke a live access token, so short
expiry plus a stateful refresh denylist.

Claims: session-lookup (better-auth additionalFields, Lucia attributes) is always fresh but needs a
lookup; JWT claims are zero-lookup but stale until refresh.

Stack fit: better-auth has the richest Drizzle and Hono tooling but imposes its schema and defaults
to scrypt; Lucia in 2026 expects you to write the Drizzle queries; hand-rolled fits your zod/Drizzle
exactly and lets you pick argon2id.

Maintenance: better-auth is a maintained dependency with adaptation cost; Lucia is vendored code you
own with no upstream; hand-rolled is the most code and you own all security correctness.

## Facts the decision waits on

1. Is Lucia acceptable given it is a deprecated learning resource, not a maintained package?
   Adopting it means owning vendored code with no upstream patches. If "no unmaintained deps" is a
   hard rule, Lucia collapses into "hand-rolled with a template."
2. Is instant soft-deactivation a hard requirement? If yes, it argues for DB-backed or opaque-token
   sessions over pure stateless JWT; with better-auth, confirm cookieCache is off so revocation is
   not delayed.
3. Do you accept better-auth's scrypt default, or is argon2id mandatory? argon2 means overriding
   better-auth's hasher, or choosing Lucia/hand-rolled.
4. Will you model location as a better-auth organization (to reuse its invitation system, 48h
   default, per-member roles) or as a plain additionalFields/column tenant attribute? This decides
   whether better-auth's invite machinery is usable or whether invites are custom in every option.
5. Do you want role and location as always-fresh session data (lookup) or zero-lookup signed claims
   (stale until refresh)? This shapes both hand-rolled and whether you would add better-auth's JWT
   plugin.
6. Are you willing to own security-critical auth code (refresh rotation, token reuse, denylist)
   yourself, triggering the project's human-review-on-security rule, versus delegating to a
   maintained framework? This is the core better-auth versus hand-rolled/Lucia axis.
7. There is no first-party Capacitor integration for better-auth (only Expo); confirm the team is
   comfortable assembling the bearer plus secure-storage path itself.
8. Secure token storage plugin choice for Capacitor (Keychain/AndroidKeyStore) is required in all
   three; @capacitor/preferences is unencrypted and unsuitable.

## What this means for the decision

The native shell reframes the whole choice. Because a Capacitor WebView loads from
https://localhost or capacitor://localhost and the API is a different site, cross-site auth cookies
are blocked by default on both iOS (WKWebView ITP) and Android WebView. Every option therefore
converges on the same transport: a bearer token in an Authorization header, held in device-secure
storage. That erodes better-auth's cookie-first convenience (its native path is an opt-in bearer
plugin the docs tell you to use cautiously, with no Capacitor integration) and neutralizes what
would otherwise be its biggest edge over the hand-rolled route.

From there the trade-off is a triangle. better-auth buys you maintained login, reset, session
lifecycle, a Drizzle adapter, and Hono docs, at the cost of adopting its schema and vocabulary
(ban rather than deactivate, org rather than location, scrypt rather than argon2) and assembling
the native path yourself. Lucia is, in 2026, no longer a library at all, so choosing it is
choosing to vendor and own reference code, which is hand-rolling with a template and a good guide.
Hand-rolled gives the cleanest fit to the exact stack (Drizzle, zod, Hono, argon2id) and the
cleanest native story, at the cost of owning every line of security-critical code and its edge
cases. Cutting across all three is the stateful-versus-stateless question: DB-backed sessions
(better-auth, Lucia, or an opaque-token hand-roll) give instant soft-deactivation and always-fresh
role/location at the price of a per-request lookup, while stateless JWT claims give zero-lookup
scope-carrying at the price of revocation that lags until the short access token expires. The
grilling (#12) settles which of maintenance leverage, exact-stack control, and revocation
semantics the project weights highest; this research does not pick among them.
