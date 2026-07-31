import { sql } from 'drizzle-orm'
import { pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

// The auth schema for the whole feature (ADR-0006, ADR-0010): three tables, one
// shared token primitive. No locations table yet — location_id is a nullable
// column with no FK until the task-board feature introduces Location as a table.

export const roleEnum = pgEnum('role', ['admin', 'manager', 'employee'])
export const userStatusEnum = pgEnum('user_status', ['invited', 'active', 'deactivated'])
export const preferredLanguageEnum = pgEnum('preferred_language', ['he', 'en'])
export const authTokenPurposeEnum = pgEnum('auth_token_purpose', ['invite', 'reset'])

// A person's account. password_hash is null while status is `invited` and is set
// on invite accept. Email is unique case-insensitively (index on lower(email)).
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: roleEnum('role').notNull(),
    locationId: uuid('location_id'),
    status: userStatusEnum('status').notNull().default('invited'),
    passwordHash: text('password_hash'),
    preferredLanguage: preferredLanguageEnum('preferred_language').notNull().default('he'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`)],
)

// A stateful, DB-backed session. The credential is an opaque bearer token; only
// its hash is stored. Revocation is a row delete and is immediate (ADR-0006).
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
})

// The one shared token primitive behind both invite and reset (ADR-0006, ADR-0010):
// opaque, hashed at rest, single-use, expiring. `purpose` is the only thing that
// differs between the two flows; role and location live on the user row.
export const authTokens = pgTable('auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  purpose: authTokenPurposeEnum('purpose').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
