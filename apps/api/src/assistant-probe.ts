import { z } from 'zod'
import { createChunkIndexer } from './assistant/chunk-index.js'
import {
  createDisabledEmbeddingClient,
  createHttpEmbeddingClient,
  resolveEmbeddingConfig,
} from './assistant/embedding-client.js'
import {
  ANSWER_MAX_TOKENS,
  type AssistantTaskView,
  buildLlmMessages,
  extractSources,
  renderTaskContext,
} from './assistant/grounding.js'
import { createHttpLlmClient, resolveLlmConfig } from './assistant/llm-client.js'
import { createKnowledgeRepository } from './assistant/repository.js'
import {
  GROUNDING_TOKEN_BUDGET,
  type RetrievedGrounding,
  buildQueryTexts,
  retrieveGrounding,
} from './assistant/retrieval.js'
import type { MessageRow } from './assistant/thread-repository.js'
import { systemClock } from './auth/clock.js'
import { createDb } from './db/client.js'
import { loadRootEnv } from './load-env.js'

// The assistant answer-quality probe — the missing half of the assistant's test coverage.
//
// The API suite proves the answer path's PLUMBING (scoping, persistence, retry, source parsing)
// against an injected fake model that is scripted to be perfectly obedient, and it must stay that
// way: CI cannot depend on a paid provider or on a model's mood. But that leaves the thing staff
// actually judge — whether the answers are any good — measured only by hand-typed probes pasted
// into a PR body (#266, #267), which is how #266 shipped a regression #267 had to undo.
//
// This CLI closes that gap without putting a provider in CI. It runs the REAL retrieval index
// (chunks + embeddings, ADR-0025), the REAL guardrail prompt, and the REAL configured model over
// a fixed battery of questions, and reports for each one BOTH halves of the answer's quality:
//
//   - retrieval: which chunks won the grounding budget, which arm brought each one in (cosine
//     rank, keyword rank, or both), and the mode — the half no prompt wording can fix;
//   - the answer: what the live model said, which sources the trailer resolved to, how long it took.
//
// Run it before and after a prompt or retrieval change and the difference is measured rather than
// remembered. `--dry` skips the chat completions (query embeddings still run — micro-cents);
// indexing the corpus happens on first run through the same chunk indexer the sync uses.

const usage = `
Assistant answer-quality probe — real retrieval + real prompt + real model.

  npm -w apps/api run probe                     the whole battery, live model
  npm -w apps/api run probe -- --dry            retrieval only, no chat completions
  npm -w apps/api run probe -- --only=opening   probes whose id or question matches a substring
  npm -w apps/api run probe -- --md=report.md   also write a Markdown report (for a PR body)

Reads DATABASE_URL for the live knowledge cache and the ASSISTANT_* provider settings from .env,
so it probes exactly what the deployed answer path would send. It indexes (chunks + embeds) any
pending docs first — the same pass the server runs after every sync. It writes nothing else: no
thread, no message, no persisted turn.
`

// The probe CLI's own env edge (as seed.ts does): only what a probe needs, so the tool runs
// without the Drive credentials a full server boot demands. The provider fields mirror the API's
// schema, and resolveLlmConfig validates the selected provider's key exactly as it does at boot.
const probeEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  ASSISTANT_PROVIDER: z.enum(['openrouter', 'gemini', 'groq']).default('openrouter'),
  ASSISTANT_MODEL: z.string().optional(),
  ASSISTANT_EMBEDDING_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
})

// One probe: the question, and — in prose, for the reader of the report — what a good assistant
// would do with it. The expectation is deliberately NOT machine-asserted: this is a measuring
// instrument for a human judgement call, not a pass/fail gate, and a model's phrasing varies.
// `history` replays prior turns for the follow-up probes, where the question alone carries no
// content words and retrieval leans on the previous-turn query variant.
interface Probe {
  id: string
  expect: string
  question: string
  history?: { role: 'user' | 'agent'; content: string }[]
}

