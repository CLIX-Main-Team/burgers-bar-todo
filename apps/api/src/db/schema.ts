import type { MessageSource } from '@burgers/shared'
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from 'drizzle-orm/pg-core'

// The auth schema for the whole feature (ADR-0006, ADR-0010): three tables, one
// shared token primitive. location_id is a real FK -> locations from the task-board
// prefactor (#130): the anticipated additive graduation from a bare uuid column, not
// a new architectural decision.

export const roleEnum = pgEnum('role', [
  'super_admin',
  'ceo',
  'chain_manager',
  'finance_manager',
  'operations_manager',
  'procurement_manager',
  'marketing_manager',
  'brand_manager',
  'setup_manager',
  'chain_chef',
  'office_manager',
  'hq_secretary',
  'bookkeeper',
  'admin',
  'manager',
  'employee',
  'driver',
  'field_ops',
])
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
  // The chain's own branch number (client sheet 2026-08-27). Nullable — the testing branch has
  // none — and unique among the numbered (partial-free unique index in 0031: Postgres lets any
  // count of NULLs share a unique index).
  number: integer('number'),
  // Contact fields the branch detail page edits (2026-08-24 owner ask, PR 2 task 1). Nullable
  // because every row that exists today has none of them, and a rename must not become impossible
  // until someone fills one in.
  address: text('address'),
  city: text('city'),
  phone: text('phone'),
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
    // Only the branch trio (admin, manager, employee) references a real Location; every other
    // role, super_admin and the HQ roles alike, is chain-wide and holds null (2026-08-27).
    // Enforced by users_role_location_check below.
    locationId: uuid('location_id').references(() => locations.id),
    status: userStatusEnum('status').notNull().default('invited'),
    passwordHash: text('password_hash'),
    preferredLanguage: preferredLanguageEnum('preferred_language').notNull().default('he'),
    // When this person last used the app, stamped on the authenticated path (sessions.ts).
    // It lives on the person rather than on their session because a session row is deleted
    // by logout, reset and deactivation alike, which would erase the very history the
    // People roster is reporting. NULL is "has never signed in".
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_lower_unique').on(sql`lower(${table.email})`),
    // Only the branch trio holds a location; every chain-wide role is branch-less (0033,
    // recutting 0023's super_admin-only rule for the HQ roles). Expressed here as well as in
    // the migration so schema.ts stays an honest description of the table rather than silently
    // falling behind what the database actually enforces.
    check(
      'users_role_location_check',
      sql`(${table.role} in ('admin', 'manager', 'employee') and ${table.locationId} is not null)
          or (${table.role} not in ('admin', 'manager', 'employee') and ${table.locationId} is null)`,
    ),
  ],
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

// Deterministic document classification, assigned at sync time by document-metadata.ts from the
// document's folder and filename. Unlike the LLM-assigned category above, these are decided by
// rules, because sensitivity is an access-control key and an inconsistent one is a leak.
export const DEPARTMENTS = ['property', 'finance', 'hr', 'operations', 'office', 'general'] as const
export type Department = (typeof DEPARTMENTS)[number]

// The kind of document. A 'table' is a retrieval property as much as an admin one: it marks the
// dashboards, mappings and trackers whose rows are the answer to an exact-value question.
export const DOC_TYPES = [
  'checklist',
  'responsibilities',
  'table',
  'procedure',
  'report',
  'reference',
] as const
export type DocType = (typeof DOC_TYPES)[number]

