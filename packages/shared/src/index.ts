import { z } from 'zod'

// The SPA-to-API contract: zod schemas shared by both sides (engineering-design),
// wired into Fastify via fastify-type-provider-zod. Each auth operation's schema
// lands with its slice; this file grows as the surface does.

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
})

export type HealthResponse = z.infer<typeof healthResponseSchema>

// The four roles and the account lifecycle statuses (ADR-0001, ADR-0005), shared so the SPA
// and API name them identically. locationId is null for a super_admin alone.
//
// super_admin arrived with the v2 design (2026-08-20) as a twin of admin and diverged from it on
// 2026-08-23: a super_admin holds the chain, an admin holds exactly one branch and owns it.
//
// Where a site cares which of the two is acting, it asks through one of the predicates below, so
// the question being asked is visible at the call site rather than encoded in a bare comparison.
// A handful of sites do compare against `'admin'` directly, and legitimately: three-way splits
// like invite resolution need "exactly a branch admin, neither the owner above nor the manager
// below", which is a third question neither predicate answers. Reach for a literal only there.
export const roleSchema = z.enum(['super_admin', 'admin', 'manager', 'employee'])
export type Role = z.infer<typeof roleSchema>

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

export const userStatusSchema = z.enum(['invited', 'active', 'deactivated'])
export type UserStatus = z.infer<typeof userStatusSchema>

// ── Role capabilities (owner ask 2026-08-24: the Access page grows switches) ──────────────
//
// What a role MAY DO is no longer only code: each capability below is a per-role ON/OFF that
// a super_admin edits from the Access page, stored as overrides in the API's
// role_capabilities table. Since 2026-08-26 HOW FAR it sees is his too — see the view scopes
// further down, which the tier-two predicates read in place of switching on the role.
//
// The catalog lives here because both sides consume it: the API derives defaults and
// validates edits against it, the SPA draws the Access page and its nav from it. DEFAULTS
// REPLICATE THE PRE-SWITCH GUARDS EXACTLY, so a database with no overrides behaves like the
// app always did.
//
// super_admin is locked all-ON and rejected by the update endpoint — the role holding the
// levers can never saw off its own branch, and nobody can strip the chain's owner.

export const capabilityKeySchema = z.enum([
  // Pages: OFF hides the destination AND the API refuses that page's reads.
  'page.dashboard',
  'page.tasks',
  'page.projects',
  'page.assistant',
  'page.knowledge',
  'page.locations',
  'page.users',
  'page.access',
  // Actions.
  'tasks.manage', // create/edit/delete/reorder; a manager stays pinned to their branch
  'tasks.createPersonal', // a private task of one's own, invisible to every other account
  'tasks.updateStatus', // an employee only ever reaches their own tasks (board scope)
  'projects.manage', // author a project: create, edit, delete, and shape its checklist
  'projects.checklist', // tick an item on a project the scope predicate already grants
  'knowledge.sync',
  'people.invite', // send, resend and revoke: one act of hiring, one switch (owner call 2026-08-26)
  'people.deactivate',
  'locations.manage',
])
export type CapabilityKey = z.infer<typeof capabilityKeySchema>

export interface CapabilityDefaults {
  super_admin: true // immutable by type: the owner column cannot even be authored OFF
  admin: boolean
  manager: boolean
  employee: boolean
}

// Ordered as the Access page prints them, and set from the owner's per-page brief of
// 2026-08-25 rather than from what the guards happened to allow before it:
//
//   super_admin  the chain, everything.
//   admin        everything inside their one branch, projects included, but no chain acts
//                (no branch created or deleted, nobody moved between branches).
//   manager      runs their branch's board and hires into it; authors no projects.
//   employee     their own assigned work, and the checklists their role is named on.
//
// Every account keeps tasks.createPersonal: a private task list is not a privilege, it is
// the thing a person does with their own day, and nobody else can see it (db/schema.ts,
// tasks.personal).
export const CAPABILITY_DEFAULTS: Record<CapabilityKey, CapabilityDefaults> = {
  'page.dashboard': { super_admin: true, admin: true, manager: false, employee: false },
  'page.tasks': { super_admin: true, admin: true, manager: true, employee: true },
  'page.projects': { super_admin: true, admin: true, manager: true, employee: true },
  'page.assistant': { super_admin: true, admin: true, manager: true, employee: true },
  'page.knowledge': { super_admin: true, admin: true, manager: true, employee: false },
  'page.locations': { super_admin: true, admin: true, manager: true, employee: false },
  'page.users': { super_admin: true, admin: true, manager: true, employee: false },
  'page.access': { super_admin: true, admin: false, manager: false, employee: false },
  'tasks.manage': { super_admin: true, admin: true, manager: true, employee: false },
  'tasks.createPersonal': { super_admin: true, admin: true, manager: true, employee: true },
  'tasks.updateStatus': { super_admin: true, admin: true, manager: true, employee: true },
  'projects.manage': { super_admin: true, admin: true, manager: false, employee: false },
  'projects.checklist': { super_admin: true, admin: true, manager: true, employee: true },
  'knowledge.sync': { super_admin: true, admin: true, manager: true, employee: false },
  'people.invite': { super_admin: true, admin: true, manager: true, employee: false },
  'people.deactivate': { super_admin: true, admin: true, manager: false, employee: false },
  'locations.manage': { super_admin: true, admin: true, manager: false, employee: false },
}

export const CAPABILITY_KEYS = capabilityKeySchema.options

// One override row: a stored deviation from the default. The API's table holds only these.
export type CapabilityOverrides = Partial<Record<CapabilityKey, Partial<Record<Role, boolean>>>>

// The page each action lives on (owner ask 2026-08-26: "if the page is turned off, it should
// turn off every access below"). A page is a door and its actions are the things you do once
// inside, so an action whose page is shut is unreachable by definition — a role that cannot
// open Users cannot invite from it, and a switch saying otherwise would be describing a screen
// nobody can get to.
//
// The cascade is computed, never written: the stored override keeps whatever it said, and
// turning the page back on brings its actions back exactly as they were. That way a mis-flip
// of one page switch costs nothing to undo.
export const CAPABILITY_PAGE: Partial<Record<CapabilityKey, CapabilityKey>> = {
  'tasks.manage': 'page.tasks',
  'tasks.createPersonal': 'page.tasks',
  'tasks.updateStatus': 'page.tasks',
  'projects.manage': 'page.projects',
  'projects.checklist': 'page.projects',
  'knowledge.sync': 'page.knowledge',
  'people.invite': 'page.users',
  'people.deactivate': 'page.users',
  'locations.manage': 'page.locations',
}

// Switches the owner cannot move at all. The Access page is the chain owner's own room
// (owner call 2026-08-26): handing the key to a role that could then rewrite every other
// role's key is the one edit that could not be undone from inside the app.
export const LOCKED_CAPABILITIES: readonly CapabilityKey[] = ['page.access']

export function isCapabilityLocked(key: CapabilityKey): boolean {
  return LOCKED_CAPABILITIES.includes(key)
}

// The effective answer both sides agree on: default unless overridden, super_admin always
// true no matter what a stray row claims, and an action switched on beneath a page that is
// off reads off anyway.
export function isCapabilityAllowed(
  role: Role,
  key: CapabilityKey,
  overrides: CapabilityOverrides = {},
): boolean {
  if (role === 'super_admin') {
    return true
  }
  const page = CAPABILITY_PAGE[key]
  if (page && !isCapabilityAllowed(role, page, overrides)) {
    return false
  }
  return overrides[key]?.[role] ?? CAPABILITY_DEFAULTS[key][role]
}

