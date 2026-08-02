import type { PreferredLanguage, Role, UserStatus } from '@burgers/shared'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { authTokens, sessions, users } from '../db/schema.js'
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
}

export interface ActivateInvitedUserInput {
  userId: string
  passwordHash: string
  preferredLanguage: PreferredLanguage
  now: Date
}

// The columns every UserRow read selects — one place, so createInvitedUser, listUsers,
// and activateInvitedUser return the identical outward shape.
const userRowColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  role: users.role,
  locationId: users.locationId,
  status: users.status,
  preferredLanguage: users.preferredLanguage,
} as const

export function createAuthRepository(db: Db): AuthRepository {
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
    createInvitedUser: async ({ email, displayName, role, locationId, now }) => {
      const rows = await db
        .insert(users)
        .values({
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
      if (scope.role === 'admin') {
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
  }
}
