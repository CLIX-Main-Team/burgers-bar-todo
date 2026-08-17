import type { PreferredLanguage, PushPlatform } from '@burgers/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../db/client.js'
import { pushDevices, users } from '../db/schema.js'

// The registered-device data-access seam (#59 delivery side). Four operations, all of them
// keyed by something the caller already holds — a token it was just handed, or a set of user ids
// the write service resolved — so there is deliberately no "list every device" method for a caller
// to reach for.

// One device to ring, paired with the language its owner reads. The language rides along because
// the notification is written server-side (the phone is asleep; there is no app running to
// translate anything), so the sender needs it at the moment it builds the message.
export interface PushDeviceRecipient {
  token: string
  language: PreferredLanguage
}

export interface RegisterDeviceInput {
  token: string
  userId: string
  platform: PushPlatform
}

export interface PushDeviceRepository {
  // Claim this token for this user, whether or not it is already known. Idempotent by design: the
  // app re-registers on every authenticated start, and the same phone handed to a different member
  // of staff must move to its new owner rather than ring for both.
  register(input: RegisterDeviceInput): Promise<void>
  // Release a token on sign-out. Scoped to the owning user, so a token someone else holds is left
  // untouched — a caller cannot silence another person's phone by guessing at their token.
  unregister(token: string, userId: string): Promise<void>
  // The devices of these people, with the language each of them reads. Empty in, empty out.
  recipientsFor(userIds: readonly string[]): Promise<PushDeviceRecipient[]>
  // Drop tokens the transport reported as no longer registered. Unscoped on purpose — this is the
  // sender reporting a device that no longer exists at all, not a user acting on their own row.
  forget(tokens: readonly string[]): Promise<void>
}

export function createPushDeviceRepository(db: Db): PushDeviceRepository {
  return {
    register: async ({ token, userId, platform }) => {
      await db
        .insert(pushDevices)
        .values({ token, userId, platform })
        .onConflictDoUpdate({
          target: pushDevices.token,
          // now() rather than an injected clock: this column is a liveness record for pruning, not
          // a value any behaviour is asserted against, so the database's own time is the honest one.
          set: { userId, platform, updatedAt: sql`now()` },
        })
    },

    unregister: async (token, userId) => {
      await db
        .delete(pushDevices)
        .where(and(eq(pushDevices.token, token), eq(pushDevices.userId, userId)))
    },

    recipientsFor: async (userIds) => {
      if (userIds.length === 0) return []
      return db
        .select({ token: pushDevices.token, language: users.preferredLanguage })
        .from(pushDevices)
        .innerJoin(users, eq(users.id, pushDevices.userId))
        .where(inArray(pushDevices.userId, [...userIds]))
    },

    forget: async (tokens) => {
      if (tokens.length === 0) return
      await db.delete(pushDevices).where(inArray(pushDevices.token, [...tokens]))
    },
  }
}