export function capabilitiesFor(role: Role, overrides: CapabilityOverrides = {}): CapabilityKey[] {
  return CAPABILITY_KEYS.filter((key) => isCapabilityAllowed(role, key, overrides))
}

// ── How far a role sees ─────────────────────────────────────────────────────────────────
//
// The second half of the model, and new on 2026-08-26. Until now a switch answered "may they?"
// and the ROLE alone answered "how far?" — a manager was branch-bound because the predicate
// said so in code. The owner's call is that reach is his to set too: "it is a choice that the
// super admin can pick. right now its fixed on the role. that is the default but the super
// admin should have the power to change it per role."
//
// So each of the five reads that has a horizon carries one setting, and the tier-two scope
// predicates (ADR-0007) read it instead of switching on the role. The DEFAULTS below reproduce
// the old role-derived behaviour exactly, so an untouched chain behaves as it always did.
export const viewScopeKeySchema = z.enum([
  'dashboard.view', // the task data behind the dashboard's totals AND the Tasks board itself
  'projects.view',
  'knowledge.view',
  'locations.view',
  'users.view',
])
export type ViewScopeKey = z.infer<typeof viewScopeKeySchema>
export const VIEW_SCOPE_KEYS = viewScopeKeySchema.options

// The horizons, in one vocabulary across all five reads so the page can talk about them the
// same way everywhere:
//
//   chain     everything the chain holds — every branch, every document, every person.
//   branch    the viewer's own branch, and nothing from any other.
//   involved  narrower than a branch: only the rows that name the viewer's role (projects).
//   assigned  narrower still: only the rows that name the viewer personally (tasks).
//   byRole    the document sensitivity ladder, which is its own axis rather than a place.
export const scopeChoiceSchema = z.enum(['chain', 'branch', 'involved', 'assigned', 'byRole'])
export type ScopeChoice = z.infer<typeof scopeChoiceSchema>

// Not every horizon means something for every read: there is no "assigned to me" branch, and
// a document has no location. Each setting offers only the choices its predicate can honour,
// widest first, and the API rejects anything outside the list.
export const VIEW_SCOPE_CHOICES: Record<ViewScopeKey, readonly ScopeChoice[]> = {
  'dashboard.view': ['chain', 'branch', 'assigned'],
  'projects.view': ['chain', 'branch', 'involved'],
  'knowledge.view': ['chain', 'byRole'],
  'locations.view': ['chain', 'branch'],
  'users.view': ['chain', 'branch'],
}

export interface ViewScopeDefaults {
  super_admin: 'chain' // immutable by type: the chain's owner sees the chain
  admin: ScopeChoice
  manager: ScopeChoice
  employee: ScopeChoice
}

// Exactly what the predicates did before they read a setting — see each one's own comment for
// why. Changing a value here changes what an untouched chain does, so it is the one table to
// keep honest against the API.
export const VIEW_SCOPE_DEFAULTS: Record<ViewScopeKey, ViewScopeDefaults> = {
  // task-board/scope.ts: admins and managers their branch, an employee only their own rows.
  'dashboard.view': {
    super_admin: 'chain',
    admin: 'branch',
    manager: 'branch',
    employee: 'assigned',
  },
  // projects/scope.ts: 'branch' carries the chain-wide projects too (a project naming no branch
  // runs at yours), and 'involved' adds the role axis on top of that.
  'projects.view': {
    super_admin: 'chain',
    admin: 'branch',
    manager: 'involved',
    employee: 'involved',
  },
  // assistant/document-metadata.ts: the sensitivity ladder, for everyone below the owner.
  'knowledge.view': {
    super_admin: 'chain',
    admin: 'byRole',
    manager: 'byRole',
    employee: 'byRole',
  },
  'locations.view': {
    super_admin: 'chain',
    admin: 'branch',
    manager: 'branch',
    employee: 'branch',
  },
  'users.view': { super_admin: 'chain', admin: 'branch', manager: 'branch', employee: 'branch' },
}

export type ViewScopeOverrides = Partial<Record<ViewScopeKey, Partial<Record<Role, ScopeChoice>>>>

// One role's full set of horizons — what the API hangs off the principal so a predicate can
// read its own setting without another round trip.
export type ViewScopes = Record<ViewScopeKey, ScopeChoice>

// The effective horizon: the stored choice if the owner set one and the predicate can honour
// it, else the default. A super_admin is the chain and is never narrowed here — the one place
// that narrows them is a private task, which is not a horizon but an ownership.
export function viewScopeFor(
  role: Role,
  key: ViewScopeKey,
  overrides: ViewScopeOverrides = {},
): ScopeChoice {
  if (role === 'super_admin') {
    return 'chain'
  }
  const stored = overrides[key]?.[role]
  if (stored && VIEW_SCOPE_CHOICES[key].includes(stored)) {
    return stored
  }
  return VIEW_SCOPE_DEFAULTS[key][role]
}

export function viewScopesFor(role: Role, overrides: ViewScopeOverrides = {}): ViewScopes {
  return Object.fromEntries(
    VIEW_SCOPE_KEYS.map((key) => [key, viewScopeFor(role, key, overrides)]),
  ) as ViewScopes
}

// GET /access: the effective matrix and the effective horizons, plus whether the viewer may
// edit them. `raw` is the switch as STORED, before the page cascade — the page needs both to
// grey an action out without forgetting where its switch was left (CAPABILITY_PAGE).
export const accessMatrixResponseSchema = z.object({
  editable: z.boolean(),
  matrix: z.array(
    z.object({
      capability: capabilityKeySchema,
      byRole: z.object({
        super_admin: z.boolean(),
        admin: z.boolean(),
        manager: z.boolean(),
        employee: z.boolean(),
      }),
      raw: z.object({
        admin: z.boolean(),
        manager: z.boolean(),
        employee: z.boolean(),
      }),
    }),
  ),
  scopes: z.array(
    z.object({
      key: viewScopeKeySchema,
      byRole: z.object({
        super_admin: scopeChoiceSchema,
        admin: scopeChoiceSchema,
        manager: scopeChoiceSchema,
        employee: scopeChoiceSchema,
      }),
    }),
  ),
})
export type AccessMatrixResponse = z.infer<typeof accessMatrixResponseSchema>

// POST /access/update: one switch flip. super_admin rows and locked keys are refused
// server-side.
export const updateAccessRequestSchema = z.object({
  role: roleSchema,
  capability: capabilityKeySchema,
  allowed: z.boolean(),
})
export type UpdateAccessRequest = z.infer<typeof updateAccessRequestSchema>

// POST /access/scope: one horizon moved. A choice the setting does not offer is refused, as
// is any edit to the owner's own row.
export const updateViewScopeRequestSchema = z.object({
  role: roleSchema,
  key: viewScopeKeySchema,
  choice: scopeChoiceSchema,
})
export type UpdateViewScopeRequest = z.infer<typeof updateViewScopeRequestSchema>

// The two interface languages (ADR-0005). A user picks one at accept; it drives the
// SPA's language and direction (he = RTL, en = LTR) once they are signed in.
export const preferredLanguageSchema = z.enum(['he', 'en'])
export type PreferredLanguage = z.infer<typeof preferredLanguageSchema>

// The one password minimum-length rule the SPA and API both enforce (auth plan,
// shared contracts), applied wherever a user sets a password — invite accept and, later,
// reset-consume. Sign-in deliberately does not use it (an existing password of any age
// must still authenticate); it guards password *creation* only.
export const PASSWORD_MIN_LENGTH = 8
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH)

