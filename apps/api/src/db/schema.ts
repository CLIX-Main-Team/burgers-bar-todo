import type { MessageSource } from '@burgers/shared'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// The auth schema for the whole feature (ADR-0006, ADR-0010): three tables, one
// shared token primitive. location_id is a real FK -> locations from the task-board
// prefactor (#130): the anticipated additive graduation from a bare uuid column, not
// a new architectural decision.

export const roleEnum = pgEnum('role', ['admin', 'manager', 'employee'])
export const userStatusEnum = pgEnum('user_status', ['invited', 'active', 'deactivated'])
export const preferredLanguageEnum = pgEnum('preferred_language', ['he', 'en'])
export const authTokenPurposeEnum = pgEnum('auth_token_purpose', ['invite', 'reset'])

// A single restaurant branch of the chain (CONTEXT: Location) and the scope boundary
// users and tasks belong to. Introduced as the task-board prefactor (#130) so every
// board slice below builds against a real table. Carries a human name so a branch is
// identifiable on the board; the task-board slices add the scoped read/write operations
// on top. No onDelete on the referencing side — a Location with users is never dropped in
// v1, so the default no-action FK is the safe guard.
export const locations = pgTable('locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// A person's account. password_hash is null while status is `invited` and is set
// on invite accept. Email is unique case-insensitively (index on lower(email)).
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: roleEnum('role').notNull(),
    // Admins are chain-wide and hold a null location; a manager or employee references a
    // real Location. Nullable FK, so the admin-null case is expressible (#130).
    locationId: uuid('location_id').references(() => locations.id),
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

// The fixed shelves the admin Knowledge tab files every doc under (ADR-0024). Slugs are what
// the categorizer writes and the API serves; the web app owns their localized display names.
// Plain text column rather than a pg enum so growing the set stays a code-only change.
// `general` doubles as the floor: the categorizer stamps it when the model's reply is not a
// recognizable slug, so no doc can wedge itself into a permanent unfiled state.
export const KNOWLEDGE_CATEGORIES = [
  'procedures',
  'finance',
  'hr',
  'reports',
  'agreements',
  'menu',
  'general',
] as const

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number]

export const knowledgeDocs = pgTable(
  'knowledge_docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The Drive file id — the stable key reconciliation upserts and deletes on. Unique
    // so a re-synced change updates the existing row rather than duplicating it.
    driveFileId: text('drive_file_id').notNull(),
    title: text('title').notNull(),
    // The extracted plain text grounding injects. Null for a `skipped` doc (one the
    // system could not read — e.g. a scanned/image-only PDF with no text layer); an
    // `ingested` doc always carries its text.
    content: text('content'),
    // Why a `skipped` doc was skipped — the admin-visible reason a document the system
    // cannot read is surfaced rather than silently guessed from (e.g. "scanned or
    // image-only PDF: no extractable text layer"). Null for an `ingested` doc.
    skipReason: text('skip_reason'),
    // The Drive mime type the file was ingested from (e.g. a Google Doc), so a later
    // format branch and admin surface can tell what a row came from.
    sourceMimeType: text('source_mime_type').notNull(),
    locationId: uuid('location_id'),
    status: knowledgeDocStatusEnum('status').notNull(),
    // The admin-tab shelf this doc is filed under — one of the fixed KNOWLEDGE_CATEGORIES
    // slugs above, assigned by the LLM categorizer after each sync. NULL means "not yet
    // categorized": new rows start here and the categorizer sweeps them up on the next
    // pass, so a transient LLM failure self-heals instead of sticking.
    category: text('category').$type<KnowledgeCategory>(),
    // Drive's own modifiedTime for the file, carried as reconciliation metadata: the
    // record of which revision this cache row reflects.
    driveModifiedTime: timestamp('drive_modified_time', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('knowledge_docs_drive_file_id_unique').on(table.driveFileId)],
)

// The retrieval index over the knowledge cache (ADR-0025): each ingested doc split into
// chunks a question is matched against, so grounding injects the relevant pieces of the
// corpus instead of whole documents. `embedding` is the chunk's semantic vector (a plain
// jsonb float array — the corpus is ~a hundred chunks, ranked in-process; a dedicated
// vector index is the 10×-corpus upgrade, not this slice). Null until the embedding
// backfill reaches the chunk (or when the provider has no embeddings), in which case
// retrieval falls back to keyword ranking over the same chunks. Rows are replaced
// wholesale whenever the parent doc re-syncs, and the FK cascades a doc's removal.
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    docId: uuid('doc_id')
      .notNull()
      .references(() => knowledgeDocs.id, { onDelete: 'cascade' }),
    // The chunk's position in the doc's original order, so grounding can render a doc's
    // selected chunks in reading order.
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: jsonb('embedding').$type<number[]>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('knowledge_chunks_doc_position_unique').on(table.docId, table.chunkIndex),
  ],
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