// The battery. Grouped by what it is measuring, bilingual throughout because the staff ask in
// Hebrew and the corpus is Hebrew, while the product's second language is English.
const BATTERY: Probe[] = [
  // --- small talk: the carve-out #267 settled on. Must stay warm, must not start reciting docs.
  {
    id: 'greeting-en',
    expect:
      'one warm sentence back, plus an offer to help — weak chunks may ride along (no gate,' +
      ' by measurement) and the model must still just greet',
    question: 'hey, how are you?',
  },
  {
    id: 'greeting-he',
    expect: 'a warm Hebrew greeting back, answered in Hebrew — must not recite any chunk',
    question: 'בוקר טוב, מה נשמע?',
  },

  // --- covered procedures: the corpus genuinely holds these, so a decline here is a retrieval
  // failure, not a policy one. These are the probes that separate "the bot is dumb" from
  // "the bot never got the right document".
  {
    id: 'opening-checklist-he',
    expect: 'the branch-opening checklist, step by step, from צק ליסט פתיחת סניף',
    question: 'מה צריך לעשות בפתיחת סניף?',
  },
  {
    id: 'opening-checklist-en',
    expect:
      'the same checklist, answered in English — the doc is Hebrew, so this probes whether an ' +
      'English question can reach a Hebrew document (cross-lingual retrieval)',
    question: 'What is on the branch opening checklist?',
  },
  {
    id: 'secretary-duties-he',
    expect: 'the office secretary/purchasing responsibilities from תחומי אחריות מזכירת משרד ורכש',
    question: 'מה תחומי האחריות של מזכירת המשרד?',
  },
  {
    id: 'bread-order-he',
    expect:
      'the bread-orders sheet holds order data, not a how-to: a smart answer names what the ' +
      'sheet does show (quantities, days, per branch) and says the ordering procedure itself is ' +
      'not written — not a bare decline',
    question: 'איך מזמינים לחם לסניף?',
  },

  // --- follow-ups: the previous-turn query variant must keep retrieval on the topic.
  {
    id: 'followup-he',
    expect: 'continues the opening-checklist answer — must keep retrieving the SAME doc',
    question: 'ומה אחרי זה?',
    history: [
      { role: 'user', content: 'מה צריך לעשות בפתיחת סניף?' },
      {
        role: 'agent',
        content:
          'יש לבצע את הצעדים הראשונים ברשימת פתיחת הסניף: פתיחת המנעולים, הדלקת התאורה והמערכות.',
      },
    ],
  },

  // --- the scoped task block: the other grounding source, now with a date in the prompt.
  {
    id: 'my-tasks-he',
    expect: 'lists exactly the injected scoped tasks, nothing more',
    question: 'מה המשימות שלי?',
  },
  {
    id: 'tasks-due-today-en',
    expect: 'the prompt now states today is 2026-08-13 — must name the milkshake task as due today',
    question: 'What do I need to finish today?',
  },
  {
    id: 'tasks-priority-en',
    expect: 'reasons over the injected task list to name the most urgent one',
    question: 'Which of my tasks is the most urgent?',
  },

  // --- off-topic: must decline by naming its scope (#267), in the question's language,
  // WITHOUT the canned template sentence.
  {
    id: 'offtopic-capital-en',
    expect: 'declines in its own words, naming what it does cover — not a template line',
    question: 'What is the capital of France?',
  },
  {
    id: 'offtopic-recipe-he',
    expect: 'declines in Hebrew, in its own words',
    question: 'תן לי מתכון לפנקייק',
  },

  // --- chain facts the corpus does not hold: must decline rather than invent.
  {
    id: 'ungrounded-manager-he',
    expect: 'no invented name — the corpus holds no branch-manager roster',
    question: 'מי המנהל של סניף רמת גן?',
  },

  // --- the client's verbatim questions from the 2026-08-13 prod test session (the "bad bot"
  // verdict). Kept word-for-word — typos, slang, and all — as the regression set for real
  // traffic: the old retrieval declined the paraphrase and only answered the title-verbatim
  // phrasing, which is exactly how the bot read as dumb.
  {
    id: 'client-opening-he',
    expect:
      'DECLINED TWICE in prod (morphology: הפתיחה never token-matched פתיחת). Must answer from' +
      ' the branch-opening checklist. While English daily SOPs exist in the corpus the language' +
      ' bridge must surface them too (audit failure #1); after their 2026-08-13 Drive deletion' +
      ' the right close is the honest not-found phrasing — never "no such procedure exists"',
    question: 'מהו נוהל הפתיחה?',
  },
  {
    id: 'opening-daily-en',
    expect:
      'while English daily SOPs exist in the corpus: their at-open steps, not only the admin' +
      ' checklist (the audit caught the 8-chunk cap cutting the substantive SOP chunk at rank' +
      ' 11 — audit failure #2). With them deleted from Drive (2026-08-13): the checklist plus' +
      ' the honest not-found phrasing for the daily half',
    question: 'What is the opening procedure?',
  },
  {
    id: 'holon-lease-he',
    expect:
      'Holon: chain-signed, lease end 30.12.2030, option period 1.1.26-30.12.30 auto-renewing' +
      ' (lease dashboard + 2026 mapping xlsx) — must NOT claim option-period data is absent' +
      ' (audit failure #3)',
    question: 'מה תנאי השכירות של סניף חולון?',
  },
  {
    id: 'client-checklist-garbled-he',
    expect: 'the garbled phrasing that DID work in prod — must keep answering the checklist',
    question: 'מההרשימה של הצק ליסט ברגע שנפתח סניף',
  },
  {
    id: 'client-help-typos-he',
    expect:
      'typo-laden "what can you help with" — got a canned one-liner in prod; should now be a' +
      ' warm, concrete answer naming procedures + tasks',
    question: 'במהה אתה יכול לעזור ליח ?',
  },
  {
    id: 'client-payroll-he',
    expect: 'slang follow-up asking to learn payroll — answered well in prod, must keep working',
    question: 'וואלה תן לי משהו ללמוד אני עובד שכיר ומנהל שכר',
    history: [
      { role: 'user', content: 'היי מה המצב יגבר' },
      { role: 'agent', content: 'אהלן, הכל טוב! אשמח לעזור לך עם נהלי הרשת או המשימות שלך.' },
    ],
  },

  // --- the 2026-08-13 graded exam's one false decline, kept verbatim as the hybrid-retrieval
  // regression. The rule it asks for is written in the branch-OPENING checklist ("הכנסת תזכורות
  // ליומן לתאריכי סיום הסכם- 3 חודשים לפני סיום, חודשיים לפני וחודש לפני") while every word of
  // the question's vocabulary points at the lease dashboards, so the vector arm alone filled the
  // grounding with rentals data and the model honestly reported not finding the rule. The keyword
  // arm exists for exactly this shape of question: ליומן appears in that one document and nowhere
  // else in the corpus.
  {
    id: 'lease-reminders-he',
    expect:
      'three diary reminders before a lease-end date — 3 months, 2 months and 1 month before —' +
      ' cited to צק ליסט פתיחת סניף. A decline here is the graded exam’s failure reproduced',
    question: 'מתי מכניסים תזכורות ליומן על סיום חוזה שכירות?',
  },
  {
    id: 'lease-reminders-en',
    expect:
      'the SAME three reminders, in English. This is the 2026-08-13 flip test’s only failure:' +
      ' the keyword arm was lexical Hebrew, so an English question shared no characters with the' +
      ' checklist and only the vector arm ran — the arm that misses this question. It answers' +
      ' once the chunk carries an English gist for the keyword arm to match',
    question: 'When do we put reminders in the calendar before a lease agreement ends?',
  },

  // --- a question the rentals data DOES answer. Included deliberately: the lease corpus is
  // chain-wide and unscoped (ADR-0014, v1), so this shows exactly what any employee can extract
  // from it — the open "remove the rentals dashboard from the Drive folder, or accept it" call.
  {
    id: 'rent-lease-he',
    expect: 'answerable from the rentals docs — shows what lease data any employee can reach',
    question: 'מה תנאי השכירות של הסניפים?',
  },
]