// How widely a document may be read — three levels, because the app has three roles.
export const SENSITIVITIES = ['general', 'internal', 'confidential'] as const
export type Sensitivity = (typeof SENSITIVITIES)[number]

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
    // A hash of the extracted text, so a re-sync can tell a real edit from a Drive event that
    // touched nothing. Drive reports a change for a rename, a move, or a sharing tweak, and every
    // one of those used to re-download, re-chunk, and re-buy a gist completion per chunk plus fresh
    // embeddings for byte-identical content. NULL means the row was written before this column
    // existed, which reads as "unknown, so re-process once".
    contentHash: text('content_hash'),
    // The deterministic classification above, recomputed on every upsert. department and doc_type
    // are nullable because they are descriptive; sensitivity is the key retrieval filters on, so it
    // is NOT NULL. Its 'general' default is only ever reached by a row this column's migration
    // created — every write since goes through classifyDocument — and the migration backfills the
    // sensitive documents itself, so the default never leaves a lease readable.
    department: text('department').$type<Department>(),
    docType: text('doc_type').$type<DocType>(),
    sensitivity: text('sensitivity').$type<Sensitivity>().notNull().default('general'),
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
// corpus instead of whole documents. `embedding` is the chunk's semantic vector, a pgvector
// column the vector arm ranks with IN THE DATABASE (`<=>` cosine distance, exact scan). The
// jsonb-array-plus-in-process-cosine design it replaces loaded every visible vector into Node
// on every question — linear in the corpus, and the one real ceiling the 2026-08 scaling
// research found, so it had to fall before the client's bulk corpus drop. Deliberately NO
// hnsw/ivfflat index yet: an exact scan is 100% recall and fast to tens of thousands of rows,
// while an HNSW index at this size adds the 0.8 iterative-scan tuning burden for nothing.
// Null until the embedding backfill reaches the chunk (or when the provider has no
// embeddings), in which case retrieval falls back to keyword ranking over the same chunks.
// Rows are replaced wholesale whenever the parent doc re-syncs, and the FK cascades a doc's
// removal.
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
    // 1024 is the qwen3 matryoshka cut both provider presets emit (embedding-client.ts); the
    // typed width means a wrong-sized vector is a constraint error at write time, not noise at
    // query time.
    embedding: vector('embedding', { dimensions: 1024 }),
    // Which model produced the vector above, and at what width. Without these a change of
    // ASSISTANT_EMBEDDING_MODEL — or of ASSISTANT_PROVIDER, which drags the embedding model along
    // with it — left queries embedded in the new space and every stored vector in the old one, with
    // nothing anywhere to detect it: both presets emit 1024 dimensions, the backfill queue only
    // claims rows whose embedding IS NULL, and cross-space cosine is simply noise. The result was a
    // corpus that answered "not in my documents" to everything with no error logged. Recording the
    // model makes the mismatch a query away, and lets a re-embed claim exactly the rows a swap
    // orphaned instead of nulling live vectors to find them. NULL means the row predates this
    // column, which for existing rows means the model named in migration 0011.
    embeddingModel: text('embedding_model'),
    embeddingDim: integer('embedding_dim'),
    // The chunk restated in the OTHER language (ADR-0025's language bridge): Hebrew for a Latin
    // chunk, English for a Hebrew one, generated once at index time. It is what lets a question
    // reach a document written in the language the asker did not use — see chunk-index.ts.
    gist: text('gist'),
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
// The ladder starts at its floor: normal is the default and the least a task can be, with two
// rungs above it (owner call 2026-08-21). 0018 added 'medium' and moved the rows that carried the
// old 'low' up to normal, but left the dead label in the type, where it sat as a 500 waiting for
// anything writing rows outside the app to set it — the response schema below has three values and
// Fastify serialises the whole board against it. 0035 rebuilt the type without it, so this list
// and the database now hold the same three.
export const taskPriorityEnum = pgEnum('task_priority', ['normal', 'medium', 'high'])

