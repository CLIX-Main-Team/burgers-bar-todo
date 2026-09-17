import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import type { Role } from '@burgers/shared'
import { z } from 'zod'
import { createAccessService } from './access/service.js'
import {
  createDisabledEmbeddingClient,
  createHttpEmbeddingClient,
  resolveEmbeddingConfig,
} from './assistant/embedding-client.js'
import { answerThroughLoop, evalPrincipal } from './assistant/eval-runner.js'
import {
  type EvalRoute,
  type Verdict,
  fabricatedWebSource,
  factCoverage,
  gateFailures,
  hebrewSurface,
  narratedSearch,
  promptFingerprint,
  routeHit,
  routesTaken,
  tally,
  toolScore,
  verdictFor,
} from './assistant/eval-scoring.js'
import { ANSWER_MAX_TOKENS, buildLlmMessages, extractSources } from './assistant/grounding.js'
import { createHttpLlmClient, resolveLlmConfig } from './assistant/llm-client.js'
import { createKnowledgeRepository } from './assistant/repository.js'
import {
  ARM_LIMIT,
  buildQueryTexts,
  resolveQuery,
  retrieveGrounding,
} from './assistant/retrieval.js'
import type { MessageRow } from './assistant/thread-repository.js'
import type { AssistantToolPorts } from './assistant/tools.js'
import { createWhatsappSummaryReader } from './assistant/whatsapp-summaries.js'
import { systemClock } from './auth/clock.js'
import { createAuthRepository } from './auth/repository.js'
import { createDb } from './db/client.js'
import { loadRootEnv } from './load-env.js'
import { createLocationRepository } from './locations/repository.js'
import { createProjectRepository } from './projects/repository.js'
import { createTaskBoardRepository } from './task-board/repository.js'

// The assistant's scored evaluation — the graded counterpart to the probe battery.
//
// `assistant-probe.ts` prints what the assistant retrieved and said, for a human to read. That is
// the right instrument for judging tone and for eyeballing one change, and every field round so
// far has been run that way: ask production, read 55 answers, decide by hand. It does not survive
// contact with a system that changes weekly. Nothing is comparable between rounds, one person's
// "partial" is another's "correct", and the runs cost real money every time, so they happen rarely
// and late.
//
// This harness scores instead of printing, against a golden set whose gold facts and source
// documents were established by reading the real corpus (eval/golden-set.json). It follows the
// standard two-stage shape: a retrieval metric and a generation metric, because they fail
// independently and the failure the field rounds kept hitting is invisible without the first one.
// A retriever that misses the right document still produces a fluent, faithful-looking answer off
// whatever it did retrieve, so a generation score alone stays high while the system quietly rots.
//
// Stage one (default) costs one query embedding per question — fractions of a cent for the whole
// set — and answers the question no prompt wording can: did the document that holds the answer
// reach the grounding block at all? It embeds the literal question as an admin, which is the
// retrieval function's own benchmark and deliberately not the product's routing.
//
// Stage two (--answers) drives the REAL assistant (#388): the live system prompt, the six scoped
// tools, the broker's web search, the bounded loop, under each item's own role. Until then it
// pasted a grounding block into the one-shot prompt the product retired on 2026-09-15, so it was
// scoring a code path nobody ran and could not see routing, tool choice, freshness or provenance
// at all (finding EO-2). What comes back is graded three ways — correct, incorrect, declined, with
// a wrong answer costing twice a decline — plus the free checks: the route taken, the tools called,
// a claimed lookup with an empty trace, a cited document that does not exist, and the Hebrew
// surface. A judge is never needed for any of that, which is the point: the owner grades the rest
// by hand from --json rather than paying a second model to have an opinion.
//
// Because stage one is free and reads the index without writing to it, the same run works against
// any checkout. Run it on two commits over one index and the difference between them is measured.

const usage = `
Assistant evaluation — scored against eval/golden-set.json.

  npm -w apps/api run eval                      retrieval only (one embedding per question)
  npm -w apps/api run eval -- --answers         drive the real assistant (about 2 cents a question)
  npm -w apps/api run eval -- --answers --judge and pay a second model to grade them (doubles it)
  npm -w apps/api run eval -- --answers --resume reuse answers already in --json, buy only the rest
  npm -w apps/api run eval -- --limit=10        first N of each set, for a smoke run
  npm -w apps/api run eval -- --lang=he         only the Hebrew half (or --lang=en)
  npm -w apps/api run eval -- --set=routing-set score a different file in eval/ (default golden-set)
  npm -w apps/api run eval -- --json=out.json   write the full per-question record

The sets in eval/:
  golden-set      facts and refusals against the real corpus
  golden-set-v2   the post-folder-swap corpus, with the transcription traps
  corpus-set      broad coverage over every ingested document
  followup-set    threads whose second turn carries no content words
  routing-set     WHERE an answer should come from, not what it says (38 items, 19 pairs)
  freshness-set   Israeli work facts that go stale; the web route is the pass condition (30 items)

With --answers the run exits non-zero when the gate fails: wrong answers above 2% of the
answerable set, abstention recall below 90% on the uncovered set, or over 10% of answerable
questions declined. Thresholds rather than perfection, because a 100% bar on a model-graded run
is flaky and a flaky gate gets switched off.

Reads DATABASE_URL and the ASSISTANT_* provider settings, exactly as the answer path does. It
never writes to the database: no indexing, no threads, no messages. That is deliberate, so the
same index can be scored from two different checkouts and the numbers compared.
`

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ASSISTANT_PROVIDER: z.enum(['openrouter', 'gemini', 'groq']).default('openrouter'),
  ASSISTANT_MODEL: z.string().optional(),
  ASSISTANT_EMBEDDING_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
})