// Sign-in: email plus password in, an opaque bearer session token out (ADR-0006).
// Email is trimmed here and matched case-insensitively server-side; the password is
// only required to be present at this endpoint — the minimum-length rule that guards
// password creation lives on the accept/reset schemas, not on sign-in.
export const signInRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
})
export type SignInRequest = z.infer<typeof signInRequestSchema>

export const signInResponseSchema = z.object({
  token: z.string(),
})
export type SignInResponse = z.infer<typeof signInResponseSchema>

// One generic error envelope for the auth failures, so every non-revealing response
// (a wrong password, an unknown email, a missing or bad bearer) shares one shape and
// leaks nothing through its structure.
export const errorResponseSchema = z.object({
  error: z.string(),
})
export type ErrorResponse = z.infer<typeof errorResponseSchema>

// The current principal, read fresh from the session lookup on every request
// (ADR-0007). This is exactly what the auth middleware attaches and what the
// current-principal endpoint reports: who the caller is, right now.
export const principalResponseSchema = z.object({
  userId: z.string().uuid(),
  // The signed-in person's own name, so the chrome can greet them rather than print
  // their role at them (v2 handoff §3: the account block is a name over a role label).
  displayName: z.string(),
  role: roleSchema,
  locationId: z.string().uuid().nullable(),
  status: userStatusSchema,
  // The role's effective capabilities (defaults + the owner's stored overrides), computed
  // fresh when /auth/me answers. The SPA's nav and buttons read THIS list, never the
  // catalog defaults directly, so a flipped switch reaches every screen on the next
  // principal fetch with no redeploy.
  capabilities: z.array(capabilityKeySchema),
})
export type PrincipalResponse = z.infer<typeof principalResponseSchema>

// Logout and logout-all end sessions server-side and carry nothing back but an
// acknowledgement; the client's job on success is to drop its stored bearer and
// return to login (ui-flow, session touchpoints). Both endpoints share this shape.
export const logoutResponseSchema = z.object({
  status: z.literal('ok'),
})
export type LogoutResponse = z.infer<typeof logoutResponseSchema>

// Create an invite (#31, stories 3-8). The inviter supplies the invitee's email,
// display name, role, and Location. What the acting principal is *allowed* to bake in
// is enforced server-side from the principal, never trusted from this body (ADR-0007):
// an admin may invite any role to any Location; a manager may create only employee
// invites for their own Location. locationId is null for an admin invitee and required
// for a manager/employee — that cross-field rule is checked in the service against the
// principal, so it is not expressed here.
export const createInviteRequestSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1),
  role: roleSchema,
  locationId: z.string().uuid().nullish(),
})
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>

// Resend and revoke address a single pending invite by the pending user's id in the
// path (#32, stories 9-10). There is no separate invite id — an outstanding invite is
// its Invited users row plus its live token — so the pending user's id is the handle.
// Which invites the caller may act on is enforced server-side from the principal
// (ADR-0007), never from this path: an admin may act on any invite, a manager only on an
// employee invite for their own Location.
export const inviteIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type InviteIdParams = z.infer<typeof inviteIdParamsSchema>

// Resend and revoke change server-side state — a fresh token mailed, or the pending user
// removed — and carry nothing back but an acknowledgement (ui-flow, invite touchpoints).
// The refreshed list the SPA shows afterwards comes from a follow-up GET /users.
export const inviteActionResponseSchema = z.object({
  status: z.literal('ok'),
})
export type InviteActionResponse = z.infer<typeof inviteActionResponseSchema>

// The manager/admin "resync now" acknowledgement (#89, ADR-0014). The endpoint reconciles the
// knowledge cache against Drive and answers with this only once the pass has completed, so a
// just-changed doc is answerable by the time the caller sees it. The refreshed cache is observed
// through the assistant's own grounding reads, so the body carries nothing but the acknowledgement.
export const resyncKnowledgeResponseSchema = z.object({
  status: z.literal('ok'),
})
export type ResyncKnowledgeResponse = z.infer<typeof resyncKnowledgeResponseSchema>

// The fixed shelves the Knowledge tab files every doc under (ADR-0024). Slugs cross the wire;
// the web app owns their localized display names. Mirrors KNOWLEDGE_CATEGORIES in the API's
// db/schema.ts — the categorizer writes only these values.
export const knowledgeCategorySchema = z.enum([
  'procedures',
  'finance',
  'hr',
  'reports',
  'agreements',
  'menu',
  'general',
])
export type KnowledgeCategory = z.infer<typeof knowledgeCategorySchema>

// One Knowledge Doc as the admin Knowledge tab lists it (ADR-0024): filing metadata only,
// never the extracted content — the tab links to the original in Drive rather than mirroring
// text. category is null while a doc awaits the categorizer's next sweep (the tab shows it
// under `general` meanwhile); skipReason is the admin-visible story for a `skipped` doc.
export const knowledgeDocSummarySchema = z.object({
  id: z.string().uuid(),
  driveFileId: z.string(),
  title: z.string(),
  category: knowledgeCategorySchema.nullable(),
  status: z.enum(['ingested', 'skipped']),
  skipReason: z.string().nullable(),
  sourceMimeType: z.string(),
  driveModifiedTime: z.string(),
})
export type KnowledgeDocSummary = z.infer<typeof knowledgeDocSummarySchema>

// The Knowledge tab's one read (ADR-0024): every cached doc plus when the last sync pass
// finished (null before the first sync), so the tab can say how fresh the mirror is.
export const knowledgeDocListResponseSchema = z.object({
  docs: z.array(knowledgeDocSummarySchema),
  lastSyncAt: z.string().nullable(),
})
export type KnowledgeDocListResponse = z.infer<typeof knowledgeDocListResponseSchema>

// A user as the provisioning API reports it — the pending invitee right after create,
// and any user in the inviter's scoped list. No credential material ever appears here;
// this is the outward view of a users row (stories 6, 8). preferredLanguage is included
// so the language chosen at accept is observable afterwards (TC-ACC-02).
export const userSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  locationId: z.string().uuid().nullable(),
  // The resolved Location name that rides alongside the id, so a roster prints `Downtown`,
  // never the raw uuid (people build, mockup #179). It is null exactly when locationId is —
  // a chain-wide admin — which the UI presents as "Chain-wide"; it is never a stale or
  // orphaned name, since it is resolved from the locations row on every read.
  locationName: z.string().nullable(),
  status: userStatusSchema,
  // When this person last used the app, as an ISO-8601 instant, or null when they never
  // have. The API stamps it on the authenticated path, so it advances while someone is
  // working and stops the moment they put the app down; the People roster turns it into
  // "Online" or "5 min ago" against the reader's own clock. This is deliberately NOT a
  // boolean: an `online` flag computed on the server would be stale by the age of the
  // response, and would throw away the only answer worth having once someone is away.
  lastSeenAt: z.string().datetime().nullable(),
  preferredLanguage: preferredLanguageSchema,
})
export type UserSummary = z.infer<typeof userSummarySchema>

// The scoped user list (TC-INV-09): an admin sees every user, a manager sees only their
// own Location's users. The scope is derived from the principal in the data-access layer
// (ADR-0007), never from a query parameter.
export const userListResponseSchema = z.object({
  users: z.array(userSummarySchema),
})
export type UserListResponse = z.infer<typeof userListResponseSchema>

