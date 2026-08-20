import { type PreferredLanguage, type Role, type UserStatus, isChainAdmin } from '@burgers/shared'
import { type SQL, and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { authTokens, locations, sessions, users } from '../db/schema.js'
import type { TokenPurpose } from './tokens.js'

// The scoped data-access layer for auth (ADR-0007). Every method here is a named,
// purpose-built operation — never a generic "get user by id" or "get all users" that
// a handler could reach with a client-supplied identifier. The two pre-principal
// reads (by email, by session-token hash) are the authentication primitives that
// *produce* the principal; there is no path that returns an arbitrary row on request,
// which is the unscoped path ADR-0007 exists to forbid. Later features add their own
// scoped repositories parametrised by the principal this one helps establish.

// The fields sign-in needs to check a credential and, on success, build the session's
// principal. Kept internal to the auth service — never serialized to a client.
export interface AuthUserRow {
  id: string
  passwordHash: string | null
  role: Role
  locationId: string | null
  status: UserStatus
}

// A validated session joined to its user, so the principal is read fresh from the
// users row on every request (ADR-0007): a reassignment or deactivation lands on the
// very next request with no cached claim to go stale.
export interface SessionWithPrincipal {
  sessionId: string
  expiresAt: Date
  userId: string
  displayName: string
  role: Role
  locationId: string | null
  status: UserStatus
}

export interface NewSession {
  userId: string
  tokenHash: string
  expiresAt: Date
  now: Date
}

export interface SeedAdminInput {
  email: string
  displayName: string
  passwordHash: string
}

// The outward view of a users row the provisioning API reports (stories 6, 8): no
// credential material, structurally the shared UserSummary contract. createInvitedUser
// returns the freshly created pending user in this shape and listUsers returns a scoped
// list of them.
export interface UserRow {
  id: string
  email: string
  displayName: string
  role: Role
  locationId: string | null
  // The Location's name resolved from the FK, so the outward user carries a printable
  // branch (mockup #179) and no surface prints a raw uuid. Null for a chain-wide admin
  // (a null locationId), which the UI reads as "Chain-wide".
  locationName: string | null
  status: UserStatus
  preferredLanguage: PreferredLanguage
}

// Create-invite writes the users row immediately with role and Location baked in and
// status invited (password_hash stays null until accept). The caller has already
// enforced, from the principal, that this role/Location pair is one it may create
// (ADR-0007); the repository only writes what it is given.
export interface CreateInvitedUserInput {
  email: string
  displayName: string
  role: Role
  locationId: string | null
  now: Date
  // An optional explicit id so a deterministic seed (the test-only fixture cast) can pin a
  // known user id it addresses later, mirroring createLocation's optional id. Omitted in
  // every production path, where the table's uuid default assigns one.
  id?: string
}

// The scope listUsers reads (ADR-0007 tier two): an admin sees every user, a manager
// sees only their own Location. Derived from the principal by the caller and passed in;
// there is no unscoped list path.
export interface UserListScope {
  role: Role
  locationId: string | null
}

export interface NewAuthToken {
  userId: string
  purpose: TokenPurpose
  tokenHash: string
  expiresAt: Date
  now: Date
}

// The remit for acting on a single pending invite by id (resend/revoke, #32). Mirrors
// UserListScope and is derived from the principal by the caller, never from the request:
// an admin may act on any invite; a manager only on an employee invite for their own
// Location. Baked into the WHERE of every invite-action query so there is no path that
// resolves an arbitrary user by a client-supplied id (ADR-0007) — the row must already
// be one this principal could have created, so cross-Location and cross-role ids match
// nothing and read as not-found rather than confirming the row exists.
export interface InviteActionScope {
  role: Role
  locationId: string | null
}

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRow | undefined>
  createSession(input: NewSession): Promise<void>
  findSessionByTokenHash(tokenHash: string): Promise<SessionWithPrincipal | undefined>
  touchSession(sessionId: string, expiresAt: Date, lastUsedAt: Date): Promise<void>
  deleteSessionByTokenHash(tokenHash: string): Promise<void>
  deleteAllSessionsForUser(userId: string): Promise<void>
  upsertSeedAdmin(input: SeedAdminInput): Promise<void>
  // Returns the created pending user, or undefined when the email already exists — the
  // case-insensitive unique index is left to reject a duplicate rather than racing a
  // pre-check, so a repeat invite is a clean conflict, not a 500.
  createInvitedUser(input: CreateInvitedUserInput): Promise<UserRow | undefined>
  listUsers(scope: UserListScope): Promise<UserRow[]>
  insertAuthToken(input: NewAuthToken): Promise<void>
  // Atomically spend a token: match by hash and purpose, require unused and unexpired,
  // stamp used_at, and return the owning user id — or undefined if nothing matched.
  consumeAuthToken(
    tokenHash: string,
    purpose: TokenPurpose,
    now: Date,
  ): Promise<{ userId: string } | undefined>
  // Set the password and language and flip invited -> active in one write, guarded on
  // the current status so only a pending user is activated. Returns the activated user,
  // or undefined if the user was not invited (already active, deactivated, or gone).
  activateInvitedUser(input: ActivateInvitedUserInput): Promise<UserRow | undefined>
  // Flip active -> deactivated, guarded on the current status so only an active user is
  // cut. Returns the deactivated user, or undefined when no active user matched (unknown
  // id, or already deactivated/invited). The record is retained — a status change, never
  // a delete — so historical creator/assignee references still resolve (story 31).
  deactivateUser(userId: string, now: Date): Promise<UserRow | undefined>
  // Flip deactivated -> active, guarded on the current status so only a deactivated user
  // is restored. Returns the reactivated user, or undefined when no deactivated user
  // matched. The guard keeps the pairing tight: only a previously-active account (which
  // therefore has a password) is ever reactivated, so sign-in works with no
  // re-provisioning (story 32); an invited user is never activated by this path.
  reactivateUser(userId: string, now: Date): Promise<UserRow | undefined>
  // Read a pending invite the caller may act on, by id (resend). Returns the user only
  // when it is still status invited and within the caller's scope; otherwise undefined,
  // so an unknown id, an already-accepted user, and an out-of-scope invite are
  // indistinguishable. Resend reads it for the recipient's email; the scope predicate is
  // the same one revoke deletes under.
  findInvitedUserInScope(userId: string, scope: InviteActionScope): Promise<UserRow | undefined>
  // Invalidate every still-outstanding invite token for a user by stamping used_at, so a
  // previously mailed link stops working (resend). Idempotent — an already-used or absent
  // token is left as it is — and scoped by purpose so a live reset token is never touched.
  invalidateInviteTokens(userId: string, now: Date): Promise<void>
  // The reset counterpart (#34): invalidate every still-outstanding reset token for a user
  // by stamping used_at, so a previously mailed reset link stops working. Used when a fresh
  // reset is requested (a new link supersedes the old one, story 28) and again on a
  // completed consume (the user's other outstanding reset tokens are spent). Scoped to the
  // reset purpose so a live invite token is never touched.
  invalidateResetTokens(userId: string, now: Date): Promise<void>
  // Set a new password on an active user, guarded on the current status so only an active
  // account is ever changed (#34). Returns the updated user, or undefined when no active
  // user matched — a reset token that somehow resolved to an invited or deactivated user
  // changes nothing, so a stale token can never restore or seed a credential out of band.
  setActiveUserPassword(input: SetPasswordInput): Promise<UserRow | undefined>
  // Delete a pending invite by id within the caller's scope (revoke): remove the Invited
  // users row so it is gone from the list, and its auth_tokens cascade, so the link dies
  // with it. Guarded on status invited and the scope predicate, so an active user, an
  // unknown id, and an out-of-scope invite all match nothing. Returns whether a row was
  // removed, so the route answers all three misses alike.
  revokeInviteInScope(userId: string, scope: InviteActionScope): Promise<boolean>
}