// A single unit of work on a location's board (CONTEXT: Task, #131 Slice A). location_id is a
// real FK -> locations and the scope boundary every ADR-0007 read/write is filtered by (a
// manager sees one location, an admin the chain); no onDelete, matching users — a Location with
// tasks is never dropped in v1. description is free text in the author's language and is never
// auto-translated, so it is a plain nullable column with no locale tag. completed_at is
// system-maintained (set when status becomes done, cleared when it leaves done; the write path
// lands in Slice C) and null until then. position is the shared per-location manual order the
// board opens to; the read-side priority sort is a per-viewer lens that never rewrites it, and
// drag that mutates it lands in Slice D.
// A project: the container the chain plans in, holding tasks from the SAME board the Tasks screen
// shows. There is deliberately no `status` and no `percent_done` column — both are DERIVED from
// the project's tasks on read, because a stored progress figure and a task list drift apart the
// first week somebody forgets to update one, and then neither can be trusted.
//
// icon and colour are plain text validated by the shared zod enums rather than pg enums: they are
// presentation choices that will gain members often, and every addition to a pg enum is a
// migration against a production database for something no query ever filters on.
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  // The branches the project runs at. EMPTY means it runs across the whole chain — the same
  // chain-wide case an admin account occupies — and there is no other way to say chain-wide.
  //
  // An array rather than a join table, for the reasons `roles` below is one: it is read on every
  // project row, written whole, and `= any(...)` is a single expression against a column already
  // in hand. What the array costs is the foreign key, so a deleted branch would otherwise leave an
  // id here pointing at nothing — and a one-branch project whose branch vanished would silently
  // widen to chain-wide. That is why locations/repository.ts refuses to delete a branch a project
  // names, alongside the staff and tasks it already refused for.
  locationIds: uuid('location_ids').array().notNull().default([]),
  name: text('name').notNull(),
  icon: text('icon').notNull(),
  colour: text('colour').notNull(),
  // Which roles the project is for — and, since the roles are a scope boundary rather than a
  // label, which roles can SEE it (projects/scope.ts). Never empty: a project nobody can open is
  // not a project, and the request schema enforces the minimum of one.
  //
  // A text array rather than a join table: the set is the chain's four roles, it is read on every
  // project row and written whole, and `= any(...)` in the predicate is one expression against a
  // column already in hand. A join table would buy normalisation nothing here needs and cost a
  // second query on every list.
  roles: text('roles').array().notNull().default(['manager']),
  startDate: timestamp('start_date', { withTimezone: true }),
  targetDate: timestamp('target_date', { withTimezone: true }),
  // Where the work has got to. Validated against the shared zod enum rather than a pg enum, for
  // the same reason icon and colour are: the set will gain members, and every addition to a pg
  // enum is a migration against production. `completed` is maintained by the app whenever the
  // checklist crosses (or leaves) fully-ticked.
  phase: text('phase').notNull().default('planning'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// A line of work inside a project: a title, a tick, a position, and since 2026-08-28 an owner (see
// project_checklist_item_assignees below). Still no due date and no priority — those three
// together are what make a board, and this is a checklist. The project's whole progress figure is
// these rows counted, which is why they cascade: a deleted project's checklist has nothing left
// to describe.
export const projectChecklistItems = pgTable(
  'project_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Every read of a project loads its checklist by project id, in position order.
  (table) => [index('project_checklist_items_project_id_idx').on(table.projectId)],
)

// Who owns each step of a project's checklist (owner call 2026-08-28). A mirror of
// task_checklist_item_assignees, and deliberately the same shape: the gesture is identical on both
// screens, and two tables modelling one idea differently is how a name on a line starts meaning
// different things depending which page you are on.
//
// A set, not a column: "brief the shift" is two people on an opening week and one after it.
//
// Membership is NOT what grants sight of the project — the project's own roles and branches do
// that, and the candidate set is derived from them (projects/candidates.ts), so a person can only
// ever be put on a step of a project they could already open. That is why there is no notification
// machinery here: there is no such thing as an assignment to somewhere you cannot go.
export const projectChecklistItemAssignees = pgTable(
  'project_checklist_item_assignees',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => projectChecklistItems.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.userId] }),
    // "Which steps are mine, and how many are still open" — the read behind the card's counter,
    // run once per project on every projects list. The composite PK serves the other direction.
    index('project_checklist_item_assignees_user_id_idx').on(table.userId),
  ],
)

// A task's checklist (owner call 2026-08-26). Same shape as a project's, and deliberately so: the
// gesture is identical, and two tables that model one idea differently is how a tick starts meaning
// different things on two screens. It is a separate table rather than a column on `tasks` because an
// item is a row somebody ticks, and a JSON array would make every tick a read-modify-write of the
// whole task.
export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    done: boolean('done').notNull().default(false),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Every read of a task loads its checklist by task id, in position order.
  (table) => [index('task_checklist_items_task_id_idx').on(table.taskId)],
)