// The user id carried in the path for the admin-only status operations — deactivate and
// reactivate (#33, stories 31-32). Validating it as a uuid at the route keeps a malformed
// id from ever reaching the data-access layer. The target user is named in the path; the
// acting admin is the principal behind the bearer, never a body field.
export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type UserIdParams = z.infer<typeof userIdParamsSchema>

// Accept an invite and set a password (#31, stories 13-15). Reached pre-auth by opening
// the one-time link, which carries the raw token; the recipient sets a password (the
// shared minimum-length rule applies) and picks a language. Role and Location are baked
// into the invite and are immutable by the recipient, so they are absent here.
export const acceptInviteRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
  preferredLanguage: preferredLanguageSchema,
})
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>

// Accept signs the recipient straight in with no separate login step (story 15): the
// response carries a session bearer, the same shape sign-in returns.
export const acceptInviteResponseSchema = z.object({
  token: z.string(),
})
export type AcceptInviteResponse = z.infer<typeof acceptInviteResponseSchema>

// Request a password reset (#34, stories 26-30). Only the email is supplied; everything
// about which accounts exist is hidden. Email is trimmed here and matched
// case-insensitively server-side, the same as sign-in.
export const requestPasswordResetRequestSchema = z.object({
  email: z.string().trim().email(),
})
export type RequestPasswordResetRequest = z.infer<typeof requestPasswordResetRequestSchema>

// One generic confirmation for every reset request — matched or not, active or not, and
// whether or not it was rate-limited (stories 27, 30). The response reveals nothing about
// which emails have accounts, so the SPA shows the same "if the address is registered, a
// link is on its way" message for all of them (ui-flow, reset request). Consume shares
// this same acknowledgement shape.
export const resetAcknowledgementSchema = z.object({
  status: z.literal('ok'),
})
export type ResetAcknowledgement = z.infer<typeof resetAcknowledgementSchema>

// Consume a reset and set a new password (#34, stories 26, 28, 29, 36). Reached pre-auth by
// opening the one-time link, which carries the raw reset token; the user sets a new
// password (the shared minimum-length rule applies). No session comes back — completing a
// reset revokes every one of the user's existing sessions (story 29), so the user is sent
// to login to sign in afresh (ui-flow, reset consume). Success is a bare acknowledgement.
export const consumePasswordResetRequestSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
})
export type ConsumePasswordResetRequest = z.infer<typeof consumePasswordResetRequestSchema>

// --- Assistant threads and messages (#90) ---

// A turn's author (ADR-0003): exactly `user` and `agent`, matching the message_role pg enum.
// There is no `error` role — a failed answer is a transient inline retry, not a thread row.
// The client never supplies a role: the create path fixes 'user' server-side and the answer
// path (a later slice) is the only writer of an 'agent' turn (ADR-0007), so this schema types
// what a reader may *see*, never what a writer may name.
export const messageRoleSchema = z.enum(['user', 'agent'])
export type MessageRole = z.infer<typeof messageRoleSchema>

// Start a thread (#90). The client supplies only the first user message; the server owns
// everything else — it derives the title, fixes the turn's role to 'user', and stamps the
// owner from the principal (never from the body). The shared trim + min(1) rule means an
// empty or whitespace-only message is refused before the handler runs, so a thread always
// has a non-empty first turn to derive a title from.
// The upper bound on one posted message (#Q-cap). Without it the only limit was the HTTP body
// limit — a megabyte — so a single paste could be embedded, sent to a pro-tier model, persisted,
// and then replayed as history on every later question in that thread. No real question needs more
// than a few thousand characters, and a pasted document belongs in the knowledge base, not in a
// chat turn. Refused at the boundary, where the rest of the shape is already validated.
export const MAX_MESSAGE_CHARS = 4_000

export const createThreadRequestSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
})
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>

// Post a question to an existing thread and get a grounded answer back (#91, ADR-0003). Like thread
// creation, the client supplies only the text — never a role — so an `agent` turn cannot be forged
// from the browser (ADR-0003); the same trim + min(1) rule refuses an empty question before the
// handler runs. The response is the thread's updated detail (the new user turn and the agent reply),
// so the SPA re-renders the conversation from the one response, and a model failure returns no body
// to persist (a transient inline retry, not a thread row).
export const postThreadMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
})
export type PostThreadMessageRequest = z.infer<typeof postThreadMessageRequestSchema>

// One knowledge doc an assistant answer drew on (#227): the ingested doc's id and its title, the
// pair the attribution chips render. Sources are named only for an `agent` turn grounded in the
// knowledge corpus — a task-grounded answer or a refusal carries none — and every id here is a real
// ingested doc the answer path matched the model's citation against, never a free-text title.
export const messageSourceSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
})
export type MessageSource = z.infer<typeof messageSourceSchema>

// One turn as the API reports it (#90): the author role, the text, and the created timestamp
// (ISO 8601) that orders a thread's history. No thread_id or internal ids beyond the row id —
// a message is only ever read inside its already-authorised thread. `sources` (#227) is present
// only on an `agent` turn: the knowledge docs that grounded the reply, an empty array when the
// answer was task-grounded or a refusal, and absent on a `user` turn (which cites nothing).
export const threadMessageSchema = z.object({
  id: z.string().uuid(),
  role: messageRoleSchema,
  content: z.string(),
  createdAt: z.string(),
  sources: z.array(messageSourceSchema).optional(),
})
export type ThreadMessage = z.infer<typeof threadMessageSchema>

// A thread as the list reports it (#90): the auto-derived title and the timestamps (ISO 8601)
// the SPA orders on. The owner is not carried — every thread in a response is the caller's own
// (author-scoped reads, ADR-0007), so a user_id field would be redundant and is omitted.
export const threadSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ThreadSummary = z.infer<typeof threadSummarySchema>

// The caller's own threads, most-recently-active first (#90). The scope is derived from the
// principal in the data-access layer, never from a query parameter (ADR-0007).
export const threadListResponseSchema = z.object({
  threads: z.array(threadSummarySchema),
})
export type ThreadListResponse = z.infer<typeof threadListResponseSchema>

// A single thread opened with its full turn history in created order (#90): the summary plus
// its messages. Returned by both create (the new thread with its first user turn) and open.
export const threadDetailSchema = threadSummarySchema.extend({
  messages: z.array(threadMessageSchema),
})
export type ThreadDetail = z.infer<typeof threadDetailSchema>

// The thread id carried in the path when opening one (#90). Validating it as a uuid at the
// route keeps a malformed id from reaching the data-access layer; the acting user is the
// principal behind the bearer, and a thread that is not theirs is a non-enumerating 404.
export const threadIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type ThreadIdParams = z.infer<typeof threadIdParamsSchema>

// Delete acknowledgement (#257, PRD: a user "can delete their own" threads): the thread and its
// messages are gone — a hard delete, matching the PRD's privacy stance (a thread is private even
// from admins, so "deleted" must not mean "retained but hidden") — and nothing of it comes back
// but this bare ok. The same shape as the task delete ack.
export const threadDeleteResponseSchema = z.object({
  status: z.literal('ok'),
})
export type ThreadDeleteResponse = z.infer<typeof threadDeleteResponseSchema>

// --- Task board (the todo, #129; Slice A read, #131) ---

// A task's closed sets (CONTEXT: Task), named identically SPA-side and API-side so the board
// can render each value and the read-side priority sort can order on it. status is the single
// shared state every assignee sees (no per-person completion); priority drives the sort toggle.
export const taskStatusSchema = z.enum(['not_started', 'in_progress', 'done'])
export type TaskStatus = z.infer<typeof taskStatusSchema>