// A small, realistic scoped task list standing in for one employee's board. Fixed, so a probe run
// is comparable to the run before it; the real per-principal read is exercised by the API suite.
const FIXTURE_TASKS: AssistantTaskView[] = [
  {
    title: 'ניקיון מכונת המילקשייק',
    status: 'not_started',
    priority: 'high',
    dueDate: new Date('2026-08-13'),
    assignees: [{ displayName: 'יוסי כהן' }],
  },
  {
    title: 'ספירת מלאי לחמניות',
    status: 'in_progress',
    priority: 'normal',
    dueDate: new Date('2026-08-15'),
    assignees: [{ displayName: 'יוסי כהן' }],
  },
  {
    title: 'החלפת מסנן השמן בטיגון',
    status: 'not_started',
    priority: 'low',
    dueDate: null,
    assignees: [{ displayName: 'יוסי כהן' }],
  },
]

// The prompt's date line, built the same way the answer service builds it — from the real clock,
// so "what's due today?" probes the actual deployed behaviour.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const formatToday = (now: Date): string =>
  `${WEEKDAYS[now.getUTCDay()]}, ${now.toISOString().slice(0, 10)}`

// Replay a probe's scripted history as the answer path would: the thread rows buildLlmMessages
// maps to wire roles. Only role and content are read, but the row shape is honoured so the probe
// travels the same code path the route does.
const asHistory = (probe: Probe): MessageRow[] =>
  (probe.history ?? []).map((turn, index) => ({
    id: `probe-${index}`,
    role: turn.role,
    content: turn.content,
    sources: null,
    createdAt: new Date(0),
  }))