// What every graded item may say about how it should be answered, not merely about what the answer
// should contain (#388). Until the harness drove the real loop none of this was expressible: there
// was one prompt, one role, no tools and no route to be right or wrong about.
interface Graded {
  // Who asks. The tools scope themselves from this, so it is what makes one question asked as two
  // people a meaningful test. Defaults to an employee at no branch, the narrowest caller.
  role?: Role
  locationId?: string | null
  locationName?: string | null
  // Where the answer should have come from: the documents, one named app tool, the web, the
  // model's own knowledge, or a refusal. Unset means the route is not being graded on this item.
  expectedRoute?: EvalRoute
  // The tools this question should have made it reach for, scored as a set.
  expectedTools?: string[]
  // For a fact that goes stale: when it was last confirmed, and when someone must confirm it
  // again. A freshness item whose recheckBy has passed is reported as unverifiable rather than
  // silently graded against a value that may no longer be true.
  validFrom?: string
  recheckBy?: string
}

interface Answerable extends Graded {
  id: string
  question: string
  lang: 'he' | 'en'
  pairId: string
  goldFacts: string[]
  sourceDocs: string[]
  crossTopic: boolean
}

interface Uncovered extends Graded {
  id: string
  question: string
  lang: 'he' | 'en'
  pairId: string
  whyAbsent: string
}

// A conversation, not a question. The single-turn sets above cannot see the failure the client
// actually reported: they ask one self-contained question, so retrieval always has content words
// to match on. A real thread does not look like that. Turn two is "תסביר" — explain — which
// carries no content words whatsoever, and the deployed bot answered it by claiming it could not
// find the procedure it had just quoted in turn one. That is what buildQueryTexts fuses the
// previous user turn for, and until this fixture existed nothing here exercised that path at all.
interface Chain {
  id: string
  intent: string
  safeBehaviour: string
  turns: string[]
}

// Fold a document title to its comparison key. Same intent as grounding.ts's titleKey — an exact
// title match that tolerates incidental drift — plus the quote folding a corpus of Word documents
// needs: a title typed with a straight apostrophe and one carrying Word's curly replacement are
// the same document, and treating them as different silently scores a hit as a miss.
const titleKey = (title: string): string =>
  title.replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase()

interface RetrievalScore {
  // Did any chunk of a gold document reach the grounding block? This is the operational metric:
  // the model is shown `selected` and nothing else, so a gold document ranked 40th and cut by the
  // budget is exactly as absent as one that never matched at all.
  hit: boolean
  // 1-based position of the first gold chunk within the block, for MRR. Null when there is none.
  firstGoldRank: number | null
  goldDocsFound: number
  goldDocsTotal: number
  chunksSelected: number
  // Share of the block spent on gold documents. Low precision is not a failure on its own (a
  // neighbouring procedure is often legitimate context) but a collapse in it is how one document's
  // row-group clones crowd out everything else — the rank-17 lease incident.
  precision: number
}

const scoreRetrieval = (selected: { docTitle: string }[], sourceDocs: string[]): RetrievalScore => {
  const gold = new Set(sourceDocs.map(titleKey))
  const found = new Set<string>()
  let firstGoldRank: number | null = null
  selected.forEach((chunk, index) => {
    const key = titleKey(chunk.docTitle)
    if (!gold.has(key)) return
    found.add(key)
    if (firstGoldRank === null) firstGoldRank = index + 1
  })
  const goldChunks = selected.filter((chunk) => gold.has(titleKey(chunk.docTitle))).length
  return {
    hit: found.size > 0,
    firstGoldRank,
    goldDocsFound: found.size,
    goldDocsTotal: gold.size,
    chunksSelected: selected.length,
    precision: selected.length === 0 ? 0 : goldChunks / selected.length,
  }
}

// The judge. Every decision it makes is a yes/no about one specific claim, because that is where
// an LLM judge is consistent; the scores below are counts of those decisions, never the judge's
// own opinion of overall quality. It grades against the gold facts AND the excerpts the answer was
// actually built from, so "faithful" means traceable to that block rather than merely true.
const JUDGE_SYSTEM = `You are grading one answer produced by a workplace assistant for a
restaurant chain. You will be given the excerpts the assistant was shown, the question, the
assistant's answer, and (for answerable questions) the facts a correct answer must contain.

Grade strictly and mechanically. Every judgement is yes or no. Do not reward fluency, length,
tone, or confidence. Do not penalise an answer for adding correct detail beyond the gold facts.

The corpus is Hebrew, questions come in Hebrew and English, and an answer must be written in the
language of the question regardless of the language of the excerpts.

Return ONLY a JSON object, no prose and no code fence:
{
  "factsCovered": [true/false per gold fact, in the order given],
  "unsupportedClaims": ["each claim in the answer that the excerpts do not support"],
  "declined": true/false,
  "inventedSpecifics": true/false,
  "answeredInQuestionLanguage": true/false,
  "note": "one short sentence"
}

Definitions:
- factsCovered[i]: does the answer actually state that fact? Paraphrase counts. A vague gesture
  toward the topic does not.
- unsupportedClaims: claims about the chain, its procedures, people, amounts or dates that are not
  traceable to the excerpts. Ordinary conversational framing is not a claim. An explicit statement
  that something was not found is not a claim.
- declined: does the answer say it could not find the information, rather than answering?
  A partial answer that gives what it found and names what it did not is NOT declined.
- inventedSpecifics: does the answer state any concrete name, number, amount or date that does not
  appear in the excerpts?`