// Three tiers, low to high: normal (the default every task starts at), medium, high
// (owner call 2026-08-21, which replaced a 'low' tier nobody set — a board where the
// baseline is already the middle has no use for a rung below it, but it does need one
// above that is short of an alarm).
export const taskPrioritySchema = z.enum(['normal', 'medium', 'high'])
export type TaskPriority = z.infer<typeof taskPrioritySchema>

// A rendered user reference (CONTEXT: Assignee): the user id and the display name the board shows.
// No email, role, or status — the board renders who is on a task, not a user record. This bare pair
// names a task's creator; an assignee extends it below with when they were put on the task.
export const taskUserRefSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
})
export type TaskUserRef = z.infer<typeof taskUserRefSchema>

// One assignee as the board reports it: the rendered reference plus when this user was assigned
// (ISO 8601, from the assignee row's created_at — which edit reconciliation preserves for unchanged
// assignees, so an edited task never re-dates an existing assignment). assignedAt is what the
// Tasks-tab badge (#136) compares against the viewer's last-seen marker to count new assignments;
// the creator carries no such date, which is why the two shapes split.
export const taskAssigneeSchema = taskUserRefSchema.extend({
  assignedAt: z.string(),
})
export type TaskAssignee = z.infer<typeof taskAssigneeSchema>

// One task as the scoped board read reports it (#131). Every field the board renders is here
// (story 9): title, description, status, priority, assignees, dueDate, completedAt. description is
// shown in the language it was authored in and is never auto-translated (story 10), so it is a
// plain string with no locale tag; it, dueDate, and completedAt are null when unset. Timestamps
// are ISO 8601 strings. locationId rides along so an admin's chain-wide board can group by branch.
// position is the shared per-location manual order the board opens to (story 11); the priority
// sort is a per-viewer client-side lens that never touches it.
// One line on a task's checklist (owner call 2026-08-26). Deliberately the same four fields as a
// project's item: a title, a tick, a position, and an id to tick it by. A checklist item never grows
// an assignee or a due date — the moment it needs those it is a task, and the board already exists.
export const taskChecklistItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  done: z.boolean(),
  position: z.number().int(),
  // Who owns this step (2026-08-26). A set, because a five-step job splits across five people and
  // "restock" is two people on a delivery day. Everyone here is also an assignee of the TASK — the
  // write path puts them there — so owning a step is never work its owner cannot see.
  assignees: z.array(taskUserRefSchema),
})
export type TaskChecklistItem = z.infer<typeof taskChecklistItemSchema>

export const taskSchema = z.object({
  id: z.string().uuid(),
  // Null on a private task alone (2026-08-25): that work belongs to a person rather than to a
  // branch, which is also the only way the chain's owner — who holds no branch — can have one.
  locationId: z.string().uuid().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueDate: z.string().nullable(),
  completedAt: z.string().nullable(),
  position: z.number().int(),
  // The project this task belongs to, or null when it is loose board work. A task lives in at
  // most one project; the project screens read the SAME rows the board does, which is what keeps
  // "13 of 13 done" and the kanban from ever disagreeing.
  projectId: z.string().uuid().nullable(),
  assignees: z.array(taskAssigneeSchema),
  // A private task of the creator's own (owner call 2026-08-25). It rides the same table and the
  // same board machinery as shared work, and is filtered out of every other account's read — a
  // super_admin's chain board included — by the scope predicate. Present on the wire so the SPA
  // can keep it on the Personal tab and out of the shared board.
  personal: z.boolean(),
  // Who created the task (#258, PRD "identity and place"): the bare id+name pair, denormalized by
  // the API so the client renders a name with no user lookup. Always present — rows that predate
  // the column were backfilled at migration time.
  createdBy: taskUserRefSchema,
  // The task's checklist in its own manual order, empty when it has none (2026-08-26). It rides the
  // task rather than a detail read because a task HAS no detail endpoint: the dialog that edits one
  // is fed from this same board list, and a second round trip on open would make the checklist
  // arrive after the sheet. Every producer of a Task goes through one serializer, which is what
  // keeps this field from silently emptying the live channel — the stream parses frames strictly and
  // drops a frame missing a declared field without a word.
  checklist: z.array(taskChecklistItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Task = z.infer<typeof taskSchema>

// The scoped board read (#131, ADR-0007). The scope predicate is derived from the principal in the
// data-access layer — an employee sees only their own assigned tasks, a manager their whole
// location including the backlog, an admin the chain — never from a role at the route or a query
// parameter, and there is no unscoped "all tasks" path. tasks arrive in the shared manual order
// (position, with a stable id tiebreak); the high→low priority sort is a client-side lens over
// this same list. lastSeenAt is this user's board last-seen marker as it stood *before* this read
// bumped it (null the first time they ever open the board): opening the board both advances the
// marker to now and reports where it was, so the trigger is observable through a follow-up read
// rather than a row peek (story 15). The Tasks-tab badge that consumes it belongs to #59.
export const taskBoardResponseSchema = z.object({
  tasks: z.array(taskSchema),
  lastSeenAt: z.string().nullable(),
})
export type TaskBoardResponse = z.infer<typeof taskBoardResponseSchema>

// The board read's one query switch (#136): `?peek=1` reads the board and the marker without
// bumping the marker. The SPA always peeks — the Tasks-tab badge polls the board from the shell,
// and a background poll must never count as the user seeing anything — and reports an actual view
// through POST /tasks/seen instead. A plain GET keeps the #131 open-bumps semantics unchanged.
// Query values arrive as strings, so the flag is the literal '1', not a boolean.
export const taskBoardQuerySchema = z.object({
  peek: z.literal('1').optional(),
})
export type TaskBoardQuery = z.infer<typeof taskBoardQuerySchema>

// POST /tasks/seen (#136): the user has actually looked at the board, so advance their last-seen
// marker to now and report where it landed. The SPA calls this when the Tasks screen mounts and
// again when it unmounts (the whole visit is "seen"), then patches its cached board's lastSeenAt
// from the response so the badge clears without a refetch.
export const taskBoardSeenResponseSchema = z.object({
  lastSeenAt: z.string(),
})
export type TaskBoardSeenResponse = z.infer<typeof taskBoardSeenResponseSchema>

// One frame of the live board channel (#132, Slice A2, ADR-0015). The board updates in place over
// scope-filtered server-sent events: the server pushes a change only to subscribers whose read
// scope admits that task (the fan-out reuses the very predicate that gates reads), and the client
// patches its TanStack Query cache from the stream. Every board change in the write slices
// (B create/assign, C status, D reorder) is an upsert of a task that still exists, so a single
// self-describing kind — the current task as the subscriber is allowed to see it — covers the
// channel: the client replaces the task in its cache if present, else inserts it into the shared
// manual order. A task leaving a subscriber's scope (reassigned away) simply stops arriving; it is
// never announced, which is the same boundary the scoped read draws (a viewer never learns of a
// task that was never theirs).
export const taskBoardEventSchema = z.object({
  type: z.literal('task.upserted'),
  task: taskSchema,
})
export type TaskBoardEvent = z.infer<typeof taskBoardEventSchema>

// --- Task board writes (Slice B — create / edit / delete + assign, #133) ---

// The assignee set a write carries: a list of user ids. Empty is the backlog case (a task with no
// one on it) and is the default when the field is omitted, so "leave it unassigned" needs no
// explicit empty array. Every id must belong to the task's own location — the assignee-location
// invariant — but that cross-row rule is checked in the service against the users' real locations
// (ADR-0007), not expressible here, so this schema only shapes the ids, never who may be named.
const assigneeIdsSchema = z.array(z.string().uuid())

// Create a task on a location's board (#133, stories 24-30). Manager/admin only (tier-one role
// guard); an employee is refused at the route. The target location is resolved server-side from the
// acting principal, never trusted blindly from this body (ADR-0007): a manager's own location is
// used and naming another is refused, while an admin — who holds no location of their own — must
// name one here. priority defaults to normal and the assignee set to empty (the backlog); dueDate is
// an optional calendar deadline. description is the free-text note, shown in its authored language
// and never translated, so an empty note is sent as null rather than a blank string.
// One line as the authoring path carries it: an existing item names its id so its tick survives the
// rewrite, a new line carries a title alone. Without the id an edit that only renamed line three
// would untick every box on the task, which is the sort of data loss nobody reports because they
// assume they did it themselves.
export const taskChecklistDraftSchema = z.object({
  id: z.string().uuid().nullish(),
  title: z.string().trim().min(1),
  done: z.boolean().default(false),
  // The step's owners. Every id must belong to the task's own branch and sit at or below the acting
  // principal on the role ladder — the same two rules the task's own assignee set obeys, checked in
  // the service against real rows rather than expressible here. Naming somebody puts them on the
  // task as well, so a private task, which has no branch and no other reader, takes none.
  assigneeIds: z.array(z.string().uuid()).default([]),
})
export type TaskChecklistDraft = z.infer<typeof taskChecklistDraftSchema>

export const createTaskRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).nullish(),
  priority: taskPrioritySchema.default('normal'),
  dueDate: z.string().datetime().nullish(),
  assigneeIds: assigneeIdsSchema.default([]),
  // Null/omitted for a manager (their own location is used); required for an admin, checked in the
  // service against the principal — an admin who names none is an invalid request.
  locationId: z.string().uuid().nullish(),
  // File the new task into a project as it is created — how the project screen's "New task" row
  // works. The service checks the project is one the principal may write before honouring it, so
  // naming someone else's project is refused rather than silently dropped.
  projectId: z.string().uuid().nullish(),
  // Ask for the private path instead of the shared board (2026-08-25). The service then pins the
  // task to the caller's own branch, themself as its only assignee, and no project, whatever else
  // this body says — so a manager who holds both paths chooses between them here rather than
  // having the choice inferred from what they may do.
  personal: z.boolean().default(false),
  // The checklist typed while the task was being described, owners and all. Somebody breaking a job
  // into steps does it as they think of them, and decides who takes which in the same breath, not
  // on a second visit to the task they just made.
  checklist: z.array(taskChecklistDraftSchema).default([]),
})
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>

