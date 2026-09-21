import {
  type CapabilityKey,
  type LocationKind,
  type MessageSource,
  ROLE_TIER,
  type Role,
} from '@burgers/shared'
import type { Clock } from '../auth/clock.js'
import { type Principal, viewScope } from '../auth/principal.js'
import type { LocationRow, LocationScope } from '../locations/repository.js'
import type { CompanyWebsiteReader } from './company-website.js'
import type { EmbeddingClient } from './embedding-client.js'
import { type AssistantTaskView, renderTaskContext } from './grounding.js'
import { searchableWords } from './hebrew-text.js'
import type { KnowledgeRepository } from './repository.js'
import { ARM_LIMIT, type RetrievedGrounding, resolveQuery, retrieveGrounding } from './retrieval.js'
import { estimateTokens } from './token-budget.js'
import type { AssistantTool, ToolOutcome } from './tool-loop.js'
import type { WhatsappSummaryReader } from './whatsapp-summaries.js'

// The read-only tools the assistant may call (#381, ADR-0028), each a thin wrapper over a read
// that already exists and is already scoped: the document retrieval the answer path always ran,
// the caller's own task board, the branch directory, the projects, the people list, and the
// WhatsApp group summaries. Nothing here scopes anything itself — every tool passes the principal
// (or the scope derived from it exactly as the page's route does) to the same repository method
// the page reads through, so the assistant can never surface a row the person could not open in
// the app (ADR-0007). A page the role may not open makes its tool answer `out_of_scope`, never a
// narrowed list: the model is told the data is outside what this person can view and says so.
//
// The ports are the repositories' read methods, typed to the fields each tool renders, so the
// unit tests drive the tools with in-memory stubs and the server wires the real repositories.

export interface AssistantProjectView {
  id: string
  name: string
  phase: string
  targetDate: Date | null
  locations: { id: string; name: string }[]
  doneCount: number
  taskCount: number
}

export interface AssistantChecklistItemView {
  id: string
  title: string
  done: boolean
  assignees: { displayName: string }[]
}

export interface AssistantPersonView {
  displayName: string
  role: Role
  locationName: string | null
  // Whether that place is a branch or the head office (2026-09-21, ADR-0029): the office roles
  // hold the head office row now, and "at the מטה החברה branch" would place them in a
  // restaurant that does not exist. Null exactly when locationName is (the owner).
  locationKind: LocationKind | null
  email: string
  // Whether this account is a current colleague, someone who never accepted their invitation, or
  // someone who has left (#387). Without it the directory answered with leavers as if they still
  // worked here, which is how a shift manager ends up calling the wrong person.
  status: 'invited' | 'active' | 'deactivated'
}

// The scoped task read the assistant grounds on (#92, ADR-0007): deliberately the *same*
// principal-parametrized method the board read uses (TaskBoardRepository.listScopedTasks
// satisfies it structurally), never a bespoke or unscoped query "to get context for the LLM".
export interface TaskContextReader {
  listScopedTasks(principal: Principal): Promise<AssistantTaskView[]>
}

export interface AssistantToolPorts {
  knowledge: Pick<KnowledgeRepository, 'listGroundingChunks' | 'searchChunksByVector'>
  embeddings: EmbeddingClient
  tasks: TaskContextReader
  locations: { listLocations(scope: LocationScope): Promise<LocationRow[]> }
  projects: {
    list(principal: Principal): Promise<AssistantProjectView[]>
    listChecklist(projectId: string): Promise<AssistantChecklistItemView[]>
  }
  users: {
    listUsers(scope: {
      role: Role
      locationId: string | null
      view?: LocationScope['view']
    }): Promise<AssistantPersonView[]>
  }
  whatsapp: WhatsappSummaryReader
  // The company's public site, read live. Optional the way the web search is: a deploy with no
  // site configured must not advertise a tool that can only fail.
  website?: CompanyWebsiteReader
  access: { isAllowed(role: Role, key: CapabilityKey): Promise<boolean> }
  clock: Clock
}