// The graded material, in one shape for both sets. The uncovered set passes no gold facts and says
// so explicitly, because a judge left to infer why the list is empty grades the answer on
// helpfulness instead of on whether it declined.
const judgeRequest = (
  block: string,
  lang: string,
  question: string,
  answer: string,
  goldFacts: string[],
): string => {
  const facts =
    goldFacts.length > 0
      ? `GOLD FACTS (${goldFacts.length}):\n${goldFacts.map((fact, index) => `${index + 1}. ${fact}`).join('\n')}`
      : 'GOLD FACTS (0):\n(none — the corpus does not answer this question. The only correct behaviour is to say the information was not found. Return an empty factsCovered array.)'
  return `EXCERPTS THE ASSISTANT WAS SHOWN:\n${block || '(none)'}\n\nQUESTION (${lang}):\n${question}\n\nANSWER:\n${answer}\n\n${facts}`
}

const judgeSchema = z.object({
  factsCovered: z.array(z.boolean()),
  unsupportedClaims: z.array(z.string()),
  declined: z.boolean(),
  inventedSpecifics: z.boolean(),
  answeredInQuestionLanguage: z.boolean(),
  note: z.string(),
})

type Judgement = z.infer<typeof judgeSchema>

const parseJudgement = (raw: string, goldFactCount: number): Judgement | null => {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = judgeSchema.parse(JSON.parse(raw.slice(start, end + 1)))
    // A judge that returns the wrong number of verdicts has not graded the facts it was given, and
    // silently padding or truncating the array would fabricate a score.
    if (parsed.factsCovered.length !== goldFactCount) return null
    return parsed
  } catch {
    return null
  }
}

const formatToday = (now: Date): string =>
  `${now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}, ${now
    .toISOString()
    .slice(0, 10)}`

const pct = (n: number, d: number): string =>
  d === 0 ? '   n/a' : `${((n / d) * 100).toFixed(0).padStart(4)}%`

// Which language the answer is actually written in, decided by script rather than by a model.
// Answering in the language asked is the one generation property that needs no judgement at all:
// Hebrew is a distinct script, so counting letters settles it for free and exactly. Document
// titles quoted in a SOURCES trailer would skew this, but extractSources has already stripped it.
const languageOf = (text: string): 'he' | 'en' | 'unknown' => {
  const hebrew = (text.match(/[֐-׿]/g) ?? []).length
  const latin = (text.match(/[A-Za-z]/g) ?? []).length
  if (hebrew + latin < 10) return 'unknown'
  return hebrew > latin ? 'he' : 'en'
}