// A user's private assistant conversation (ADR-0003, ADR-0007): one row per thread the
// author owns and returns to. user_id is the owner and the sole visibility key — a thread
// is read only by its author, with no manager or admin override in v1, enforced by the
// author-scoped predicate on every read in the API layer (there is no unscoped path). The
// title is auto-derived from the first user message at create time (a cheap truncation, not
// a model call), so the list is scannable without an LLM. created_at/updated_at drive the
// most-recently-active-first ordering of a user's list; in this slice both are stamped once at
// create, and the answer path (a later slice) will bump updated_at as it appends turns.
export const threads = pgTable('threads', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// A turn's author: exactly `user` and `agent` — no `error` role, because a failed answer is a
// transient inline retry, not a persisted row (ADR-0003). The enum is the type-level half of
// the no-forged-turn boundary: the only write path fixes role = 'user' server-side, and the
// answer path (a later slice) is the only writer of an `agent` turn, so a browser can neither
// insert a row directly nor name the role it carries (ADR-0007).
export const messageRoleEnum = pgEnum('message_role', ['user', 'agent'])

// One turn inside a thread (ADR-0003, ADR-0007). Every message write happens inside the
// assistant service; there is no client message-insert path, so an `agent` voice cannot be
// forged from the browser and a user cannot inject a fake turn. content is the turn's text;
// created_at orders the history within a thread. A message is reached only through its owning
// thread, whose author-scoped read is the privacy boundary — messages carry no user_id of
// their own and are never queried outside an already-authorised thread.
export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  threadId: uuid('thread_id')
    .notNull()
    .references(() => threads.id, { onDelete: 'cascade' }),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  // The knowledge docs an `agent` turn's answer drew on (#227): the id/title pairs the attribution
  // chips render. Written only by the answer path — an empty array when the answer was task-grounded
  // or a refusal, and left null on a `user` turn, which cites nothing. A jsonb column rather than a
  // join table because a source is a denormalised label snapshot the answer owns, not a live FK: a
  // doc later re-synced or removed must not rewrite or vanish from an answer already given.
  sources: jsonb('sources').$type<MessageSource[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// --- Task board (the todo, #129) ---

// The closed sets a task carries (CONTEXT: Task). status is the one shared state every
// assignee sees — no per-person completion (ADR-0001); priority feeds the read-side sort
// toggle (Slice A). pg enums so the board can only ever hold a value the UI knows how to
// render, and a new value is a deliberate migration rather than a silent free-text drift.
export const taskStatusEnum = pgEnum('task_status', ['not_started', 'in_progress', 'done'])
export const taskPriorityEnum = pgEnum('task_priority', ['low', 'normal', 'high'])

// A single unit of work on a location's board (CONTEXT: Task, #131 Slice A). location_id is a
// real FK -> locations and the scope boundary every ADR-0007 read/write is filtered by (a
// manager sees one location, an admin the chain); no onDelete, matching users — a Location with
// tasks is never dropped in v1. description is free text in the author's language and is never
// auto-translated, so it is a plain nullable column with no locale tag. completed_at is
// system-maintained (set when status becomes done, cleared when it leaves done; the write path
// lands in Slice C) and null until then. position is the shared per-location manual order the
// board opens to; the read-side priority sort is a per-viewer lens that never rewrites it, and
// drag that mutates it lands in Slice D.
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  locationId: uuid('location_id')
    .notNull()
    .references(() => locations.id),
  // Who created the task (#258, PRD: identity carries "who created it") — the acting principal at
  // create time, written by the service, never client-supplied. NOT NULL: rows that predate the
  // column were backfilled to the seed admin in the migration (2026-08 owner decision — a knowing
  // attribution over a blank). No onDelete, matching users — a user is deactivated, never dropped,
  // so a creator name always resolves.
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  description: text('description'),
  status: taskStatusEnum('status').notNull().default('not_started'),
  priority: taskPriorityEnum('priority').notNull().default('normal'),
  dueDate: timestamp('due_date', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// The assignee-set membership (CONTEXT: Assignee, #131 Slice A): a task↔user join, one row per
// person on a task, all sharing the task's single status. The empty-set case *is* the backlog —
// an employee's ADR-0007 predicate is "a row here names me", so backlog tasks fall out of their
// reads for free. created_at lives here, on the membership, because Notifications (#59) dates a
// "you were assigned" event from when the assignment happened, not from the task's creation — a
// cross-slice requirement recorded now so the column exists the moment assignment does (Slice B).
// Composite PK keeps a user on a task at most once; both sides cascade so a deleted task (Slice B)
// or a purged user takes its memberships with it.
export const taskAssignees = pgTable(
  'task_assignees',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.userId] })],
)

// The per-user board last-seen marker (#131 Slice A owns the trigger; #59 owns the badge that
// reads it). One row per user, bumped to "now" each time they open the board, so Notifications
// can later date the Tasks-tab badge from "what had you seen before this open". This slice writes
// and exposes the marker (its value rides back on the board read so the bump is observable through
// behaviour, not a row peek); it draws no badge. last_seen_at is null-free — a row exists only
// once a user has opened the board at least once, and its absence is itself "never seen".
export const taskBoardLastSeen = pgTable('task_board_last_seen', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
})