export interface ActivateInvitedUserInput {
  userId: string
  passwordHash: string
  preferredLanguage: PreferredLanguage
  now: Date
}

export interface SetPasswordInput {
  userId: string
  passwordHash: string
  now: Date
}

// The columns every UserRow read selects — one place, so createInvitedUser, listUsers,
// and activateInvitedUser return the identical outward shape. locationName resolves the FK
// to a printable branch name via a correlated subquery rather than a join: the mutation
// paths return their row through RETURNING (create-invite, activate, deactivate,
// reactivate), and a RETURNING list can reference only the mutated table's columns — it
// cannot carry a join. A correlated subquery reads the same in a plain SELECT (listUsers)
// and in RETURNING, so one column definition serves every path and no surface prints a
// raw uuid (mockup #179). A location-less admin's subquery finds no row and yields null,
// which the UI presents as "Chain-wide".
const userRowColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  role: users.role,
  locationId: users.locationId,
  locationName: sql<
    string | null
  >`(select ${locations.name} from ${locations} where ${locations.id} = ${users.locationId})`,
  status: users.status,
  preferredLanguage: users.preferredLanguage,
} as const

export function createAuthRepository(db: Db): AuthRepository {
  // Shared body of invalidateInviteTokens / invalidateResetTokens: stamp used_at on every
  // still-live token of one purpose for a user, matching the exact guards consumeAuthToken
  // enforces, so a superseded link fails at consume. Idempotent — an already-used or
  // expired token matches nothing and is left as it is.
  const invalidateTokens = async (
    userId: string,
    purpose: TokenPurpose,
    now: Date,
  ): Promise<void> => {
    await db
      .update(authTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(authTokens.userId, userId),
          eq(authTokens.purpose, purpose),
          isNull(authTokens.usedAt),
          gt(authTokens.expiresAt, now),
        ),
      )
  }

  return {
    // Case-insensitive match on the same lower(email) key the unique index enforces,
    // so capitalisation never locks a user out (story 20) and never admits a second
    // row for the same address.
    findUserByEmail: async (email) => {
      const rows = await db
        .select({
          id: users.id,
          passwordHash: users.passwordHash,
          role: users.role,
          locationId: users.locationId,
          status: users.status,
        })
        .from(users)
        .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
        .limit(1)
      return rows[0]
    },

    createSession: async ({ userId, tokenHash, expiresAt, now }) => {
      await db.insert(sessions).values({
        userId,
        tokenHash,
        expiresAt,
        // Stamp the timestamps from the injected clock rather than the DB default, so
        // the whole session lifecycle is driven by one controllable time source.
        createdAt: now,
        lastUsedAt: now,
      })
    },

    findSessionByTokenHash: async (tokenHash) => {
      const rows = await db
        .select({
          sessionId: sessions.id,
          expiresAt: sessions.expiresAt,
          userId: users.id,
          displayName: users.displayName,
          role: users.role,
          locationId: users.locationId,
          status: users.status,
        })
        .from(sessions)
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(eq(sessions.tokenHash, tokenHash))
        .limit(1)
      return rows[0]
    },

    touchSession: async (sessionId, expiresAt, lastUsedAt) => {
      await db.update(sessions).set({ expiresAt, lastUsedAt }).where(eq(sessions.id, sessionId))
    },

    // Revocation is a row delete and is immediate (ADR-0006): once the row is gone,
    // findSessionByTokenHash misses and the next request is refused. Logout deletes
    // the one session behind the presented token; a token that matches nothing (an
    // already-revoked device) simply deletes zero rows, which is the same end state.
    deleteSessionByTokenHash: async (tokenHash) => {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash))
    },

    // Logout-all deletes every session the user holds — the lost-or-stolen-device
    // case (story 25), and the side effect a completed reset and a deactivation reuse.
    deleteAllSessionsForUser: async (userId) => {
      await db.delete(sessions).where(eq(sessions.userId, userId))
    },

    // Idempotent by construction (ADR-0005, stories 1-2): a first run inserts the one
    // admin; a second run conflicts on the lower(email) unique index and does nothing,
    // so the existing admin is never duplicated and never overwritten. role/locationId/
    // status are fixed here — an admin has no location and is active from the start.
    upsertSeedAdmin: async ({ email, displayName, passwordHash }) => {
      await db
        .insert(users)
        .values({
          email,
          displayName,
          role: 'admin',
          locationId: null,
          status: 'active',
          passwordHash,
        })
        .onConflictDoNothing()
    },

    // Create the pending user immediately at invite time (stories 6, 8): role and
    // Location baked in, status invited, password_hash left null until accept. The
    // timestamps come from the injected clock so the whole flow reads one time source.
    createInvitedUser: async ({ email, displayName, role, locationId, now, id }) => {
      const rows = await db
        .insert(users)
        .values({
          // Only pin the id when a caller passes one (the fixture cast); every production
          // path omits it and takes the table's uuid default.
          ...(id === undefined ? {} : { id }),
          email,
          displayName,
          role,
          locationId,
          status: 'invited',
          createdAt: now,
          updatedAt: now,
        })
        // A duplicate email conflicts on the lower(email) unique index and inserts
        // nothing; returning is then empty, which the caller reads as a conflict.
        .onConflictDoNothing()
        .returning(userRowColumns)
      return rows[0]
    },

    // The scoped list (ADR-0007 tier two): an admin sees everyone, a manager only their
    // own Location. The predicate is derived here from the principal's role and location,
    // never from client input, so there is no unscoped path a caller could reach.
    listUsers: async (scope) => {
      const query = db.select(userRowColumns).from(users)
      if (isChainAdmin(scope.role)) {
        return query
      }
      // A manager (or any non-admin) sees only their Location. A null location would
      // match nothing rather than widening the view, which is the safe direction.
      return query.where(eq(users.locationId, scope.locationId as string))
    },

    insertAuthToken: async ({ userId, purpose, tokenHash, expiresAt, now }) => {
      await db.insert(authTokens).values({
        userId,
        purpose,
        tokenHash,
        expiresAt,
        createdAt: now,
      })
    },

    // Single-use and expiry enforced in one conditional write: the UPDATE only matches a
    // row that is this purpose, still unused, and unexpired, so two concurrent consumes
    // cannot both win and an expired or spent token matches nothing. RETURNING gives the
    // owning user id on the one write that succeeds.
    consumeAuthToken: async (tokenHash, purpose, now) => {
      const rows = await db
        .update(authTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(authTokens.tokenHash, tokenHash),
            eq(authTokens.purpose, purpose),
            isNull(authTokens.usedAt),
            gt(authTokens.expiresAt, now),
          ),
        )
        .returning({ userId: authTokens.userId })
      return rows[0]
    },

    // Flip invited -> active while setting the password and language, guarded on the
    // current status so only a pending user is activated — a token that somehow resolved
    // to an already-active or deactivated user updates nothing and returns undefined.
    activateInvitedUser: async ({ userId, passwordHash, preferredLanguage, now }) => {
      const rows = await db
        .update(users)
        .set({ passwordHash, preferredLanguage, status: 'active', updatedAt: now })
        .where(and(eq(users.id, userId), eq(users.status, 'invited')))
        .returning(userRowColumns)
      return rows[0]
    },

    // Cut access while keeping the record (story 31): flip active -> deactivated in one
    // guarded write. The status='active' predicate means an unknown id, an already
    // deactivated user, or a still-invited user updates nothing and returns undefined,
    // which the caller reads as not-found. The password_hash is left intact so a later
    // reactivation restores sign-in without re-provisioning.
    deactivateUser: async (userId, now) => {
      const rows = await db
        .update(users)
        .set({ status: 'deactivated', updatedAt: now })
        .where(and(eq(users.id, userId), eq(users.status, 'active')))
        .returning(userRowColumns)
      return rows[0]
    },

    // Restore access (story 32): flip deactivated -> active in one guarded write. The
    // status='deactivated' predicate means only a deactivated account is reactivated — an
    // active or still-invited user updates nothing and returns undefined. Because the
    // matching row was necessarily active before (only deactivateUser sets deactivated),
    // it still carries the password it had, so sign-in works with no re-provisioning.
    reactivateUser: async (userId, now) => {
      const rows = await db
        .update(users)
        .set({ status: 'active', updatedAt: now })
        .where(and(eq(users.id, userId), eq(users.status, 'deactivated')))
        .returning(userRowColumns)
      return rows[0]
    },

    findInvitedUserInScope: async (userId, scope) => {
      const rows = await db
        .select(userRowColumns)
        .from(users)
        .where(and(eq(users.id, userId), eq(users.status, 'invited'), inviteScopePredicate(scope)))
        .limit(1)
      return rows[0]
    },

    // Mark every unused, unexpired token of one purpose for this user as used, exactly as
    // a consume would, so an old link now misses consumeAuthToken's isNull(usedAt) guard.
    // Scoped by purpose so invalidating invites never touches a live reset token and vice
    // versa. Invite resend and reset request/consume are the two callers.
    invalidateInviteTokens: async (userId, now) => {
      await invalidateTokens(userId, 'invite', now)
    },

    invalidateResetTokens: async (userId, now) => {
      await invalidateTokens(userId, 'reset', now)
    },

    // Set a new password on an active user (#34, reset consume). The status='active'
    // predicate means only an active account is ever changed — a token that resolved to an
    // invited or deactivated user updates nothing and returns undefined — so a stale reset
    // token can never seed a credential on a pending user or restore a cut-off one.
    setActiveUserPassword: async ({ userId, passwordHash, now }) => {
      const rows = await db
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(and(eq(users.id, userId), eq(users.status, 'active')))
        .returning(userRowColumns)
      return rows[0]
    },

    revokeInviteInScope: async (userId, scope) => {
      // Delete the pending row; auth_tokens has ON DELETE CASCADE from users, so the
      // outstanding link is destroyed in the same write. RETURNING lets us tell a real
      // removal from a no-op miss (unknown id, active user, or out-of-scope).
      const rows = await db
        .delete(users)
        .where(and(eq(users.id, userId), eq(users.status, 'invited'), inviteScopePredicate(scope)))
        .returning({ id: users.id })
      return rows.length > 0
    },
  }
}

// The scope predicate every by-id invite action is guarded with (ADR-0007 tier two): an
// admin reaches any row, so no extra constraint; a manager (or any non-admin) reaches
// only an employee invite at their own Location, the pair they were allowed to create.
// Composed into the WHERE, never applied after the read, so an out-of-remit id resolves
// nothing rather than being fetched and then rejected.
function inviteScopePredicate(scope: InviteActionScope): SQL {
  if (isChainAdmin(scope.role)) {
    return sql`true`
  }
  return and(eq(users.role, 'employee'), eq(users.locationId, scope.locationId as string)) as SQL
}