const main = async (): Promise<void> => {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(usage)
    return
  }
  const withAnswers = args.includes('--answers')
  // Grading by model is opt-in and separately priced, because it roughly DOUBLES the cost of a
  // run: the judge is re-sent the whole grounding block plus the answer, so its call is as
  // expensive as the answer it grades. Worth it for a CI gate, where the verdict has to be
  // reproducible without a person; wasteful for a one-off check a reader is going to look at
  // anyway. Without it the run buys answers, applies the free deterministic checks below, and
  // writes everything to --json for a human (or a coding agent) to grade at no provider cost.
  const withJudge = args.includes('--judge')
  const limitArg = args.find((arg) => arg.startsWith('--limit='))?.split('=')[1]
  const limit = limitArg ? Number(limitArg) : Number.POSITIVE_INFINITY
  const langFilter = args.find((arg) => arg.startsWith('--lang='))?.split('=')[1]
  const jsonOut = args.find((arg) => arg.startsWith('--json='))?.split('=')[1]
  const judgeModel =
    args.find((arg) => arg.startsWith('--judge-model='))?.split('=')[1] ??
    'anthropic/claude-sonnet-5'

  loadRootEnv()
  const env = envSchema.parse(process.env)

  const setName = args.find((arg) => arg.startsWith('--set='))?.split('=')[1] ?? 'golden-set'
  const goldenPath = new URL(`../eval/${setName}.json`, import.meta.url)
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as {
    chains?: Chain[]
    answerable: Answerable[]
    uncovered: Uncovered[]
  }
  const byLang = <T extends { lang: string }>(items: T[]): T[] =>
    (langFilter ? items.filter((item) => item.lang === langFilter) : items).slice(0, limit)
  const answerable = byLang(golden.answerable ?? [])
  const uncovered = byLang(golden.uncovered ?? [])
  const chains = (golden.chains ?? []).slice(0, limit)

  const { db, pool } = createDb(env.DATABASE_URL)
  const records: Record<string, unknown>[] = []

  // Answers are the only expensive thing here, so a run must never lose one it already paid for.
  // --json is written after every question rather than at the end, and --resume reuses whatever a
  // previous run of the same file already bought. Without this, stopping a run to change a flag
  // throws away every answer it had bought so far, which is exactly how one run's worth of money
  // was lost before this existed.
  const alreadyAnswered = new Map<string, Record<string, unknown>>()
  if (jsonOut && args.includes('--resume')) {
    try {
      const prior = JSON.parse(readFileSync(jsonOut, 'utf8')) as Record<string, unknown>[]
      for (const record of prior) {
        if (typeof record.answer === 'string') alreadyAnswered.set(record.id as string, record)
      }
      console.log(`\nresuming: ${alreadyAnswered.size} answers reused from ${jsonOut}`)
    } catch {
      console.log(`\nresuming: ${jsonOut} not readable yet, starting fresh`)
    }
  }
  const flush = (): void => {
    if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
  }
  try {
    const knowledge = createKnowledgeRepository(db)
    const embeddingConfig = resolveEmbeddingConfig(env)
    const embeddings = embeddingConfig
      ? createHttpEmbeddingClient(embeddingConfig)
      : createDisabledEmbeddingClient()

    // The same scoped reads the running server hands the answer path (server.ts), so a graded
    // answer reaches exactly the data a real person's answer would. These are read-only: the
    // harness never writes a thread, a message or a log row, which is what keeps one index
    // scoreable from two checkouts.
    const ports: Omit<AssistantToolPorts, 'clock'> = {
      knowledge,
      embeddings,
      tasks: createTaskBoardRepository(db),
      locations: createLocationRepository(db),
      projects: createProjectRepository(db),
      users: createAuthRepository(db),
      whatsapp: createWhatsappSummaryReader(db),
      access: createAccessService(db),
    }
    const toolPorts: AssistantToolPorts = { ...ports, clock: systemClock }

    const chunks = await knowledge.listGroundingChunks({ role: 'admin' })
    const docTitles = new Set(chunks.map((chunk) => titleKey(chunk.docTitle)))
    const docCount = new Set(chunks.map((chunk) => chunk.docId)).size
    const embedded = chunks.filter((chunk) => chunk.embedded).length

    // The database's cosine ranking per query variant, exactly as the answer path runs it — the
    // eval measures the product's retrieval, so it must go through the same scan.
    const searchVariants = (vectors: number[][]) =>
      Promise.all(
        vectors.map((vector) =>
          knowledge.searchChunksByVector({ role: 'admin' }, vector, ARM_LIMIT),
        ),
      )

    console.log(`\nindex:   ${docCount} docs -> ${chunks.length} chunks, ${embedded} embedded`)
    console.log(
      `golden:  ${answerable.length} answerable + ${uncovered.length} uncovered` +
        `${langFilter ? ` (${langFilter} only)` : ''}`,
    )

    // A gold label naming a document the corpus does not hold is a broken test, not a failure of
    // the system, and scoring it as a miss would quietly depress every number below it.
    const orphanLabels = [
      ...new Set(
        answerable.flatMap((item) =>
          item.sourceDocs.filter((doc) => !docTitles.has(titleKey(doc))),
        ),
      ),
    ]
    if (orphanLabels.length > 0) {
      console.log(`\n  ! ${orphanLabels.length} gold label(s) match no document in this corpus:`)
      for (const label of orphanLabels) console.log(`     ${label}`)
      console.log('    Those questions are unscoreable here — fix the label or the corpus.\n')
    }

    const llmConfig = withAnswers ? resolveLlmConfig(env) : null
    const llm = llmConfig ? createHttpLlmClient(llmConfig) : null
    // The judge is a different model family from the one being graded, because a model asked to
    // grade its own output rates it generously. It reuses the resolved endpoint and key, swapping
    // only the routed model, and runs with reasoning off: the rubric is a series of yes/no lookups
    // against a text it has in front of it, and reasoning tokens bill at the full output rate.
    const judge =
      llmConfig && withJudge
        ? createHttpLlmClient({ ...llmConfig, model: judgeModel, reasoningMaxTokens: null })
        : null
    console.log(
      withAnswers
        ? `answers: ${llmConfig?.model} · ${judge ? `judged by ${judgeModel}` : 'not machine-graded (--judge to buy verdicts)'}\n`
        : 'answers: (not bought — retrieval only)\n',
    )

    const meta = { today: formatToday(new Date()), role: 'employee' as const }
    const today = new Date().toISOString().slice(0, 10)

    // What this run was: which model answered, which prompt it answered under, and which commit
    // built both. Without these three a number from last week is not comparable to a number from
    // today, and every conversation about whether the assistant improved becomes an argument.
    const gitSha = (): string => {
      try {
        return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
      } catch {
        return 'unknown'
      }
    }
    const runMeta: { model: string | null; promptFingerprint: string | null; gitSha: string } = {
      model: llmConfig?.model ?? null,
      promptFingerprint: null,
      gitSha: gitSha(),
    }

    // Buy one answer the way the product answers: the real prompt, the real tools, the real
    // web search, under the item's own role (#388). Everything this returns is either free to
    // compute or came back with the answer, so a run that buys nothing else still knows where the
    // answer came from, what it reached for, and whether it claimed a lookup it never made.
    const gradeThroughLoop = async (
      item: Answerable | Uncovered,
      options: { expectAbstention: boolean; history?: MessageRow[]; priorUserTurns?: string[] },
    ) => {
      const goldFacts = 'goldFacts' in item ? item.goldFacts : []
      const answered: Awaited<ReturnType<typeof answerThroughLoop>> = await answerThroughLoop({
        // biome-ignore lint/style/noNonNullAssertion: only called when llm is resolved.
        llm: llm!,
        clock: systemClock,
        ports: toolPorts,
        principal: evalPrincipal({
          role: item.role ?? 'employee',
          locationId: item.locationId ?? null,
          locationName: item.locationName ?? null,
          preferredLanguage: item.lang,
        }),
        question: item.question,
        priorUserTurns: options.priorUserTurns ?? [],
        ...(options.history ? { history: options.history } : {}),
        webSearch: llmConfig?.webSearchTool ?? null,
        knowledgeCutoff: llmConfig?.knowledgeCutoff ?? null,
      })
      // Two runs are only comparable if they scored the same prompt. Stamped from the first
      // answer rather than rebuilt, so it is the prompt that actually went on the wire.
      runMeta.promptFingerprint ??= promptFingerprint(answered.systemPrompt)
      if (!answered.ok) {
        return {
          ok: false as const,
          text: '',
          record: { answerError: answered.error },
          verdict: null,
          wrongLanguage: false,
        }
      }
      const taken = routesTaken({
        trace: answered.trace,
        citations: answered.citations,
        webSearches: answered.usage?.webSearches ?? null,
      })
      const language = languageOf(answered.text)
      const verdict = verdictFor({
        text: answered.text,
        goldFacts,
        expectAbstention: options.expectAbstention,
        // Whether the answer actually carried material. Without this a reply that answered from
        // the web and then said the knowledge base held nothing was tallied as a decline.
        sourced: answered.sources.length > 0 || answered.citations.length > 0,
      })
      return {
        ok: true as const,
        text: answered.text,
        verdict,
        wrongLanguage: language !== 'unknown' && language !== item.lang,
        record: {
          answer: answered.text,
          answerLang: language,
          goldFacts,
          verdict,
          factsCovered: factCoverage(answered.text, goldFacts).covered,
          // What actually ran, so a route or a tool choice can be argued with rather than guessed at.
          routes: taken,
          routeExpected: item.expectedRoute ?? null,
          routeHit: item.expectedRoute ? routeHit(item.expectedRoute, taken) : null,
          tools: answered.trace.map((entry) => `${entry.tool}:${entry.status}`),
          toolScore: item.expectedTools ? toolScore(item.expectedTools, answered.trace) : null,
          rounds: answered.rounds,
          capped: answered.capped,
          // The two dishonesty detectors, both free: a claimed lookup with an empty trace, and a
          // cited document title no retrieval ever returned.
          narratedSearch: narratedSearch(answered.text) && answered.trace.length === 0,
          // A site named in the prose by an answer that never reached the web (2026-09-17).
          fabricatedWebSource: fabricatedWebSource({
            text: answered.text,
            webSearches: answered.usage?.webSearches ?? null,
            webPages: answered.citations.length,
          }),
          unresolvedCitations: answered.unresolvedCitations,
          // What the runtime guard did about it: null, 'repaired' or 'unrepaired' (source-guard.ts).
          sourceGuard: answered.sourceGuard,
          sources: answered.sources.map((source) => source.title),
          webPages: answered.citations.map((citation) => citation.url),
          hebrewSurface: hebrewSurface(answered.text),
          model: answered.model,
          inputTokens: answered.usage?.inputTokens ?? null,
          outputTokens: answered.usage?.outputTokens ?? null,
          webSearches: answered.usage?.webSearches ?? null,
          ...(item.recheckBy ? { recheckBy: item.recheckBy, stale: item.recheckBy < today } : {}),
        },
      }
    }

    const scores: RetrievalScore[] = []
    const verdicts: { answerable: Verdict[]; uncovered: Verdict[] } = {
      answerable: [],
      uncovered: [],
    }
    let factsTotal = 0
    let factsCovered = 0
    let unfaithful = 0
    let wrongLanguage = 0
    let falseDeclines = 0
    let judgeFailures = 0

    for (const item of answerable) {
      const prior = alreadyAnswered.get(item.id)
      if (prior) {
        records.push(prior)
        if (prior.answerLang !== 'unknown' && prior.answerLang !== item.lang) wrongLanguage += 1
        if (prior.scoreable) scores.push(prior.retrieval as RetrievalScore)
        process.stdout.write('=')
        continue
      }
      // An item with no gold document is not a retrieval test. The routing and freshness sets are
      // full of them on purpose — a VAT rate has no document in our corpus and should not have one
      // — and scoring them as retrieval misses would drag the retrieval number down with questions
      // it was never asked to answer.
      const scoreable =
        item.sourceDocs.length > 0 && item.sourceDocs.every((doc) => docTitles.has(titleKey(doc)))
      const queryTexts = buildQueryTexts(item.question, undefined)
      const embeddedQuery = await embeddings.embed(queryTexts)
      const grounding = retrieveGrounding(
        chunks,
        item.question,
        embeddedQuery.ok ? await searchVariants(embeddedQuery.vectors) : [],
      )
      const score = scoreRetrieval(grounding.selected, item.sourceDocs)
      if (scoreable) scores.push(score)

      const record: Record<string, unknown> = {
        id: item.id,
        lang: item.lang,
        pairId: item.pairId,
        set: 'answerable',
        scoreable,
        question: item.question,
        mode: grounding.mode,
        vectorArmEmpty: grounding.vectorArmEmpty,
        retrieval: score,
        retrievedDocs: [...new Set(grounding.selected.map((chunk) => chunk.docTitle))],
      }

      if (llm) {
        // An item whose expected route IS a refusal is asking the assistant to decline: the
        // WhatsApp questions put to someone without head-office reach, where answering at all
        // would be the failure. Grading those as ordinary answerable items counted every correct
        // refusal towards over-abstention and was a large part of what failed the routing gate
        // (2026-09-17).
        const answered = await gradeThroughLoop(item, {
          expectAbstention: item.expectedRoute === 'refuse',
        })
        Object.assign(record, answered.record)
        if (answered.verdict) verdicts.answerable.push(answered.verdict)
        if (answered.wrongLanguage) wrongLanguage += 1
        if (judge && answered.ok) {
          const text = answered.text
          const verdict = await judge.complete({
            maxTokens: 1_200,
            messages: [
              { role: 'system', content: JUDGE_SYSTEM },
              {
                role: 'user',
                content: judgeRequest(
                  grounding.block,
                  item.lang,
                  item.question,
                  text,
                  item.goldFacts,
                ),
              },
            ],
          })
          const judged = verdict.ok ? parseJudgement(verdict.content, item.goldFacts.length) : null
          if (judged) {
            factsTotal += judged.factsCovered.length
            factsCovered += judged.factsCovered.filter(Boolean).length
            if (judged.unsupportedClaims.length > 0) unfaithful += 1
            // The language verdict is NOT taken from the judge: languageOf already settled it by
            // counting script, for free and without a model's opinion in the loop.
            // A decline on a question the corpus demonstrably answers is the specific failure the
            // client reported, and the one worth counting on its own.
            if (judged.declined) falseDeclines += 1
            record.judged = judged
          } else {
            judgeFailures += 1
            record.judgeError = verdict.ok ? 'unparseable verdict' : verdict.error
          }
        }
      }
      records.push(record)
      flush()
      process.stdout.write(score.hit ? '.' : 'X')
    }
    process.stdout.write('\n')

    let correctRefusals = 0
    let inventions = 0
    let uncoveredGraded = 0
    for (const item of uncovered) {
      const prior = alreadyAnswered.get(item.id)
      if (prior) {
        records.push(prior)
        process.stdout.write('=')
        continue
      }
      const queryTexts = buildQueryTexts(item.question, undefined)
      const embeddedQuery = await embeddings.embed(queryTexts)
      const grounding = retrieveGrounding(
        chunks,
        item.question,
        embeddedQuery.ok ? await searchVariants(embeddedQuery.vectors) : [],
      )
      const record: Record<string, unknown> = {
        id: item.id,
        lang: item.lang,
        pairId: item.pairId,
        set: 'uncovered',
        question: item.question,
        mode: grounding.mode,
        chunksSelected: grounding.selected.length,
        retrievedDocs: [...new Set(grounding.selected.map((chunk) => chunk.docTitle))],
      }
      if (llm) {
        // The uncovered set's only right answer is a decline, so the verdict is graded that way:
        // a confident reply here is an invention, however well it reads.
        const answered = await gradeThroughLoop(item, { expectAbstention: true })
        Object.assign(record, answered.record)
        record.whyAbsent = item.whyAbsent
        if (answered.verdict) verdicts.uncovered.push(answered.verdict)
        if (judge && answered.ok) {
          const text = answered.text
          const verdict = await judge.complete({
            maxTokens: 1_200,
            messages: [
              { role: 'system', content: JUDGE_SYSTEM },
              {
                role: 'user',
                content: judgeRequest(grounding.block, item.lang, item.question, text, []),
              },
            ],
          })
          const judged = verdict.ok ? parseJudgement(verdict.content, 0) : null
          if (judged) {
            uncoveredGraded += 1
            if (judged.declined) correctRefusals += 1
            if (judged.inventedSpecifics) inventions += 1
            record.judged = judged
          } else {
            judgeFailures += 1
            record.judgeError = verdict.ok ? 'unparseable verdict' : verdict.error
          }
        }
      }
      records.push(record)
      flush()
      process.stdout.write(grounding.selected.length === 0 ? '.' : 'o')
    }
    process.stdout.write('\n')

    // --- conversations ---
    // Anchoring is the scored property and it needs no model: a follow-up that carries no content
    // words should still retrieve the documents its own thread was about. Comparing each turn's
    // retrieved set against turn one's is free, exact, and is the thing that actually broke in
    // production, where a bare "תסביר" lost the topic and produced a decline.
    let anchoredTurns = 0
    let followUpTurns = 0
    for (const chain of chains) {
      const history: MessageRow[] = []
      let anchorDocs = new Set<string>()
      for (const [turnIndex, question] of chain.turns.entries()) {
        // Resolved exactly as the answer path resolves it, or the chain would be measuring
        // something the product does not do.
        const priorUserTurns = history
          .filter((turn) => turn.role === 'user')
          .map((turn) => turn.content)
        const resolved = resolveQuery(question, priorUserTurns)
        const embeddedQuery = await embeddings.embed(resolved.texts)
        const grounding = retrieveGrounding(
          chunks,
          resolved.question,
          embeddedQuery.ok ? await searchVariants(embeddedQuery.vectors) : [],
        )
        const docs = new Set(grounding.selected.map((chunk) => titleKey(chunk.docTitle)))
        const anchored = turnIndex === 0 || [...anchorDocs].some((doc) => docs.has(doc))
        if (turnIndex === 0) anchorDocs = docs
        else {
          followUpTurns += 1
          if (anchored) anchoredTurns += 1
        }

        const record: Record<string, unknown> = {
          id: `${chain.id}#${turnIndex + 1}`,
          set: 'chain',
          chainId: chain.id,
          turn: turnIndex + 1,
          question,
          mode: grounding.mode,
          chunksSelected: grounding.selected.length,
          retrievedDocs: [...new Set(grounding.selected.map((chunk) => chunk.docTitle))],
          keptTurnOneDocs: anchored,
          intent: turnIndex === 0 ? chain.intent : undefined,
        }
        let answerText: string | null = null
        if (llm) {
          // history holds the turns BEFORE this one; the current question is passed separately.
          // The prior user turns go in as well, because the document search anchors a contentless
          // follow-up on them exactly as the product does.
          const answered = await gradeThroughLoop(
            {
              ...chain,
              id: chain.id,
              question,
              lang: languageOf(question) === 'en' ? 'en' : 'he',
              pairId: chain.id,
              whyAbsent: '',
            },
            { expectAbstention: false, history, priorUserTurns },
          )
          Object.assign(record, answered.record)
          if (answered.ok) answerText = answered.text
        }
        // The USER turn is recorded whether or not an answer was bought, because retrieval's only
        // handle on a contentless follow-up is the previous user turn. Pushing it solely on the
        // paid path would leave a free run with no history at all, so every follow-up would be
        // retrieved as if it were the first thing anyone had said and the anchoring number would
        // be measuring nothing. The agent turns are simply absent from a free run, which changes
        // what the MODEL sees but not what RETRIEVAL matches on.
        history.push({ role: 'user', content: question } as MessageRow)
        if (answerText !== null) {
          history.push({ role: 'agent', content: answerText } as MessageRow)
        }
        records.push(record)
        flush()
        process.stdout.write(anchored ? '.' : 'X')
      }
      process.stdout.write(' ')
    }
    if (chains.length > 0) process.stdout.write('\n')

    const hits = scores.filter((score) => score.hit).length
    const denominator = Math.max(scores.length, 1)
    const mrr =
      scores.reduce((sum, score) => sum + (score.firstGoldRank ? 1 / score.firstGoldRank : 0), 0) /
      denominator
    const docRecall =
      scores.reduce(
        (sum, score) => sum + score.goldDocsFound / Math.max(score.goldDocsTotal, 1),
        0,
      ) / denominator
    const meanPrecision = scores.reduce((sum, score) => sum + score.precision, 0) / denominator

    console.log(`\n─── retrieval ${'─'.repeat(50)}`)
    console.log(
      `  gold document reached the block   ${pct(hits, scores.length)}  (${hits}/${scores.length})`,
    )
    console.log(`  mean reciprocal rank              ${mrr.toFixed(3)}`)
    console.log(`  gold documents recalled           ${(docRecall * 100).toFixed(0)}%`)
    console.log(`  block spent on gold documents     ${(meanPrecision * 100).toFixed(0)}%`)

    // The pair view: the same question in two languages must behave the same way. A pair where one
    // language hits and the other misses is the cross-language gap that keyword-arm work chases,
    // and it is invisible in the aggregate above.
    const pairs = new Map<string, { he?: boolean; en?: boolean }>()
    for (const record of records) {
      if (record.set !== 'answerable' || !record.scoreable) continue
      const entry = pairs.get(record.pairId as string) ?? {}
      entry[record.lang as 'he' | 'en'] = (record.retrieval as RetrievalScore).hit
      pairs.set(record.pairId as string, entry)
    }
    const complete = [...pairs.values()].filter(
      (pair) => pair.he !== undefined && pair.en !== undefined,
    )
    const both = complete.filter((pair) => pair.he && pair.en).length
    const split = complete.filter((pair) => pair.he !== pair.en).length
    const neither = complete.filter((pair) => !pair.he && !pair.en).length
    if (complete.length > 0) {
      console.log(
        `\n  bilingual pairs (${complete.length}): both hit ${both} · one only ${split} · neither ${neither}`,
      )
      for (const [pairId, entry] of pairs) {
        if (entry.he === undefined || entry.en === undefined || entry.he === entry.en) continue
        console.log(`     ${entry.he ? 'he only' : 'en only'} — ${pairId}`)
      }
    }

    const noisyUncovered = records.filter(
      (record) => record.set === 'uncovered' && (record.chunksSelected as number) > 0,
    ).length
    console.log(
      `\n  uncovered questions that still pulled chunks  ${noisyUncovered}/${uncovered.length}`,
    )
    console.log('    (not a failure by itself — the answer still has to decline)')

    const misses = records.filter(
      (record) =>
        record.set === 'answerable' &&
        record.scoreable &&
        !(record.retrieval as RetrievalScore).hit,
    )
    if (misses.length > 0) {
      console.log(`\n  retrieval misses (${misses.length}):`)
      for (const miss of misses) {
        console.log(`     [${miss.lang}] ${miss.id}`)
        console.log(`        ${miss.question}`)
        console.log(
          `        got: ${(miss.retrievedDocs as string[]).slice(0, 3).join(' · ') || '(nothing)'}`,
        )
      }
    }

    if (followUpTurns > 0) {
      console.log(`\n─── conversations ${'─'.repeat(46)}`)
      console.log(
        `  follow-ups that kept the thread's documents  ${pct(anchoredTurns, followUpTurns)}` +
          `  (${anchoredTurns}/${followUpTurns})`,
      )
      const lost = records.filter(
        (record) =>
          record.set === 'chain' && (record.turn as number) > 1 && !record.keptTurnOneDocs,
      )
      for (const turn of lost) {
        console.log(
          `     lost the thread: [${turn.chainId}] turn ${turn.turn} — "${turn.question}"`,
        )
        console.log(
          `        went to: ${(turn.retrievedDocs as string[]).slice(0, 3).join(' · ') || '(nothing)'}`,
        )
      }
    }

    if (withAnswers) {
      console.log(`\n─── answers ${'─'.repeat(52)}`)
      console.log(
        `  ${runMeta.model} · prompt ${runMeta.promptFingerprint ?? '(none built)'} · commit ${runMeta.gitSha}`,
      )
      const answered = records.filter(
        (record) => record.set === 'answerable' && typeof record.answer === 'string',
      ).length
      const failed = records.filter((record) => record.answerError).length
      console.log(`  answers bought                    ${answered}/${answerable.length}`)
      if (failed > 0) console.log(`  ! the model failed to answer      ${failed}`)
      // Free, decided by counting script rather than by a model.
      console.log(`  answered in the wrong language    ${wrongLanguage}/${answered}`)

      // --- the three-way score (#388) ---
      // Two-way grading lumps "declined" in with "wrong", which scores a system that always
      // answers the same as one that knows when it does not know. The client cannot afford the
      // first, so a wrong answer costs twice what a decline does.
      const answerableTally = tally(verdicts.answerable)
      const uncoveredTally = tally(verdicts.uncovered)
      console.log(`\n  answerable set (${answerableTally.total})`)
      console.log(
        `    correct ${answerableTally.correct} · incorrect ${answerableTally.incorrect} · declined ${answerableTally.abstained}`,
      )
      console.log(
        `    headline (correct - 2x incorrect)  ${answerableTally.headline} (${(answerableTally.headlineRate * 100).toFixed(0)}%)`,
      )
      if (uncoveredTally.total > 0) {
        console.log(`\n  uncovered set (${uncoveredTally.total}) — a decline is the right answer`)
        console.log(
          `    declined ${uncoveredTally.abstained} · answered anyway ${uncoveredTally.incorrect}`,
        )
      }

      // Per language, because an aggregate hides the gap that matters here: the product is used
      // in Hebrew and developed in English, and a Hebrew-only regression reads as a small dip.
      const langTally = (lang: 'he' | 'en'): ReturnType<typeof tally> =>
        tally(
          records
            .filter(
              (record) =>
                record.set === 'answerable' && record.lang === lang && record.verdict !== undefined,
            )
            .map((record) => record.verdict as Verdict),
        )
      const he = langTally('he')
      const en = langTally('en')
      if (he.total > 0 && en.total > 0) {
        const gap = Math.abs(he.headlineRate - en.headlineRate) * 100
        console.log(
          `\n  he ${(he.headlineRate * 100).toFixed(0)}% · en ${(en.headlineRate * 100).toFixed(0)}% · gap ${gap.toFixed(0)} points${gap > 5 ? '  <- above the 5-point alert' : ''}`,
        )
      }

      // --- routing and tool choice ---
      const routed = records.filter(
        (record) => record.routeHit !== null && record.routeHit !== undefined,
      )
      if (routed.length > 0) {
        const routeHits = routed.filter((record) => record.routeHit === true).length
        console.log(`\n  took the expected route           ${pct(routeHits, routed.length)}`)
        for (const record of routed.filter((entry) => entry.routeHit === false)) {
          console.log(
            `     wanted ${record.routeExpected} · went ${(record.routes as string[]).join(' + ')} — ${record.id}`,
          )
        }
      }
      const withTools = records.filter((record) => record.toolScore)
      if (withTools.length > 0) {
        const meanF1 =
          withTools.reduce((sum, record) => sum + (record.toolScore as { f1: number }).f1, 0) /
          withTools.length
        console.log(`  tool-call F1                      ${meanF1.toFixed(2)}`)
      }

      // --- the free honesty checks ---
      const narrated = records.filter((record) => record.narratedSearch === true)
      const invented = records.filter((record) => (record.unresolvedCitations as number) > 0)
      const capped = records.filter((record) => record.capped === true).length
      console.log(
        `\n  claimed a lookup it never made    ${narrated.length}${narrated.length > 0 ? '  <- must be 0' : ''}`,
      )
      for (const record of narrated) console.log(`     ${record.id}: ${record.question}`)
      console.log(
        `  cited a document that does not exist  ${invented.length}${invented.length > 0 ? '  <- must be 0' : ''}`,
      )
      for (const record of invented) console.log(`     ${record.id}: ${record.question}`)
      const fabricated = records.filter((record) => record.fabricatedWebSource === true)
      console.log(
        `  named a site it never fetched     ${fabricated.length}${fabricated.length > 0 ? '  <- must be 0' : ''}`,
      )
      for (const record of fabricated) console.log(`     ${record.id}: ${record.question}`)
      // The guard's own tally. 'sent back and fixed' is the guard earning its second model call;
      // 'reached the reader with a note' is the model ignoring the instruction, and the number to
      // watch if the wording of that instruction is ever changed.
      const repaired = records.filter((record) => record.sourceGuard === 'repaired')
      const unrepaired = records.filter((record) => record.sourceGuard === 'unrepaired')
      console.log(`  source guard: sent back and fixed ${repaired.length}`)
      console.log(`  source guard: reached the reader with a note  ${unrepaired.length}`)
      for (const record of unrepaired) console.log(`     ${record.id}: ${record.question}`)
      console.log(`  hit the lookup budget             ${capped}`)

      const surfaceFlags = records.filter((record) => {
        const flags = record.hebrewSurface as
          | { niqqud: boolean; easternDigits: boolean; latinLed: boolean }
          | undefined
        return flags && (flags.niqqud || flags.easternDigits || flags.latinLed)
      })
      if (surfaceFlags.length > 0) {
        console.log(`  Hebrew surface problems           ${surfaceFlags.length}`)
        for (const record of surfaceFlags) {
          const flags = record.hebrewSurface as Record<string, boolean>
          const named = Object.entries(flags)
            .filter(([, on]) => on)
            .map(([name]) => name)
            .join(', ')
          console.log(`     ${record.id}: ${named}`)
        }
      }

      const stale = records.filter((record) => record.stale === true)
      if (stale.length > 0) {
        console.log(
          `\n  ! ${stale.length} freshness item(s) are past their recheck date and were graded against a value nobody has confirmed:`,
        )
        for (const record of stale)
          console.log(`     ${record.id} (recheck by ${record.recheckBy})`)
      }

      // The gate. Thresholds rather than perfection, because model-graded assertions are
      // non-deterministic and a 100% bar makes the run flaky and then ignored.
      // `failed` is passed in so the gate can refuse to score a battery that did not run. On
      // 2026-09-17 the credits ran out at question seven and this printed "gate passed" over the
      // six answers that survived.
      const failures = gateFailures(
        { answerable: answerableTally, uncovered: uncoveredTally },
        { answered, failed },
      )
      if (failures.length > 0) {
        console.log('\n  GATE FAILED:')
        for (const failure of failures) console.log(`     ${failure}`)
        process.exitCode = 1
      } else if (answerableTally.total > 0) {
        console.log('\n  gate passed')
      } else {
        console.log('\n  no answers to gate')
      }

      if (judge) {
        const graded = records.filter(
          (record) => record.set === 'answerable' && record.judged,
        ).length
        console.log(
          `  gold facts stated                 ${pct(factsCovered, factsTotal)}  (${factsCovered}/${factsTotal})`,
        )
        console.log(`  answers with an unsupported claim ${unfaithful}/${graded}`)
        console.log(`  declined a covered question       ${falseDeclines}/${graded}`)
        console.log(
          `  correct refusal when uncovered    ${pct(correctRefusals, uncoveredGraded)}  (${correctRefusals}/${uncoveredGraded})`,
        )
        console.log(`  invented specifics when uncovered ${inventions}/${uncoveredGraded}`)
        if (judgeFailures > 0) console.log(`  ! judge returned nothing usable   ${judgeFailures}`)
      } else {
        console.log(
          '\n  Fact coverage, faithfulness and refusal need judgement, which was not bought.',
        )
        console.log(
          `  Every answer, its gold facts and the excerpts it was built from are in ${jsonOut ?? '--json (not set)'},`,
        )
        console.log('  ready to be graded by a reader. Pass --judge to buy machine verdicts.')
      }
    }

    flush()
    if (jsonOut) console.log(`\nwrote ${jsonOut}`)
    console.log()
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