// Edit a task through the full-update path (#133, stories 31-32; #134 adds status). Manager/admin
// only; this is the path an employee never reaches (their only write is the status-only path in
// Slice C). It replaces the editable fields wholesale — title, description, priority, due date, and
// the assignee set — so every field is required (nullable where the column is), and reassignment is
// just a new assignee set. Location is never here: a task never changes location in v1. status is
// the one optional field: a manager/admin may also move status through this full edit (story 43),
// but omitting it leaves the status exactly as it stands — so a Slice-B-shaped edit is unchanged and
// never silently resets status. An employee still cannot reach this path; their status write is the
// dedicated one below.
export const updateTaskRequestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
  priority: taskPrioritySchema,
  dueDate: z.string().datetime().nullable(),
  assigneeIds: assigneeIdsSchema,
  status: taskStatusSchema.optional(),
  // Wholesale like every other field here: null takes the task OUT of its project and back to the
  // loose board. Optional so a Slice-B-shaped edit that predates projects never unfiles a task by
  // omission — the same reason `status` is optional.
  projectId: z.string().uuid().nullish().optional(),
  // The checklist, replaced wholesale exactly as the assignee set is: this is the authoring path,
  // where lines are added, renamed and removed together. An item already on the task keeps its id
  // and therefore its tick; a title with no id is a new line. Optional, so an edit made by a client
  // that predates checklists leaves the list alone rather than clearing it by omission — the same
  // reason `status` and `projectId` are optional here.
  checklist: z.array(taskChecklistDraftSchema).optional(),
})
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>

// Change only a task's status (#134, Slice C, stories 37-40). The employee's sole write and their
// dedicated path: it carries the status and nothing else — no field allow-list to get wrong — so an
// assignee can move a task not_started ↔ in_progress ↔ done (any direction, a mis-tap is reversible)
// but can never rewrite its title, priority, assignees, or due date. The path has no tier-one role
// guard (an authenticated user reaches it), so who may act is the scope predicate alone: an employee
// only on their own assigned tasks, a manager on their location, an admin chain-wide. completed_at is
// not here — the DB trigger maintains it on entering/leaving done (ADR-0002), so no caller types it.
export const updateTaskStatusRequestSchema = z.object({
  status: taskStatusSchema,
})
export type UpdateTaskStatusRequest = z.infer<typeof updateTaskStatusRequestSchema>

// The task id carried in the path for the by-id writes — edit and delete (#133). Validating it as a
// uuid at the route keeps a malformed id from reaching the data-access layer; the acting principal
// is the bearer behind the request, and a task outside their write scope is one non-enumerating 404,
// never a confirmation the row exists on another location's board.
// Tick or untick one checklist item (2026-08-26). Its own path rather than a field on the full edit,
// for the same reason the status write has one: ticking is the gesture an ASSIGNEE makes, and the
// full-edit path is closed to employees. It carries the item and the state it should land in — the
// state, not a flip, so a double-tap on a slow connection settles rather than toggling twice.
export const toggleTaskChecklistItemRequestSchema = z.object({
  done: z.boolean(),
})
export type ToggleTaskChecklistItemRequest = z.infer<typeof toggleTaskChecklistItemRequestSchema>

// Replace a task's whole checklist (2026-08-26). Its own path rather than a field on the full edit
// because the checklist SAVES ITSELF: adding or removing a line writes through on the gesture, while
// the title and the properties beside it still land on Save. Sending the whole list rather than one
// added line keeps the server's reconcile the single way a checklist is ever written, so ordering and
// removal need no further verbs.
export const setTaskChecklistRequestSchema = z.object({
  checklist: z.array(taskChecklistDraftSchema),
})
export type SetTaskChecklistRequest = z.infer<typeof setTaskChecklistRequestSchema>

// Scan the knowledge base for a checklist that already covers this task (owner ask 2026-08-27).
// The title alone is the query — the same string the person is typing into the create box — and
// the scan is a READ: it proposes steps and writes nothing, so the person still decides whether
// they land on the task. The cap matches the title field's own; a longer string is not a task name.
export const scanTaskChecklistRequestSchema = z.object({
  title: z.string().trim().min(1).max(200),
})
export type ScanTaskChecklistRequest = z.infer<typeof scanTaskChecklistRequestSchema>

// What a scan found. An empty `steps` is the ordinary answer, not an error: most task titles have
// no written procedure behind them, and the client says so plainly rather than showing a failure.
// sourceTitle names the document the steps were read out of, and is null when the model named a
// document retrieval never selected — an invented provenance is worse than none.
export const scanTaskChecklistResponseSchema = z.object({
  steps: z.array(z.string()),
  sourceTitle: z.string().nullable(),
})
export type ScanTaskChecklistResponse = z.infer<typeof scanTaskChecklistResponseSchema>

