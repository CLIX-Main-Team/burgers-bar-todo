import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

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

// The Assistant's local mirror of the Drive corpus (ADR-0004, ADR-0014): one row per
// Drive file, keyed on drive_file_id so reconciliation can upsert or delete a file by
// its stable Drive id. Grounding reads this cache and never touches Drive live, so a
// slow Drive never slows an answer. No embeddings column — v1 injects doc text directly
// (ADR-0004); embeddings would be gold-plating at this corpus size and can be added over
// this same table later. location_id is nullable (NULL = chain-wide) from day one so
// per-location knowledge is a purely additive change, not a migration (ADR-0004).
export const knowledgeDocStatusEnum = pgEnum('knowledge_doc_status', ['ingested', 'skipped'])

export const knowledgeDocs = pgTable(
  'knowledge_docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The Drive file id — the stable key reconciliation upserts and deletes on. Unique
    // so a re-synced change updates the existing row rather than duplicating it.
    driveFileId: text('drive_file_id').notNull(),
    title: text('title').notNull(),
    // The extracted plain text grounding injects. Null for a `skipped` doc (one the
    // system could not read — a format handled in a later ticket); an `ingested` doc
    // always carries its text.
    content: text('content'),
    // The Drive mime type the file was ingested from (e.g. a Google Doc), so a later
    // format branch and admin surface can tell what a row came from.
    sourceMimeType: text('source_mime_type').notNull(),
    locationId: uuid('location_id'),
    status: knowledgeDocStatusEnum('status').notNull(),
    // Drive's own modifiedTime for the file, carried as reconciliation metadata: the
    // record of which revision this cache row reflects.
    driveModifiedTime: timestamp('drive_modified_time', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('knowledge_docs_drive_file_id_unique').on(table.driveFileId)],
)

// The persisted Drive-changes cursor (ADR-0014): a single-row settings store holding the
// page token reconciliation resumes `changes.list` from. Single-row by construction — the
// boolean primary key is fixed true and a CHECK pins it, so there is exactly one cursor
// for the one chain-wide corpus. page_token is null only before the first sync obtains a
// start page token; thereafter it advances each sync.
export const driveSyncState = pgTable(
  'drive_sync_state',
  {
    id: boolean('id').primaryKey().default(true),
    pageToken: text('page_token'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('drive_sync_state_singleton', sql`${table.id}`)],
)