export interface AssistantToolsInput {
  principal: Principal
  // The thread's earlier user turns, so a document search keeps the follow-up anchoring the
  // one-shot path had (resolveQuery).
  priorUserTurns: string[]
  ports: AssistantToolPorts
  // The language the question is written in, which the chips are titled in (2026-09-18): the
  // answer follows the question, and an English answer over a Hebrew chip read as two authors.
  // Absent, the account's preference decides, as it did before.
  language?: 'he' | 'en'
}

export interface AssistantTools {
  tools: AssistantTool[]
  // Every document retrieval this answer ran, in call order — what the answer log records, so a
  // question answered without a search logs none.
  retrievals(): RetrievedGrounding[]
  // The documents those retrievals surfaced, each once, in first-seen order: the set the model's
  // citations are resolved against. A title the search never returned cannot become a source.
  retrievedDocs(): RetrievedDoc[]
}

// One document a search returned, as the answer's chip will show it: the title the model cites,
// the file in Drive the chip opens, and when that file last changed (ISO 8601, or null for a
// document Drive gave no date).
export interface RetrievedDoc {
  id: string
  title: string
  url: string
  modifiedAt: string | null
}

// The same link the Knowledge tab opens a document with; nothing here mirrors a file's text.
const driveFileUrl = (driveFileId: string): string =>
  `https://drive.google.com/file/d/${driveFileId}/view`

// How much of a directory listing one tool result may spend. A branch list is short; a people
// list at chain scale is not, and the model is told to narrow with a query rather than paging.
const LISTING_TOKEN_BUDGET = 2_500

// The summaries window: a week by default, ten days at most because that is how long the worker
// keeps them.
const DEFAULT_SUMMARY_DAYS = 7
const MAX_SUMMARY_DAYS = 10

// Head-office roles read the WhatsApp summaries (owner decision 2026-09-15): the branch tier —
// the trio plus driver and field_ops — works at a branch and has no page beyond its own work,
// so the groups' chatter is for the roles that run the branches from the office. Asked of the
// tier, not of where the role sits: since 2026-09-20 every role holds a location, the head
// office included, so "holds no branch" no longer says who is office staff.
const readsWhatsappSummaries = (role: Role): boolean =>
  role === 'super_admin' || ROLE_TIER[role] !== 'branch'