const indent = (text: string, prefix = '     '): string =>
  text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')

// Which arm brought a chunk in — the half of a hybrid retrieval report that a single fused score
// cannot show, and the thing to read first when a probe's selection changes.
const provenanceOf = (selected: {
  vectorScore: number | null
  keywordRank: number | null
}): string =>
  [
    selected.vectorScore === null ? null : `cos ${selected.vectorScore.toFixed(3)}`,
    selected.keywordRank === null ? null : `kw #${selected.keywordRank}`,
  ]
    .filter((part) => part !== null)
    .join(' + ')

interface ProbeResult {
  probe: Probe
  mode: RetrievedGrounding['mode']
  selected: RetrievedGrounding['selected']
  answer: string | null
  error: string | null
  sources: string[]
  elapsedMs: number
}

async function main(): Promise<void> {
  loadRootEnv()

  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(usage)
    return
  }
  const dry = argv.includes('--dry')
  const only = argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length)
  const mdPath = argv.find((arg) => arg.startsWith('--md='))?.slice('--md='.length)

  const parsed = probeEnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Cannot probe — invalid environment:\n${issues}`)
  }
  const env = parsed.data

  const probes = only
    ? BATTERY.filter((probe) => probe.id.includes(only) || probe.question.includes(only))
    : BATTERY
  if (probes.length === 0) {
    throw new Error(`No probe matches --only=${only}`)
  }

  const { db, pool } = createDb(env.DATABASE_URL)
  const results: ProbeResult[] = []
  try {
    const knowledge = createKnowledgeRepository(db)

    // Index exactly as the server does after a sync: chunk pending docs, backfill embeddings —
    // including the language-bridge gists for Latin-dominant chunks, which need the LLM even on
    // --dry: they are part of indexing (a stored embedding), not of answering.
    const embeddingConfig = resolveEmbeddingConfig(env)
    const embeddings = embeddingConfig
      ? createHttpEmbeddingClient(embeddingConfig)
      : createDisabledEmbeddingClient()
    const bridgeLlm = embeddingConfig ? createHttpLlmClient(resolveLlmConfig(env)) : null
    const indexer = createChunkIndexer(knowledge, embeddings, systemClock, {
      onIndexError: (scope, error) => console.error(`index: ${scope}: ${error}`),
      ...(bridgeLlm ? { llm: bridgeLlm } : {}),
      ...(embeddingConfig ? { embeddingModel: embeddingConfig.model } : {}),
    })
    await indexer.ensureIndexed()

    const chunks = await knowledge.listGroundingChunks('admin')
    const docCount = new Set(chunks.map((chunk) => chunk.docId)).size
    const embeddedCount = chunks.filter((chunk) => chunk.embedding !== null).length

    const embedNote = embeddingConfig
      ? `(${embeddingConfig.model})`
      : '(embeddings disabled — keyword mode)'
    console.log(
      `\nindex:    ${docCount} docs → ${chunks.length} chunks, ${embeddedCount} embedded ${embedNote}`,
    )
    const config = dry ? null : resolveLlmConfig(env)
    console.log(
      dry
        ? 'model:    (dry run — retrieval only, no chat completions)'
        : `model:    ${config?.model} via ${env.ASSISTANT_PROVIDER} · temp 0.2 · answer cap ${ANSWER_MAX_TOKENS}`,
    )
    console.log(
      `today:    ${formatToday(new Date())} · role: employee · probes: ${probes.length}\n`,
    )

    const llm = config ? createHttpLlmClient(config) : null

    for (const probe of probes) {
      const history = asHistory(probe)
      const previousUserTurn = [...history].reverse().find((turn) => turn.role === 'user')?.content
      const queryTexts = buildQueryTexts(probe.question, previousUserTurn)
      const embedded = await embeddings.embed(queryTexts)
      const queryVectors = embedded.ok ? embedded.vectors : []
      const { mode, block, selected } = retrieveGrounding(chunks, probe.question, queryVectors)

      console.log(`── [${probe.id}] ${probe.question}`)
      console.log(indent(`expect: ${probe.expect}`))
      const groundingTokens = selected.reduce((sum, s) => sum + s.tokens, 0)
      console.log(
        indent(
          `retrieved (${mode}): ${selected.length} chunks, ~${groundingTokens} tokens ` +
            `(budget ${GROUNDING_TOKEN_BUDGET})`,
        ),
      )
      for (const s of selected) {
        console.log(
          indent(
            `• ${s.docTitle} #${s.chunkIndex} — ${s.tokens} tok, rrf ${s.score.toFixed(4)}` +
              ` [${provenanceOf(s)}]`,
            '       ',
          ),
        )
      }

      const result: ProbeResult = {
        probe,
        mode,
        selected,
        answer: null,
        error: null,
        sources: [],
        elapsedMs: 0,
      }

      if (llm) {
        const messages = buildLlmMessages(
          block,
          renderTaskContext(FIXTURE_TASKS),
          history,
          probe.question,
          {
            today: formatToday(new Date()),
            role: 'employee',
          },
        )
        const startedAt = Date.now()
        const completion = await llm.complete({ messages, maxTokens: ANSWER_MAX_TOKENS })
        result.elapsedMs = Date.now() - startedAt
        if (completion.ok) {
          const citable = new Map<string, { id: string; title: string }>()
          for (const chunk of chunks) {
            if (!citable.has(chunk.docId)) {
              citable.set(chunk.docId, { id: chunk.docId, title: chunk.docTitle })
            }
          }
          const { content, sources } = extractSources(completion.content, [...citable.values()])
          result.answer = content
          result.sources = sources.map((source) => source.title)
          console.log(indent(`answer (${result.elapsedMs} ms):`))
          console.log(indent(content, '       '))
          console.log(
            indent(`sources: ${result.sources.length > 0 ? result.sources.join(' | ') : '—'}`),
          )
        } else {
          result.error = completion.error
          console.log(indent(`FAILED (${result.elapsedMs} ms): ${completion.error}`))
        }
      }
      console.log('')
      results.push(result)
    }

    // Which docs actually got retrieved across the battery — the summary that shows whether
    // retrieval is choosing or defaulting.
    const hits = new Map<string, number>()
    for (const result of results) {
      for (const docTitle of new Set(result.selected.map((s) => s.docTitle))) {
        hits.set(docTitle, (hits.get(docTitle) ?? 0) + 1)
      }
    }
    const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1])
    console.log(`── retrieval frequency across ${results.length} probes`)
    for (const [title, count] of ranked) {
      console.log(indent(`${count}/${results.length}  ${title}`))
    }
    const zeroProbes = results.filter((result) => result.selected.length === 0).length
    console.log(indent(`${zeroProbes} probes retrieved nothing (greetings/off-topic should)`))

    if (!dry) {
      const failures = results.filter((result) => result.error).length
      const cited = results.filter((result) => result.sources.length > 0).length
      const avgMs = Math.round(
        results.reduce((sum, result) => sum + result.elapsedMs, 0) / results.length,
      )
      console.log(
        `\n── answers: ${results.length - failures} returned, ${failures} failed, ` +
          `${cited} cited a source, ${avgMs} ms average\n`,
      )
    }

    if (mdPath) {
      const { writeFile } = await import('node:fs/promises')
      await writeFile(mdPath, renderMarkdown(results, docCount, chunks.length, dry), 'utf-8')
      console.log(`report written to ${mdPath}\n`)
    }
  } finally {
    await pool.end()
  }
}