// The task and the item named together in the path, both validated as uuids at the route.
export const taskChecklistItemParamsSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
})
export type TaskChecklistItemParams = z.infer<typeof taskChecklistItemParamsSchema>

export const taskIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type TaskIdParams = z.infer<typeof taskIdParamsSchema>

// Delete acknowledgement (#133, story 33): the task is gone, so nothing of it comes back but this
// bare ok. The acting client drops the card and the board read no longer carries it; other viewers
// see it leave on their next board read (a deletion is not relayed over the upsert-only live channel).
export const taskDeleteResponseSchema = z.object({
  status: z.literal('ok'),
})
export type TaskDeleteResponse = z.infer<typeof taskDeleteResponseSchema>

// --- Task board reorder (Slice D — manual drag-reorder, #135) ---

// Set a location's shared manual order (#135, stories 46-52). A manager or admin drags tasks into an
// order and this carries the result: the full ordered list of a *single* location's task ids, from
// which the server rewrites each task's `position` to its index — so `position` is the one canonical
// shared per-location order every viewer opens to, and this request is that order made explicit.
// Employees never reach here (tier-one role guard). locationId is null/omitted for a manager (their
// own location is used, and naming another is refused) and required for an admin (who holds none of
// their own and so must name the board they are arranging) — the same principal-resolved target the
// create path uses, never trusted blindly (ADR-0007). Every id must belong to that one location — the
// tasks-in-location invariant, the reorder twin of the assignee-location one — so a mixed-location
// list is rejected rather than silently reindexed. An empty list is a valid no-op.
export const reorderTasksRequestSchema = z.object({
  orderedIds: z.array(z.string().uuid()),
  // Null/omitted for a manager (their own location is used); required for an admin, checked in the
  // service against the principal — an admin who names none is an invalid request.
  locationId: z.string().uuid().nullish(),
})
export type ReorderTasksRequest = z.infer<typeof reorderTasksRequestSchema>

// The reorder result (#135): the reordered location's tasks in the new shared order (position
// ascending, id the stable tiebreak), each as the acting caller sees them. The acting client can
// drop this straight into its board; other viewers converge through the live channel, which relays
// the same changed tasks. It carries no lastSeenAt — a reorder is a write, not the user opening the
// board, so it must not move the marker the badge dates from (unlike the board read).
export const reorderTasksResponseSchema = z.object({
  tasks: z.array(taskSchema),
})
export type ReorderTasksResponse = z.infer<typeof reorderTasksResponseSchema>

// --- Location management (Slice L1 — the locations API, #164) ---

// One Location as the admin surface reports it (CONTEXT: Location): its id, human name, and the
// contact fields the branch detail page edits (address, city, phone — 2026-08-24, PR 2 task 1).
// The three are nullable because a Location can exist before anyone fills them in; no timestamps a
// caller acts on. This is the outward view both UI consumers read: the invite picker and the
// task-form board list, retiring the "distinct locationIds from the people list" hack.
export const locationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  phone: z.string().nullable(),
})
export type Location = z.infer<typeof locationSchema>

// The authoritative Location list (#164), Admin-only (ADR-0007 — re-authorised server-side, never
// UI-gated). Ordered by name, and the single source both UI consumers repoint to. There is
// deliberately no scope parameter: an admin sees every Location, full stop, so the list is not
// derived from a query or a role at the route beyond the tier-one admin gate.
export const locationListResponseSchema = z.object({
  locations: z.array(locationSchema),
})
export type LocationListResponse = z.infer<typeof locationListResponseSchema>

// Create a Location from a name (#164). Admin-only. The trim + min(1) rule refuses an empty or
// whitespace-only name before the handler runs — the only server-side validation. There is
// deliberately NO uniqueness check: same-name branches are legitimate (real chains have them), so a
// duplicate is accepted here and the soft "already exists — create anyway?" warning is a UI concern
// in L2/L3, driven off the list read, not a rejection on this path.
export const createLocationRequestSchema = z.object({
  name: z.string().trim().min(1),
})
export type CreateLocationRequest = z.infer<typeof createLocationRequestSchema>

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
export type UpdateLocationRequest = z.infer<typeof updateLocationRequestSchema>

// The Location id carried in the path for rename and delete (#164). Validating it as a uuid at the
// route keeps a malformed id from reaching the data-access layer; an id that does not exist is a
// plain 404 (there is nothing location-scoped to hide here — the whole surface is admin-only).
export const locationIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type LocationIdParams = z.infer<typeof locationIdParamsSchema>

// Delete acknowledgement for a Location (owner ask 2026-08-16, revising decision 4's "a Location is
// never removed"): the branch is gone, so nothing of it comes back but this bare ok — the same shape
// the task delete answers with. A branch that still has people or tasks on it is NOT deletable: the
// users/tasks rows reference it by id and orphaning them would strand real work, so that request is
// refused with `location_in_use` and the admin empties the branch first. That guard is the API's,
// not the UI's (ADR-0007).
export const locationDeleteResponseSchema = z.object({
  status: z.literal('ok'),
})
export type LocationDeleteResponse = z.infer<typeof locationDeleteResponseSchema>

// --- Push notification devices (#59 delivery side) ---
// A phone registers the token its platform's push service issued it, so the API can reach it when
// a task lands on that person. Only the two native wrapper shells register; the browser SPA has no
// push in v1, which is why there is no `web` platform here.
export const pushPlatformSchema = z.enum(['android', 'ios'])
export type PushPlatform = z.infer<typeof pushPlatformSchema>

// Register (or refresh) this device against the signed-in user. The user is never in the body — it
// comes from the bearer, so a device can only ever be claimed for the account holding it. The same
// call is made on every authenticated app start, not only at sign-in: push tokens rotate, and
// re-sending the current one is how the server's copy stays live for staff who never sign out.
export const registerDeviceRequestSchema = z.object({
  token: z.string().min(1),
  platform: pushPlatformSchema,
})
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>

// Drop this device's registration, sent on sign-out so a shared or handed-on phone stops ringing
// for the person who just left it. The token alone identifies the row; the bearer still has to be
// valid, and a token registered to someone else is left untouched, so this can never be turned
// into a way to silence another person's phone.
export const unregisterDeviceRequestSchema = z.object({
  token: z.string().min(1),
})
export type UnregisterDeviceRequest = z.infer<typeof unregisterDeviceRequestSchema>

// Both device calls carry nothing back but an acknowledgement — the client's own copy of the token
// is the only state that matters to it, and it already holds it.
export const deviceAcknowledgementSchema = z.object({
  status: z.literal('ok'),
})
export type DeviceAcknowledgement = z.infer<typeof deviceAcknowledgementSchema>

// --- Projects ---

// A project is the container the chain plans in — a menu rollout, a branch opening, an audit —
// and it holds tasks from the SAME board the Tasks screen shows. There is no second task system:
// a task carries an optional projectId, so work counted here is the identical row a manager drags
// on the board, and the two screens can never disagree about whether something is done.

// The identity a project wears. Both are chosen by the person creating it rather than derived,
// because a project's name is not a category — two menu rollouts are different projects, and the
// person who owns the work is the one who knows which mark makes theirs findable.
//
// The icon set is closed and deliberately small: enough to say what a project IS at a glance,
// short enough to pick from a single grid without scrolling.
export const projectIconSchema = z.enum([
  'menu',
  'opening',
  'audit',
  'equipment',
  'training',
  'marketing',
  'delivery',
  'hiring',
  'finance',
  'maintenance',
  'supplies',
  'event',
])
export type ProjectIcon = z.infer<typeof projectIconSchema>