const stringArg = (args: unknown, name: string): string | null => {
  if (typeof args !== 'object' || args === null) {
    return null
  }
  const value = (args as Record<string, unknown>)[name]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

const integerArg = (args: unknown, name: string): number | null => {
  if (typeof args !== 'object' || args === null) {
    return null
  }
  const value = (args as Record<string, unknown>)[name]
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

const outOfScope = (content: string): ToolOutcome => ({
  status: 'out_of_scope',
  content,
  sources: [],
})
const empty = (content: string): ToolOutcome => ({ status: 'empty', content, sources: [] })
const failed = (content: string): ToolOutcome => ({ status: 'failed', content, sources: [] })

// Keep as many leading lines as the budget allows and say how many were cut, so a listing is
// never passed off as complete when it is not.
const takeWithinBudget = (lines: string[], budget: number): string[] => {
  const kept: string[] = []
  let remaining = budget
  for (const line of lines) {
    const tokens = estimateTokens(line)
    if (tokens > remaining) {
      break
    }
    kept.push(line)
    remaining -= tokens
  }
  if (kept.length < lines.length) {
    kept.push(`(${lines.length - kept.length} more not shown; ask with a narrower query)`)
  }
  return kept
}

const isoDay = (date: Date): string => date.toISOString().slice(0, 10)

// Calendar arithmetic on 'YYYY-MM-DD' strings, done in UTC on purpose: the strings are already
// local days, and shifting them must not pick up a time zone twice.
const shiftDay = (day: string, days: number): string => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return isoDay(new Date(Date.UTC(year, month - 1, date + days)))
}

const jerusalemDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

// 'YYYY-MM-DD' in Israel — the day the summaries are keyed by (the worker stamps them in
// Jerusalem time too). en-CA's default date pattern is exactly the ISO order.
const jerusalemDay = (now: Date): string => jerusalemDayFormat.format(now)

const normalize = (text: string): string => text.toLowerCase().normalize('NFC')

export function createAssistantTools(input: AssistantToolsInput): AssistantTools {
  const { principal, priorUserTurns, ports } = input
  const retrievals: RetrievedGrounding[] = []
  const retrievedDocs = new Map<string, RetrievedDoc>()
  // The chip title in the person's own language, the same way the page they would otherwise
  // open is titled.
  const language = input.language ?? (principal.preferredLanguage === 'en' ? 'en' : 'he')
  const titleFor = (label: { en: string; he: string }): string =>
    language === 'en' ? label.en : label.he
  const appSource = (id: string, label: { en: string; he: string }): MessageSource => ({
    id,
    title: titleFor(label),
    type: 'app',
  })
  const pageAllowed = (key: CapabilityKey): Promise<boolean> =>
    ports.access.isAllowed(principal.role, key)

  const searchDocuments: AssistantTool = {
    definition: {
      kind: 'function',
      name: 'search_documents',
      description:
        "Search Burger's Bar's knowledge base: the procedures, checklists, recipes, forms and" +
        ' policies the company keeps in its documents. Returns the best-matching excerpts under' +
        ' their document titles. Search in the language the documents are likely written in' +
        ' (mostly Hebrew) and again with other words when a first search misses.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'What to look for, as a short question or a few key words.',
          },
        },
        required: ['query'],
      },
    },
    label: { en: 'Knowledge base', he: 'מאגר הידע' },
    run: async (args) => {
      const query = stringArg(args, 'query')
      if (!query) {
        return failed('a query is required')
      }
      // The read is parametrized by the caller's role AND the horizon the owner set for it
      // (knowledge.view), so the corpus an answer can be built from is already cut to what this
      // person may read: lease terms never enter the ranking for an employee at all.
      const scope = { role: principal.role, view: viewScope(principal, 'knowledge.view') }
      const chunks = await ports.knowledge.listGroundingChunks(scope)
      const { question, texts } = resolveQuery(query, priorUserTurns)
      const embedded = await ports.embeddings.embed(texts)
      if (!embedded.ok) {
        // Only the error class, never the query (ADR-0011). A sustained embedding outage runs
        // retrieval in its measured-weaker keyword mode; this line is the one signal of it.
        console.error(`assistant retrieval: embedding unavailable, keyword only: ${embedded.error}`)
      }
      const vectorRankings = await Promise.all(
        (embedded.ok ? embedded.vectors : []).map((vector) =>
          ports.knowledge.searchChunksByVector(scope, vector, ARM_LIMIT),
        ),
      )
      const retrieval = retrieveGrounding(chunks, question, vectorRankings)
      retrievals.push(retrieval)
      if (retrieval.vectorArmEmpty && retrieval.unembeddedChunks > 0) {
        console.warn(
          `assistant retrieval: vector arm empty with ${retrieval.unembeddedChunks} unembedded chunk(s)`,
        )
      }
      const docs: RetrievedDoc[] = []
      for (const { docId, docTitle, docDriveFileId, docModifiedAt } of retrieval.selected) {
        if (!docs.some((doc) => doc.id === docId)) {
          docs.push({
            id: docId,
            title: docTitle,
            url: driveFileUrl(docDriveFileId),
            modifiedAt: docModifiedAt?.toISOString() ?? null,
          })
        }
      }
      for (const doc of docs) {
        if (!retrievedDocs.has(doc.id)) {
          retrievedDocs.set(doc.id, doc)
        }
      }
      if (docs.length === 0) {
        const corpusSize = new Set(chunks.map((chunk) => chunk.docId)).size
        return empty(
          `No excerpt matched "${query}" in the ${corpusSize} document(s) this person may read. Try other words or the other language before concluding the material does not cover it.`,
        )
      }
      return {
        status: 'ok',
        content: retrieval.block,
        sources: docs.map((doc) => ({ id: doc.id, title: doc.title, type: 'document' })),
      }
    },
  }

  const myTasks: AssistantTool = {
    definition: {
      kind: 'function',
      name: 'my_tasks',
      description:
        "The open tasks on this person's own task board: what is assigned to them, and for a" +
        ' manager or a head-office role the whole board they run. Each task carries its status,' +
        ' priority, due date and assignees.',
      parameters: { type: 'object', properties: {} },
    },
    label: { en: 'My tasks', he: 'המשימות שלי' },
    run: async () => {
      const block = renderTaskContext(await ports.tasks.listScopedTasks(principal))
      if (block.length === 0) {
        return empty('No open task is assigned to or visible to this person.')
      }
      return { status: 'ok', content: block, sources: [appSource('app:tasks', myTasks.label)] }
    },
  }

  const branchDirectory: AssistantTool = {
    definition: {
      kind: 'function',
      name: 'branch_directory',
      description:
        "Burger's Bar's branches as the app's Locations page lists them for this person: branch" +
        ' number, name, city, street address and phone, with the count. The head office (the' +
        " company's own office, not a restaurant) is listed apart and is never one of the" +
        ' branches. Use it for how many branches there are, where a branch is, or how to reach a' +
        ' branch or the head office.',
      parameters: { type: 'object', properties: {} },
    },
    label: { en: 'Branches', he: 'סניפים' },
    run: async () => {
      if (!(await pageAllowed('page.locations'))) {
        return outOfScope('This person cannot open the Locations page in the app.')
      }
      const rows = await ports.locations.listLocations({
        role: principal.role,
        locationId: principal.locationId,
        view: viewScope(principal, 'locations.view'),
      })
      // The read keeps the head office row, marked (2026-09-21, ADR-0029); the count is of the
      // branches alone, and the office gets its own line, because "48 branches" is exactly the
      // inexact answer the owner said he was worried about.
      const branches = rows.filter((row) => row.kind === 'branch')
      const headOffice = rows.find((row) => row.kind === 'headquarters')
      if (branches.length === 0 && !headOffice) {
        return empty('No branch is visible to this person.')
      }
      const describe = (row: LocationRow): string => {
        const details = [row.city, row.address, row.phone ? `phone ${row.phone}` : null]
          .filter((part): part is string => Boolean(part))
          .join(', ')
        return `${row.name}${details.length > 0 ? ` (${details})` : ''}`
      }
      const lines = branches.map((row) => {
        const number = row.number === null ? '' : `#${row.number} `
        return `- ${number}${describe(row)}`
      })
      return {
        status: 'ok',
        content: [
          branches.length > 0
            ? `${branches.length} branch(es) visible to this person:`
            : 'No branch is visible to this person.',
          ...lines,
          ...(headOffice ? [`Head office (not a branch): ${describe(headOffice)}`] : []),
        ].join('\n'),
        sources: [appSource('app:branches', branchDirectory.label)],
      }
    },
  }

  const projects: AssistantTool = {
    definition: {
      kind: 'function',
      name: 'projects',
      description:
        "The projects this person can see in the app's Projects page (a branch opening, a" +
        ' renovation, a campaign): name, phase, the branches involved, progress as steps done' +
        ' out of total, and the target date. Name a project in the query to also get its' +
        ' checklist steps with their owners.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A project name or a word from it, to get that project’s steps.',
          },
        },
      },
    },
    label: { en: 'Projects', he: 'פרויקטים' },
    run: async (args) => {
      if (!(await pageAllowed('page.projects'))) {
        return outOfScope('This person cannot open the Projects page in the app.')
      }
      const rows = await ports.projects.list(principal)
      if (rows.length === 0) {
        return empty('No project is visible to this person.')
      }
      const lines = rows.map((project) => {
        const branches =
          project.locations.length > 0
            ? project.locations.map((location) => location.name).join(', ')
            : 'chain-wide'
        const target = project.targetDate ? isoDay(project.targetDate) : 'no target date'
        return `- ${project.name} (phase: ${project.phase}, branches: ${branches}, progress: ${project.doneCount}/${project.taskCount} steps done, target: ${target})`
      })
      const query = stringArg(args, 'query')
      const named = query ? matchProjects(rows, query) : []
      const checklists = await Promise.all(
        named.map(async (project) => {
          const items = await ports.projects.listChecklist(project.id)
          const steps = items.map((item) => {
            const owners =
              item.assignees.length > 0
                ? ` (owner: ${item.assignees.map((owner) => owner.displayName).join(', ')})`
                : ''
            return `  - [${item.done ? 'done' : 'open'}] ${item.title}${owners}`
          })
          return [`Steps of ${project.name}:`, ...steps].join('\n')
        }),
      )
      return {
        status: 'ok',
        content: [
          `${rows.length} project(s) visible to this person:`,
          ...takeWithinBudget(lines, LISTING_TOKEN_BUDGET),
          ...checklists,
        ].join('\n'),
        sources: [appSource('app:projects', projects.label)],
      }
    },
  }

  const peopleDirectory: AssistantTool = {
    // People's names and branches: once these have been read, the broker's web search is not
    // offered again for this answer (tool-loop.ts).
    personalData: true,
    definition: {
      kind: 'function',
      name: 'people_directory',
      description:
        "The staff this person can see in the app's People page: name, role and where they sit" +
        ' (a branch, or the head office), and a colleague who has left or never accepted their' +
        ' invitation is marked as such. Use it for who works where or who holds a role. Narrow' +
        ' with a query (a name, a role, a branch, or the head office) rather than reading the' +
        ' whole chain. It does not hold private details: no pay, no home address, no phone.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description:
              'A name, a role, a branch or the head office to filter by; omit for everyone visible.',
          },
          contact: {
            type: 'boolean',
            description:
              'Set true only when the person asked how to reach a colleague; it adds work' +
              ' email addresses to the result.',
          },
        },
      },
    },
    label: { en: 'People', he: 'אנשים' },
    run: async (args) => {
      if (!(await pageAllowed('page.users'))) {
        return outOfScope('This person cannot open the People page in the app.')
      }
      const rows = await ports.users.listUsers({
        role: principal.role,
        locationId: principal.locationId,
        view: viewScope(principal, 'users.view'),
      })
      const query = stringArg(args, 'query')
      const wanted = query ? searchableWords(query) : []
      // Where a person sits, as the model reads it (2026-09-21, ADR-0029): the head office is
      // named as such in both languages, so "who is at the head office" and "מי במשרד הראשי"
      // both land on it, and an office person is never placed in a restaurant. Only the owner
      // holds no place at all.
      const place = (person: AssistantPersonView): string =>
        person.locationKind === 'headquarters'
          ? `${person.locationName}, head office`
          : (person.locationName ?? 'chain-wide')
      const placeWords = (person: AssistantPersonView): string =>
        person.locationKind === 'headquarters'
          ? `${person.locationName} head office משרד ראשי מטה`
          : (person.locationName ?? '')
      // Every word of the query has to land somewhere in the row, each word in either its typed
      // form or its prefix-stripped one, so "בתלפיות" finds the Talpiot branch and a two-word
      // name still narrows rather than widens.
      const matched =
        wanted.length > 0
          ? rows.filter((person) => {
              const haystack = searchableWords(
                `${person.displayName} ${person.role} ${placeWords(person)} ${person.email}`,
              )
              return wanted.every((word) =>
                haystack.some((candidate) => candidate.includes(word) || word.includes(candidate)),
              )
            })
          : rows
      if (matched.length === 0) {
        return empty(
          query
            ? `No person matching "${query}" among the ${rows.length} this person can see.`
            : 'No person is visible to this person.',
        )
      }
      // The work email is data minimisation's first casualty if it rides on every row, so it is
      // added only when the asker wanted contact details.
      const withContact =
        args !== null &&
        typeof args === 'object' &&
        (args as Record<string, unknown>).contact === true
      const standing = (person: AssistantPersonView): string =>
        person.status === 'deactivated'
          ? ' — no longer works here'
          : person.status === 'invited'
            ? ' — invited, has not accepted yet'
            : ''
      const lines = matched.map(
        (person) =>
          `- ${person.displayName} (${person.role}, ${place(person)}${withContact ? `, ${person.email}` : ''})${standing(person)}`,
      )
      return {
        status: 'ok',
        content: [
          `${matched.length} person(s)${query ? ` matching "${query}"` : ''}:`,
          ...takeWithinBudget(lines, LISTING_TOKEN_BUDGET),
        ].join('\n'),
        sources: [appSource('app:people', peopleDirectory.label)],
      }
    },
  }

  const whatsappSummaries: AssistantTool = {
    personalData: true,
    definition: {
      kind: 'function',
      name: 'whatsapp_summaries',
      description:
        "The daily summaries of a branch's WhatsApp group chatter, written each morning for the" +
        ' previous day: what happened in the group, with the message count. Head-office roles' +
        ' only. Give the branch word from the group name (for example תלפיות) and, optionally,' +
        ' how many days back to read (up to ten, the retention).',
      parameters: {
        type: 'object',
        properties: {
          group: {
            type: 'string',
            description: 'The branch or group name, or a distinctive word from it.',
          },
          days: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_SUMMARY_DAYS,
            description: `How many days back, ending today. Default ${DEFAULT_SUMMARY_DAYS}.`,
          },
        },
        required: ['group'],
      },
    },
    label: { en: 'WhatsApp summaries', he: 'סיכומי וואטסאפ' },
    run: async (args) => {
      if (!readsWhatsappSummaries(principal.role)) {
        return outOfScope('WhatsApp group summaries are available to head-office roles only.')
      }
      const group = stringArg(args, 'group')
      if (!group) {
        return failed('a group name is required')
      }
      const days = Math.min(
        MAX_SUMMARY_DAYS,
        Math.max(1, integerArg(args, 'days') ?? DEFAULT_SUMMARY_DAYS),
      )
      const to = jerusalemDay(ports.clock.now())
      const from = shiftDay(to, -(days - 1))
      const rows = await ports.whatsapp.listSummaries({ nameContains: group, from, to })
      if (rows.length === 0) {
        return empty(
          `No summary for a group whose name contains "${group}" between ${from} and ${to}. A summary exists only for a day the group had messages, and is kept for ten days.`,
        )
      }
      const lines = rows.map(
        (row) =>
          `- ${row.summaryDate}, ${row.chatName} (${row.messageCount} messages):\n  ${row.summary}`,
      )
      return {
        status: 'ok',
        content: [
          `${rows.length} daily summary(ies) for "${group}", ${from} to ${to}:`,
          ...takeWithinBudget(lines, LISTING_TOKEN_BUDGET),
        ].join('\n'),
        sources: [appSource('app:whatsapp', whatsappSummaries.label)],
      }
    },
  }

  // The public site, read at question time (2026-09-17). No permission gate: everything on it
  // is what any customer can already see, which is also why it is not personal data and does not
  // switch the web search off the way the people and WhatsApp tools do.
  const website = ports.website
  const companyWebsite: AssistantTool | null = website
    ? {
        definition: {
          kind: 'function',
          name: 'company_website',
          description:
            "Burger's Bar's public website, read live. For one branch: its opening hours by day," +
            ' the Saturday-night rule, the kashrut certificate and who grants it, accessibility.' +
            ' Also the menu item names, and the public pages: events and catering, the customer' +
            ' club terms, the service charter, careers, contact. Use it for a public fact about' +
            ' the chain that the documents and the app do not hold. Name ONE branch, item or' +
            ' page in the query; it cannot compare every branch at once. To count or list every' +
            ' branch or every menu item the site has, pass `list` instead of a query.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  'A branch name, a menu item, or a page topic, in the language it is written in on the site (Hebrew).',
              },
              list: {
                type: 'string',
                enum: ['branches', 'menu'],
                description:
                  'Instead of a query: every branch the site lists, or every menu item, with the count.',
              },
            },
          },
        },
        label: {
          en: "Burger's Bar website",
          he: '\u05d0\u05ea\u05e8 \u05d1\u05d5\u05e8\u05d2\u05e8\u05e1 \u05d1\u05e8',
        },
        run: async (args) => {
          const listed = stringArg(args, 'list')
          if (listed === 'branches' || listed === 'menu') {
            const kind = listed === 'branches' ? 'branch' : 'product'
            const result = await website.list(kind)
            if (result.status === 'failed') {
              return failed(
                'The company website could not be reached just now. Say so; do not guess what it lists.',
              )
            }
            const label =
              kind === 'branch'
                ? {
                    en: 'Branches on the website',
                    he: '\u05e1\u05e0\u05d9\u05e4\u05d9\u05dd \u05d1\u05d0\u05ea\u05e8',
                  }
                : {
                    en: 'Menu on the website',
                    he: '\u05d4\u05ea\u05e4\u05e8\u05d9\u05d8 \u05d1\u05d0\u05ea\u05e8',
                  }
            const noun = kind === 'branch' ? 'branches' : 'items'
            return {
              status: 'ok',
              content: `The website (${result.url}) lists ${result.titles.length} ${noun}: ${result.titles.join(', ')}.`,
              sources: [
                {
                  id: result.url,
                  title: titleFor(label),
                  type: 'website' as const,
                  url: result.url,
                },
              ],
            }
          }
          const query = stringArg(args, 'query')
          if (!query) {
            return failed(
              'company_website needs a query (a branch name, a menu item or a page) or a list.',
            )
          }
          const result = await website.lookup(query)
          if (result.status === 'failed') {
            return failed(
              'The company website could not be reached just now. Say so; do not guess what the page says.',
            )
          }
          if (result.status === 'empty') {
            return empty(
              [
                `Nothing on the company website matched "${query}".`,
                `Branches it lists: ${result.known.branches.join(', ')}.`,
                result.known.pages.length > 0 ? `Pages: ${result.known.pages.join(', ')}.` : '',
                `Menu items (${result.known.products.length}, names only, no description or price): ${result.known.products.join(', ')}.`,
              ]
                .filter((line) => line.length > 0)
                .join('\n'),
            )
          }
          if (result.status === 'menu') {
            return {
              status: 'ok',
              content: [
                `On the menu, matching "${query}": ${result.matched.map((entry) => entry.title).join(', ')}.`,
                `The website lists item names only, with no description or price. All ${result.all.length} items: ${result.all.join(', ')}.`,
              ].join('\n'),
              // The item's own page is the one honest link a menu answer has; a broad match
              // ("burger") would otherwise bury the answer under a row of chips.
              sources: result.matched.slice(0, 3).map((entry) => ({
                id: entry.url,
                title: entry.title,
                type: 'website' as const,
                url: entry.url,
              })),
            }
          }
          return {
            status: 'ok',
            content: result.pages
              .map((page) => `## ${page.entry.title} (${page.entry.url})\n${page.text}`)
              .join('\n\n'),
            sources: result.pages.map((page) => ({
              id: page.entry.url,
              title: page.entry.title,
              type: 'website' as const,
              url: page.entry.url,
            })),
          }
        },
      }
    : null

  return {
    tools: [
      searchDocuments,
      myTasks,
      branchDirectory,
      projects,
      peopleDirectory,
      whatsappSummaries,
      ...(companyWebsite ? [companyWebsite] : []),
    ],
    retrievals: () => [...retrievals],
    retrievedDocs: () => [...retrievedDocs.values()],
  }
}

// The projects a query names: the whole query as a substring of the name first, then any word
// of it, capped so a common word ("סניף", branch) cannot pull in every opening project's
// checklist at once.
const MAX_NAMED_PROJECTS = 3

function matchProjects<T extends { name: string }>(rows: T[], query: string): T[] {
  const needle = normalize(query)
  const whole = rows.filter((project) => normalize(project.name).includes(needle))
  if (whole.length > 0) {
    return whole.slice(0, MAX_NAMED_PROJECTS)
  }
  const words = needle.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length > 2)
  return rows
    .filter((project) => words.some((word) => normalize(project.name).includes(word)))
    .slice(0, MAX_NAMED_PROJECTS)
}