// The same run as a Markdown table — what a PR body needs, so a behaviour claim in a review can
// carry its evidence instead of a remembered impression.
function renderMarkdown(
  results: ProbeResult[],
  docCount: number,
  chunkCount: number,
  dry: boolean,
): string {
  const lines: string[] = [
    '# Assistant probe run',
    '',
    `Index: ${docCount} ingested docs → ${chunkCount} chunks, grounding budget ` +
      `${GROUNDING_TOKEN_BUDGET} tokens.`,
    '',
    '| Probe | Retrieved | Answer | Sources |',
    '| --- | --- | --- | --- |',
  ]
  // A cell's own text must not carry a bare `|` — an answer quoting a table row would otherwise
  // split the cell and bleed into the columns after it.
  const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
  for (const result of results) {
    const retrieved =
      result.selected
        .map((s) => `${cell(s.docTitle)} #${s.chunkIndex} (${provenanceOf(s)})`)
        .join('<br>') || '—'
    const answer = result.error
      ? `**FAILED** — ${result.error}`
      : dry
        ? '_(dry run)_'
        : cell(result.answer ?? '')
    lines.push(
      `| **${result.probe.id}** (${result.mode})<br>${cell(result.probe.question)} | ${retrieved} | ${answer} | ${
        cell(result.sources.join(' · ')) || '—'
      } |`,
    )
  }
  return `${lines.join('\n')}\n`
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