// Where a project has got to. A closed set, and deliberately NOT the task status vocabulary: a
// task is not_started / in_progress / done, but a project moves through stages that a chain
// actually talks in. Reusing the task words here would suggest the two mean the same thing.
//
// `completed` is special: the app sets it ITSELF the moment every checklist item is ticked, and
// takes it back off if one is un-ticked. Nobody has to remember to close a project, and a project
// can never claim to be finished while work is still open inside it.
export const projectPhaseSchema = z.enum([
  'planning',
  'preparation',
  'in_progress',
  'review',
  'completed',
])
export type ProjectPhase = z.infer<typeof projectPhaseSchema>

// Who a project involves — every role in the chain, not a subset (owner call 2026-08-23: "we
// should be able to see everything"). It doubles as a scope boundary: a manager or an employee
// only sees the projects that name their role, so a kashrut audit run by managers does not fill an
// employee's list with work they have no part in.
//
// The two admin roles behave differently from the other two, and the form says so rather than
// hiding it: naming them records that they are involved, but leaving them out does NOT hide the
// project from them. An admin sees every project in the chain the same way they see every board,
// and a picker that implied otherwise would be lying about the guarantee underneath.
//
// The same four members as `roleSchema`, and deliberately declared as that schema rather than a
// copy of its list, so a role added to the chain cannot go missing here.
export const projectRoleSchema = roleSchema
export type ProjectRole = Role

// One checklist item: a line of work inside a project, and nothing more. No assignee, no due date,
// no priority — those belong to a board task, and a checklist that grew them would just be a
// second, worse task board. What it has is a title, a tick, and a position.
export const projectChecklistItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  done: z.boolean(),
  position: z.number().int(),
})
export type ProjectChecklistItem = z.infer<typeof projectChecklistItemSchema>

// The six identity tones a project may wear. Red and blue are deliberately absent: red already
// means destructive in this app and blue already means "you can click this", and spending either
// on a project's identity would put a second meaning on a colour that has one.
export const projectColourSchema = z.enum(['amber', 'green', 'violet', 'teal', 'orange', 'pink'])
export type ProjectColour = z.infer<typeof projectColourSchema>

// A branch a project runs at, carried by name so no screen has to resolve an id against a second
// request just to print a word.
export const projectBranchSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
})
export type ProjectBranch = z.infer<typeof projectBranchSchema>

// A project's progress and its status are DERIVED from its tasks, never stored, so there is
// exactly one truth about how far along it is. A stored percentage and a task list drift apart
// the first week somebody forgets to move the slider; a count cannot.
//
//   no tasks, or none done          -> not_started
//   every task done (and there is   -> done
//     at least one)
//   anything else                   -> in_progress
export const projectSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  icon: projectIconSchema,
  colour: projectColourSchema,
  // The branches the project runs at, named so the screens never have to resolve an id. EMPTY is
  // the chain-wide case and the only one: a project either names the branches it touches or it
  // touches all of them, and there is no third state to render.
  locations: z.array(projectBranchSchema),
  // Who the project is for. Never empty — a project nobody can see is not a project.
  roles: z.array(projectRoleSchema),
  startDate: z.string().nullable(),
  targetDate: z.string().nullable(),
  phase: projectPhaseSchema,
  // The checklist, counted. Progress is these two numbers and nothing else.
  doneCount: z.number().int(),
  taskCount: z.number().int(),
  status: taskStatusSchema,
  createdBy: taskUserRefSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProjectSummary = z.infer<typeof projectSummarySchema>

export const projectListResponseSchema = z.object({
  projects: z.array(projectSummarySchema),
})
export type ProjectListResponse = z.infer<typeof projectListResponseSchema>

// The detail read: the summary plus the project's checklist, in its own manual order.
export const projectDetailResponseSchema = z.object({
  project: projectSummarySchema,
  checklist: z.array(projectChecklistItemSchema),
})
export type ProjectDetailResponse = z.infer<typeof projectDetailResponseSchema>

// Create a project. Manager/admin only at the route; the branches are checked server-side against
// the acting principal exactly as a task's location is (ADR-0007) — a manager may name their own
// branch or none, an admin may name any. A manager may also make a chain-wide project, since a
// rollout does not stop at their branch.
export const createProjectRequestSchema = z.object({
  name: z.string().trim().min(1),
  icon: projectIconSchema,
  colour: projectColourSchema,
  // The branches this project runs at. EMPTY means chain-wide, and omitted means the same thing —
  // there is no third case, which is why chain-wide is one exclusive choice in the picker rather
  // than a checkbox somebody could tick alongside two branches.
  locationIds: z.array(z.string().uuid()).default([]),
  // At least one — the form defaults to Manager, and an empty set would create a project that
  // nobody but an admin could ever open.
  roles: z.array(projectRoleSchema).min(1),
  startDate: z.string().datetime().nullish(),
  targetDate: z.string().datetime().nullish(),
  phase: projectPhaseSchema.default('planning'),
  // The checklist can be written as the project is created, so somebody planning a rollout types
  // the steps while they are still thinking about them rather than on a second screen.
  checklist: z.array(z.string().trim().min(1)).default([]),
})
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>

// Edit a project. Like the task edit it replaces the editable fields wholesale, so every field is
// present (nullable where the column is) and there is no partial-patch ambiguity. Branches ARE
// editable here, unlike a task's single location: a rollout that reaches a second branch in its
// third week is the ordinary case, not a new project. The same server-side check applies, so a
// manager still cannot push one onto somebody else's branch.
export const updateProjectRequestSchema = z.object({
  name: z.string().trim().min(1),
  icon: projectIconSchema,
  colour: projectColourSchema,
  locationIds: z.array(z.string().uuid()).default([]),
  roles: z.array(projectRoleSchema).min(1),
  startDate: z.string().datetime().nullable(),
  targetDate: z.string().datetime().nullable(),
  // Settable by hand like any other field. The app still overrides it to `completed` when the
  // last item is ticked, and off it when one is un-ticked — the automatic move always wins,
  // because the checklist is the thing that is actually true.
  phase: projectPhaseSchema,
})
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>

export const projectIdParamsSchema = z.object({
  id: z.string().uuid(),
})
export type ProjectIdParams = z.infer<typeof projectIdParamsSchema>

// Deleting a project does NOT delete its tasks — they return to the board unfiled. A project is a
// way of grouping work, and losing the grouping must never lose the work.
export const projectDeleteResponseSchema = z.object({
  status: z.literal('ok'),
})
export type ProjectDeleteResponse = z.infer<typeof projectDeleteResponseSchema>

// --- The checklist inside a project ---

export const addChecklistItemRequestSchema = z.object({
  title: z.string().trim().min(1),
})
export type AddChecklistItemRequest = z.infer<typeof addChecklistItemRequestSchema>

// Ticking an item can change the project's phase, so the whole project comes back with the
// checklist rather than the item alone — the client would otherwise have to guess whether the
// phase moved and refetch to find out.
export const checklistMutationResponseSchema = projectDetailResponseSchema
export type ChecklistMutationResponse = z.infer<typeof checklistMutationResponseSchema>

export const setChecklistItemRequestSchema = z.object({
  done: z.boolean(),
})
export type SetChecklistItemRequest = z.infer<typeof setChecklistItemRequestSchema>

export const checklistItemParamsSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
})
export type ChecklistItemParams = z.infer<typeof checklistItemParamsSchema>
