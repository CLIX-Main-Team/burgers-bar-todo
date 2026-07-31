import type { Role, UserStatus } from '@burgers/shared'
import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { sessions, users } from '../db/schema.js'

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

export interface AuthRepository {
  findUserByEmail(email: string): Promise<AuthUserRow | undefined>
  createSession(input: NewSession): Promise<void>
  findSessionByTokenHash(tokenHash: string): Promise<SessionWithPrincipal | undefined>
  touchSession(sessionId: string, expiresAt: Date, lastUsedAt: Date): Promise<void>
  upsertSeedAdmin(input: SeedAdminInput): Promise<void>
}

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
  }
}