// A stored deviation from the capability catalog's defaults (owner ask 2026-08-24: the
// Access page grows switches). Only overrides live here — a role/capability pair with no
// row behaves as `CAPABILITY_DEFAULTS` in @burgers/shared says, so an empty table IS the
// pre-switch app, and a capability added to the catalog needs no migration to exist.
//
// Both columns are text validated against the shared zod enums rather than pg enums, for
// the same reason projects.roles and projects.phase are: the sets will gain members, and
// every pg-enum addition is a production migration. super_admin rows are refused by the
// service, not the schema — the owner column is immutable law, not data.
export const roleCapabilities = pgTable(
  'role_capabilities',
  {
    role: text('role').notNull(),
    capability: text('capability').notNull(),
    allowed: boolean('allowed').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.role, table.capability] })],
)

// How far a role sees, per view (0028). Same storage contract as role_capabilities above: only
// the owner's deviations from VIEW_SCOPE_DEFAULTS, so an empty table is the role-derived
// behaviour the scope predicates had before they read a setting.
export const roleViewScopes = pgTable(
  'role_view_scopes',
  {
    role: text('role').notNull(),
    viewKey: text('view_key').notNull(),
    choice: text('choice').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.role, table.viewKey] })],
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // The branch this work belongs to — null only for a private task, which belongs to a person
    // instead (the tasks_location_or_personal_check constraint, 0027). Shared board rows are
    // still always placed.
    locationId: uuid('location_id').references(() => locations.id),
    // Who created the task (#258, PRD: identity carries "who created it") — the acting principal
    // at create time, written by the service, never client-supplied. NOT NULL: rows that predate
    // the column were backfilled to the seed admin in the migration (2026-08 owner decision — a
    // knowing attribution over a blank). No onDelete, matching users — a user is deactivated,
    // never dropped, so a creator name always resolves.
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    // A private task of the creator's own (owner call 2026-08-25). Every other account's board
    // read filters these out, the chain owner's included — the one place in the app where a
    // super_admin does not see a row (task-board/scope.ts). It stays on this table rather than a
    // separate one because it IS a task: same statuses, same board, same live channel.
    personal: boolean('personal').notNull().default(false),
    title: text('title').notNull(),
    description: text('description'),
    status: taskStatusEnum('status').notNull().default('not_started'),
    priority: taskPriorityEnum('priority').notNull().default('normal'),
    dueDate: timestamp('due_date', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    position: integer('position').notNull().default(0),
    // The project this task is filed under, or null for loose board work. `set null` on delete,
    // NOT cascade: a project is a way of GROUPING work, and deleting the grouping must never
    // delete the chain's actual work — the tasks return to the board unfiled.
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Every project read filters the board by this column, so it is indexed. Without it a project
  // detail is a sequential scan of the chain's whole task table. The second index serves the
  // private board, whose only question is "the rows I wrote", and carries nothing else.
  (table) => [
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_personal_creator_idx').on(table.createdBy).where(sql`${table.personal}`),
  ],
)

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

// Who owns each step of a task's checklist (2026-08-26). A set, not a column: "restock" is two
// people on a delivery day and one on a Tuesday. Membership here also puts the person on the TASK
// (task-write-service), so owning a step is never work somebody cannot see — an employee's board is
// the tasks assigned to them, and a step-only assignment would otherwise be invisible to its owner.
export const taskChecklistItemAssignees = pgTable(
  'task_checklist_item_assignees',
  {
    itemId: uuid('item_id')
      .notNull()
      .references(() => taskChecklistItems.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId, table.userId] }),
    index('task_checklist_item_assignees_user_id_idx').on(table.userId),
  ],
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

// Which native shell a registered device runs, carried because the two platforms want different
// payload envelopes from FCM (an Android channel id, an APNs aps block). Only the wrapper apps
// register — the browser SPA has no push in v1 — so there is no `web` member to leave unused.
export const pushPlatformEnum = pgEnum('push_platform', ['android', 'ios'])

