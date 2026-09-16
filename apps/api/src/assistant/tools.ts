import { type CapabilityKey, type MessageSource, type Role, holdsBranch } from '@burgers/shared'
import type { Clock } from '../auth/clock.js'
import { type Principal, viewScope } from '../auth/principal.js'
import type { LocationRow, LocationScope } from '../locations/repository.js'
import type { EmbeddingClient } from './embedding-client.js'
import { type AssistantTaskView, renderTaskContext } from './grounding.js'
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
  access: { isAllowed(role: Role, key: CapabilityKey): Promise<boolean> }
  clock: Clock
}

export interface AssistantToolsInput {
  principal: Principal
  // The thread's earlier user turns, so a document search keeps the follow-up anchoring the
  // one-shot path had (resolveQuery).
  priorUserTurns: string[]
  ports: AssistantToolPorts
}

export interface AssistantTools {
  tools: AssistantTool[]
  // Every document retrieval this answer ran, in call order — what the answer log records, so a
  // question answered without a search logs none.
  retrievals(): RetrievedGrounding[]
  // The documents those retrievals surfaced, each once, in first-seen order: the set the model's
  // citations are resolved against. A title the search never returned cannot become a source.
  retrievedDocs(): { id: string; title: string }[]
}

// How much of a directory listing one tool result may spend. A branch list is short; a people
// list at chain scale is not, and the model is told to narrow with a query rather than paging.
const LISTING_TOKEN_BUDGET = 2_500

// The summaries window: a week by default, ten days at most because that is how long the worker
// keeps them.
const DEFAULT_SUMMARY_DAYS = 7
const MAX_SUMMARY_DAYS = 10

// Head-office roles read the WhatsApp summaries (owner decision 2026-09-15): the branch trio holds
// a branch and driver/field_ops are desk roles with no page beyond their own work, so the groups'
// chatter is for the chain-wide roles that run the branches from the office.
const readsWhatsappSummaries = (role: Role): boolean =>
  !holdsBranch(role) && role !== 'driver' && role !== 'field_ops'

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

// Hebrew as people actually type it (#387). Niqqud and the bidi marks are invisible but change
// every comparison; the geresh and gershayim are typed as either the Hebrew punctuation or the
// ASCII quotes. Folding all of that away is what lets a typed name match a stored one.
const foldHebrew = (text: string): string =>
  normalize(text)
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[\u200E\u200F]/g, '')
    .replace(/[\u05F3\u2019]/g, "'")
    .replace(/[\u05F4\u201C\u201D]/g, '"')

// The one-letter prefixes a Hebrew noun wears (ה the, ו and, ב in, ל to, מ from, כ as, ש that).
// "בתלפיות" is "in Talpiot", and a raw substring match against the branch name "תלפיות" fails on
// that single letter, so both forms are indexed and both are searched for, the same fix the
// retrieval arm made for the corpus.
const HEBREW_PREFIXES = 'הובלמכש'
const wordForms = (word: string): string[] =>
  word.length >= 4 && HEBREW_PREFIXES.includes(word[0] as string) ? [word, word.slice(1)] : [word]

const searchableWords = (text: string): string[] =>
  foldHebrew(text)
    .split(/[^\p{L}\p{N}@.'"-]+/u)
    .filter((word) => word.length > 0)
    .flatMap(wordForms)

export function createAssistantTools(input: AssistantToolsInput): AssistantTools {
  const { principal, priorUserTurns, ports } = input
  const retrievals: RetrievedGrounding[] = []
  const retrievedDocs = new Map<string, { id: string; title: string }>()
  // The chip title in the person's own language, the same way the page they would otherwise
  // open is titled.
  const titleFor = (label: { en: string; he: string }): string =>
    principal.preferredLanguage === 'en' ? label.en : label.he
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
      const docs: { id: string; title: string }[] = []
      for (const { docId, docTitle } of retrieval.selected) {
        if (!docs.some((doc) => doc.id === docId)) {
          docs.push({ id: docId, title: docTitle })
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
        ' number, name, city, street address and phone, with the count. Use it for how many' +
        ' branches there are, where a branch is, or how to reach it.',
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
      if (rows.length === 0) {
        return empty('No branch is visible to this person.')
      }
      const lines = rows.map((row) => {
        const details = [row.city, row.address, row.phone ? `phone ${row.phone}` : null]
          .filter((part): part is string => Boolean(part))
          .join(', ')
        const number = row.number === null ? '' : `#${row.number} `
        return `- ${number}${row.name}${details.length > 0 ? ` (${details})` : ''}`
      })
      return {
        status: 'ok',
        content: [`${rows.length} branch(es) visible to this person:`, ...lines].join('\n'),
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
        "The staff this person can see in the app's People page: name, role and branch, and a" +
        ' colleague who has left or never accepted their invitation is marked as such. Use it for' +
        ' who works where or who holds a role. Narrow with a query (a name, a role, a branch)' +
        ' rather than reading the whole chain. It does not hold private details: no pay, no home' +
        ' address, no phone.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'A name, a role or a branch to filter by; omit for everyone visible.',
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
      // Every word of the query has to land somewhere in the row, each word in either its typed
      // form or its prefix-stripped one, so "בתלפיות" finds the Talpiot branch and a two-word
      // name still narrows rather than widens.
      const matched =
        wanted.length > 0
          ? rows.filter((person) => {
              const haystack = searchableWords(
                `${person.displayName} ${person.role} ${person.locationName ?? ''} ${person.email}`,
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
          `- ${person.displayName} (${person.role}, ${person.locationName ?? 'chain-wide'}${withContact ? `, ${person.email}` : ''})${standing(person)}`,
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

  return {
    tools: [
      searchDocuments,
      myTasks,
      branchDirectory,
      projects,
      peopleDirectory,
      whatsappSummaries,
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