// A phone that has agreed to receive push (#59 delivery side). One row per device, keyed by the
// FCM registration token itself rather than a surrogate id, because the token *is* the device's
// identity to the transport: re-registering the same phone rewrites the one row, and a phone that
// changes hands (a different user signs in on it) moves to the new owner instead of ringing for
// both. Cascade on the user, so deactivating and removing an account silences their phones with it.
//
// Nothing here is a secret of ours: a registration token only authorises *us* to send to that
// device, and only while the app stays installed. Rows are pruned two ways — the client deletes its
// own on sign-out, and the sender deletes any token the transport reports as no longer registered
// (an uninstall or a token rotation), so the table cannot silently fill with devices that will
// never ring again.
export const pushDevices = pgTable(
  'push_devices',
  {
    token: text('token').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: pushPlatformEnum('platform').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Every send starts from "the devices of these users", so the user side of the lookup is the
  // one that needs an index; the token side is the primary key already.
  (table) => [index('push_devices_user_id_idx').on(table.userId)],
)

// --- The WhatsApp daily group digest (ADR-0026) ---
//
// Declared here because this repo has ONE migration pipeline: deploy.yml applies apps/api's
// committed drizzle migrations against Supabase before any container starts, so a table that lives
// anywhere else would have no way to reach production. The digest app itself does NOT import these
// declarations — it is a separate workspace and reaches the same database over plain parameterised
// SQL (ADR-0026's no-vendor-SDK posture). These tables and that SQL are kept in step by hand, which
// is the cost of the two staying decoupled.
//
// It reverses ADR-0026's "no database" decision, which held while the digest was one stateless
// completion: fetch, summarize, send, remember nothing. Two things changed. The summary became five
// model calls per run instead of one, so a failed send now throws away five calls' worth of work
// and a re-run pays for all five again. And a summary nobody kept is a summary nobody can check —
// there was no way to hold a suspicious merge up against what the branches actually said.

// The chat directory: what a Green API chatId is actually called, and which branch it belongs to.
// A journal row carries no chat name, and getChats can answer short, so a name learned once is
// better than a name fetched every run. branchId is nullable because the digest is useful before
// anyone has mapped a group onto a Location, and because the linked account sits in groups that are
// not branches at all.
export const whatsappChats = pgTable('whatsapp_chats', {
  // The Green API chat id, e.g. 120363422645974630@g.us. Natural key: it is what every other table
  // and every journal row refers to, and it is stable in a way a group's name is not.
  chatId: text('chat_id').primaryKey(),
  name: text('name').notNull(),
  branchId: uuid('branch_id').references(() => locations.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// One row per WhatsApp message. Deliberately flat: five groups on a busy day are hundreds of rows
// with chat_id repeating, never five rows, because a group's day is a set of messages each with its
// own sender and time.
export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    // Green API's own idMessage, and the reason the ingest is safe to overlap. Consecutive runs
    // re-fetch the same messages on purpose (the window is wider than the interval, so a gap cannot
    // open); this key is what makes the duplicates collapse instead of accumulating.
    idMessage: text('id_message').primaryKey(),
    chatId: text('chat_id').notNull(),
    // Who wrote it, which in a group is never the same question as which chat it landed in.
    // Nullable: an outgoing journal row has no sender, because the sender is the instance itself.
    senderId: text('sender_id'),
    // The WhatsApp profile name, kept ALONGSIDE senderId rather than instead of it: a display name
    // is whatever its owner set it to this week, while the id is stable and is what a users row
    // could eventually be joined on.
    senderName: text('sender_name'),
    // textMessage, imageMessage, and so on. Without it a null body is ambiguous between "empty" and
    // "a photo", and the digest would silently drop every photo-only message.
    typeMessage: text('type_message').notNull(),
    textMessage: text('text_message'),
    // A photo's caption and a document's filename. The transcript renders "[קובץ: menu.pdf]" from
    // these, so dropping them turns every file in the digest into an anonymous placeholder.
    caption: text('caption'),
    fileName: text('file_name'),
    direction: text('direction').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Every read is "this chat, this day": the per-branch summary, the digest window, the purge.
  (table) => [index('whatsapp_messages_chat_id_sent_at_idx').on(table.chatId, table.sentAt)],
)

// One row per branch per day: the stage 1 output, kept so stage 2 can be retried without paying for
// stage 1 again, and so a summary can still be read long after the messages behind it are purged.
export const whatsappSummaries = pgTable(
  'whatsapp_summaries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chatId: text('chat_id').notNull(),
    // Denormalised on purpose: the name the summary was WRITTEN under. A group renamed in March
    // must not silently retitle February's summaries.
    chatName: text('chat_name').notNull(),
    summaryDate: text('summary_date').notNull(),
    summary: text('summary').notNull(),
    messageCount: integer('message_count').notNull(),
    // Which model wrote it. The one thing you want when comparing quality across a model swap, and
    // impossible to reconstruct afterwards.
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // The same trick as id_message, one level up: re-running a day upserts its summaries rather than
  // stacking a second set that stage 2 would then read twice.
  (table) => [uniqueIndex('whatsapp_summaries_chat_date_idx').on(table.chatId, table.summaryDate)],
)

// One row per day: the stage 2 merge and what happened to it. Written BEFORE the send is attempted,
// which is the point of the table — a refused send must not destroy five model calls, and sentAt
// being null is exactly the "built but not delivered" state a retry looks for.
export const whatsappDigests = pgTable(
  'whatsapp_digests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    digestDate: text('digest_date').notNull(),
    message: text('message').notNull(),
    groupCount: integer('group_count').notNull(),
    messageCount: integer('message_count').notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Null until the gateway accepts it. "Accepted", never "delivered": a 200 means the message
    // entered Green API's queue, where it may wait up to 24 hours.
    sentAt: timestamp('sent_at', { withTimezone: true }),
    // The gateway's id for the accepted message, so a delivery question has something to trace.
    idMessage: text('id_message'),
  },
  // One digest per day. A second run of the same day replaces its row instead of sending twice.
  (table) => [uniqueIndex('whatsapp_digests_date_idx').on(table.digestDate)],
)

// The digest's off switch (migration 0037). One row, one boolean, and the reason it lives in the
// database rather than in an env file: the two stages it gates are the paid model calls and the
// send, and stopping those by stopping the container does not survive a deploy. `compose up` brings
// a stopped container back. A row does not un-write itself.
//
// It ships false. Turning on spending is a decision somebody makes; it is not something a migration
// does on its way past.
export const whatsappDigestSettings = pgTable(
  'whatsapp_digest_settings',
  {
    id: boolean('id').primaryKey().default(true),
    enabled: boolean('enabled').notNull().default(false),
    // Why it is in the state it is in, printed back by the container when it declines to run.
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('whatsapp_digest_settings_singleton', sql`${table.id}`)],
)

// One row per assistant answer attempt (0038): the telemetry, audit, and drift record in a single
// insert. References and numbers only — the question and the answer live solely on the thread's
// messages (ADR-0011), reachable through thread_id/agent_message_id; this table must never carry
// content. user_id and the message ids are deliberately loose uuids, not FKs: an account deletion
// (the store-mandated /delete-account path) must neither be blocked by its telemetry nor silently
// erase it — role is denormalized here for exactly that reason.
export interface AnswerLogRetrieved {
  chunkId: string
  docId: string
  // The fused rank score and each arm's contribution, as retrieval reported them.
  score: number
  vectorScore: number | null
  keywordRank: number | null
}

export const assistantAnswerLog = pgTable(
  'assistant_answer_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull(),
    threadId: uuid('thread_id').notNull(),
    // The persisted agent turn this row describes; null when the attempt failed and nothing was
    // persisted (ADR-0003).
    agentMessageId: uuid('agent_message_id'),
    status: text('status', { enum: ['answered', 'unavailable'] }).notNull(),
    errorClass: text('error_class'),
    mode: text('mode', { enum: ['hybrid', 'keyword'] }).notNull(),
    model: text('model'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    latencyMs: integer('latency_ms').notNull(),
    llmMs: integer('llm_ms'),
    // Retrieval health per answer: a run of empty vector arms against a part-built index is the
    // fingerprint of a stalled backfill (see retrieval.ts), now queryable instead of a console line.
    vectorArmEmpty: boolean('vector_arm_empty').notNull(),
    unembeddedChunks: integer('unembedded_chunks').notNull(),
    retrieved: jsonb('retrieved').$type<AnswerLogRetrieved[]>().notNull(),
    sources: jsonb('sources').$type<MessageSource[]>().notNull(),
  },
  (table) => [index('assistant_answer_log_created_at_idx').on(table.createdAt)],
)
