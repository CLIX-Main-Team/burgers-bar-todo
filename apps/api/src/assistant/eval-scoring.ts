import { createHash } from 'node:crypto'

// What the evaluation grades with (PR4, roadmap group b). Everything here is pure: it reads an
// answer's text and the trace of what actually ran, and decides. Nothing calls a model.
//
// That split is the whole economy of an eval run. Buying the answer is the expensive part, so
// every property that can be settled by looking at the result is settled here for free and
// asserted by a unit suite, and the paid judge is reserved for the one question a regex cannot
// answer: is this answer true. Until #388 the harness had exactly one free check (the reply's
// language, counted by script) and everything else waited on a person or a second model.

export type EvalRoute = 'docs' | 'web' | 'general' | 'refuse' | `app:${string}`

export interface TraceEntry {
  tool: string
  status: string
}

// Where the answer went looking, read from the loop's own record rather than from what the answer
// says it did. A tool that ran and found nothing still counts: routing is the model's choice of
// shelf, and "looked in the right place and the place was empty" is a corpus problem, not a
// routing one. The two are worth failing separately.
export function routesTaken(input: {
  trace: TraceEntry[]
  citations: { url: string }[]
  webSearches: number | null
}): EvalRoute[] {
  // A lookup the scope predicate refused is not a shelf the answer chose to read, it is the
  // permission boundary doing its job. When every tool the answer ran came back that way and
  // nothing else delivered, the whole answer is a refusal, which is what the uncovered and denied
  // questions are asking about. Without this `refuse` was unreachable: routesTaken could only ever
  // return a tool route, 'web' or 'general', so a question expecting it failed however well the
  // assistant behaved (2026-09-17).
  const refusedEverything =
    input.trace.length > 0 && input.trace.every((entry) => entry.status === 'out_of_scope')
  if (refusedEverything && input.citations.length === 0 && (input.webSearches ?? 0) === 0) {
    return ['refuse']
  }

  const routes: EvalRoute[] = []
  for (const entry of input.trace) {
    if (entry.status === 'out_of_scope') continue
    const route: EvalRoute = entry.tool === 'search_documents' ? 'docs' : `app:${entry.tool}`
    if (!routes.includes(route)) routes.push(route)
  }
  // A cited page is the only proof a search ran on the production engine, which returns citations
  // with no server_tool_use block at all (ADR-0028). A billed search with nothing cited still ran.
  if (input.citations.length > 0 || (input.webSearches ?? 0) > 0) routes.push('web')
  return routes.length > 0 ? routes : ['general']
}

// `general` and `refuse` are claims about the whole answer — nothing was looked up — so they are
// the one pair that has to match exactly. A greeting that buys a paid search is a routing failure
// even though the reply reads perfectly.
export function routeHit(expected: EvalRoute, taken: EvalRoute[]): boolean {
  if (expected === 'general' || expected === 'refuse') {
    return taken.length === 1 && taken[0] === expected
  }
  return taken.includes(expected)
}

export interface ToolScore {
  precision: number
  recall: number
  f1: number
  missing: string[]
  extra: string[]
}

export function toolScore(expected: string[], trace: TraceEntry[]): ToolScore {
  const wanted = new Set(expected)
  const called = new Set(trace.map((entry) => entry.tool))
  const hits = [...wanted].filter((tool) => called.has(tool)).length
  const precision = called.size === 0 ? (wanted.size === 0 ? 1 : 0) : hits / called.size
  const recall = wanted.size === 0 ? (called.size === 0 ? 1 : 0) : hits / wanted.size
  return {
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    missing: [...wanted].filter((tool) => !called.has(tool)),
    extra: [...called].filter((tool) => !wanted.has(tool)),
  }
}

// An answer that says it searched when the trace is empty. This is the specific dishonesty the
// 2026-09-16 production battery caught twice: the model answered the VAT question from memory
// while naming the websites it had supposedly read. The server-built chips stayed honest, the
// prose did not, and nothing failed. Now something does.
const NARRATION_PATTERNS = [
  /\bI (searched|checked|looked (it )?up|browsed|consulted|verified)\b/i,
  /\b(according to|based on) my (search|lookup|research)\b/i,
  /\bafter (searching|checking)\b/i,
  /חיפשתי/,
  /בדקתי/,
  /עיינתי/,
  /סרקתי/,
  /ביררתי/,
]

export function narratedSearch(text: string): boolean {
  return NARRATION_PATTERNS.some((pattern) => pattern.test(text))
}

// Naming a website the answer never fetched.
//
// The prompt teaches the shape "as of <date>, according to <the site>" for anything taken from the
// web, and the model reaches for that same shape when it has not searched at all. Three answers
// did exactly that on 2026-09-17, in both languages and across both sets, and every one of them
// scored correct because the figure was right. That is the dangerous direction: a wrong number
// with no source invites a check, a right number with an invented source does not.
//
// Every other honesty check reads the SOURCES trailer, which the server builds from what actually
// ran and the model cannot forge. These claims live in the prose instead, where nothing was
// looking. Free to run: no model, no network.
//
// Hebrew is written as codepoints, not characters, for the reason given at the top of this file.
const FABRICATED_SOURCE_PATTERNS = [
  // a domain named in the prose
  /\b[a-z0-9][a-z0-9-]*\.(?:co\.il|org\.il|gov\.il|ac\.il|com|org|net|news)\b/i,
  // the word "site" itself, which is the tell when outlets are named in words rather than as a URL
  /\bweb ?sites?\b/i,
  /\u05d0\u05ea\u05e8(?:\u05d9\u05dd)?/,
]

export function fabricatedWebSource(input: {
  text: string
  webSearches: number | null
  webPages: number
}): boolean {
  // A search that ran and came back empty is still a search. Only an answer that never reached the
  // web at all can be inventing what it found there.
  const searched = (input.webSearches ?? 0) > 0 || input.webPages > 0
  if (searched) return false
  return FABRICATED_SOURCE_PATTERNS.some((pattern) => pattern.test(input.text))
}

// The miss the prompt asks for, in either language, plus the out-of-scope reply a scope predicate
// produces. Matched on wording rather than on an empty trace, because an honest decline after
// three lookups is still a decline and must be tallied as one.
const ABSTENTION_PATTERNS = [
  /\bI (did ?n[o']t|could ?n[o']t|was not able to|cannot|can't|do ?n[o']t have)\b[^.]{0,40}\b(find|locate|answer|access|see)\b/i,
  /\b(no|not) (answer|information|record|material)\b[^.]{0,30}\b(found|available)\b/i,
  /\boutside what you can (view|see)\b/i,
  /לא מצאתי/,
  /לא הצלחתי למצוא/,
  /לא נמצא(ה|ו)? (תשובה|מידע)/,
  /אין לי (מידע|תשובה|גישה)/,
  /מחוץ למה ש(את|אתה|אתם)/,
]

export function abstained(text: string): boolean {
  return ABSTENTION_PATTERNS.some((pattern) => pattern.test(text))
}

export interface HebrewSurface {
  niqqud: boolean
  easternDigits: boolean
  latinLed: boolean
}

const HEBREW_LETTER = /[א-ת]/
const NIQQUD = /[֑-ׇ]/
// Arabic-Indic and extended Arabic-Indic. A model that reaches for these in a Hebrew sentence
// produces digits an Israeli reader does not read, and the app renders them without complaint.
const EASTERN_DIGITS = /[٠-٩۰-۹]/
const LATIN_LETTER = /[A-Za-z]/

// The direction failure dir="auto" cannot save us from (#387 put it on every block): a paragraph
// that is mostly Hebrew but opens with a Latin word resolves left to right, so the whole block
// flips and the reader sees the sentence backwards. The fix is the model's, not the renderer's,
// which is why this is graded rather than patched.
//
// Only a block that is mostly Hebrew can be flipped. An English sentence that quotes a Hebrew term
// in brackets also opens with a Latin letter, and it should: left to right is correct for it.
// Until this counted letters the flag fired on 36 blocks in the 2026-09-17 runs, every one of them
// in an English answer, and reported a defect the answers did not have.
function blockIsLatinLed(block: string): boolean {
  let hebrew = 0
  let latin = 0
  let first: 'hebrew' | 'latin' | null = null
  for (const char of block) {
    if (HEBREW_LETTER.test(char)) {
      hebrew += 1
      first ??= 'hebrew'
    } else if (LATIN_LETTER.test(char)) {
      latin += 1
      first ??= 'latin'
    }
  }
  return first === 'latin' && hebrew > latin
}

export function hebrewSurface(text: string): HebrewSurface {
  return {
    niqqud: NIQQUD.test(text),
    easternDigits: EASTERN_DIGITS.test(text),
    latinLed: text.split('\n').some((block) => blockIsLatinLed(block.trim())),
  }
}

// Did the answer state this fact, in whatever words it chose? A gold fact is written as a short
// phrase ("שני מנהלי מוקד"), and an answer that says the same thing in a sentence must count. So
// coverage is word overlap rather than substring: strip the marks that make two spellings of one
// Hebrew word look different, then ask how much of the fact's vocabulary turned up.
//
// This is the free first pass, not a verdict. It is deliberately not a model: paying a judge to
// grade a run doubles its cost, and the owner grades by hand. What this buys is that a reader
// opens the JSON already sorted into "these look right" and "look at these", instead of reading
// fifty-five answers cold.
const foldForMatch = (text: string): string[] =>
  text
    .normalize('NFC')
    .replace(/[֑-ׇ‎‏]/g, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 2)

const HEBREW_PREFIXES = 'הובלמכש'

const wordPresent = (word: string, haystack: string[]): boolean =>
  haystack.some(
    (candidate) =>
      candidate === word ||
      candidate.includes(word) ||
      word.includes(candidate) ||
      (word.length >= 4 && HEBREW_PREFIXES.includes(word[0] as string)
        ? haystack.includes(word.slice(1))
        : false),
  )

export const MIN_FACT_COVERAGE = 0.7

export function factCoverage(
  answer: string,
  facts: string[],
): { covered: boolean[]; rate: number } {
  const haystack = foldForMatch(answer)
  const covered = facts.map((fact) => {
    const words = foldForMatch(fact)
    if (words.length === 0) return false
    const hits = words.filter((word) => wordPresent(word, haystack)).length
    return hits / words.length >= MIN_FACT_COVERAGE
  })
  return {
    covered,
    rate: facts.length === 0 ? 1 : covered.filter(Boolean).length / facts.length,
  }
}

export type Verdict = 'correct' | 'incorrect' | 'abstained'

// The three-way call. Grading two ways lumps "declined" in with "wrong", which rewards exactly the
// behaviour the client cannot afford: a system that always answers scores the same as one that
// knows when it does not know.
export function verdictFor(input: {
  text: string
  goldFacts: string[]
  // True for the uncovered set, where declining is the only right answer and a confident reply is
  // an invention however plausible it reads.
  expectAbstention: boolean
  minCoverage?: number
  // Whether the answer actually carried material: a document chip or a web citation. Used to tell
  // a real decline apart from an answer that delivered and then said what it did not find.
  sourced?: boolean
}): Verdict {
  const { rate } = factCoverage(input.text, input.goldFacts)
  const threshold = input.minCoverage ?? MIN_FACT_COVERAGE
  const covered = input.goldFacts.length > 0 && rate >= threshold

  // An answer that delivered from one source and then named what it did NOT find in another is
  // not a decline, it is the honesty the prompt asks for. Reading it as a refusal punished exactly
  // the behaviour we want and pushed a run over the over-abstention gate (2026-09-17). Only on the
  // uncovered set does a decline still win outright, because there declining IS the answer.
  const delivered = !input.expectAbstention && (input.sourced === true || covered)
  if (abstained(input.text) && !delivered) return 'abstained'
  if (input.expectAbstention) return 'incorrect'
  return rate >= threshold ? 'correct' : 'incorrect'
}

export interface Tally {
  correct: number
  incorrect: number
  abstained: number
  total: number
  // Correct answers minus twice the wrong ones. The weighting is the whole point of grading three
  // ways: a system that declines when unsure is usable and one that answers confidently and wrongly
  // is worse than useless, so a two-way score that lumps "declined" in with "wrong" rewards exactly
  // the behaviour the client cannot afford.
  headline: number
  headlineRate: number
}

export function tally(verdicts: Verdict[]): Tally {
  const correct = verdicts.filter((verdict) => verdict === 'correct').length
  const incorrect = verdicts.filter((verdict) => verdict === 'incorrect').length
  const abstainedCount = verdicts.filter((verdict) => verdict === 'abstained').length
  const headline = correct - 2 * incorrect
  return {
    correct,
    incorrect,
    abstained: abstainedCount,
    total: verdicts.length,
    headline,
    headlineRate: verdicts.length === 0 ? 0 : headline / verdicts.length,
  }
}

// The thresholds a run has to clear to be called green. They are deliberately not "100% correct":
// the answers are model-graded and non-deterministic, so a perfect bar makes the gate flaky and a
// flaky gate gets switched off. What is pinned instead is the shape of the failure that matters —
// a confident wrong answer is nearly never acceptable, a miss on something we do not cover must
// still be declined, and declining what we do cover is its own failure.
export const MAX_INCORRECT_RATE = 0.02
export const MIN_ABSTENTION_RECALL = 0.9
export const MAX_OVER_ABSTENTION_RATE = 0.1
// How much of a battery may fail to produce an answer at all before the run stops being a result.
// A long run losing one question to a provider hiccup is still worth reading; a run that lost a
// third of its questions is not a score, it is a broken instrument, and every rate above is
// computed over the survivors and therefore flatters.
export const MAX_UNANSWERED_RATE = 0.1

export function gateFailures(
  sets: { answerable: Tally; uncovered: Tally },
  // How many answers were actually bought, and how many the provider never returned. Optional
  // because the retrieval-only path has nothing to report here.
  attempts?: { answered: number; failed: number },
): string[] {
  const failures: string[] = []
  const { answerable, uncovered } = sets
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`

  // Checked before anything else: if the battery did not run, the rates below describe whichever
  // questions happened to get through, and saying anything about them as if they were the set is
  // the lie this gate exists to prevent.
  if (attempts !== undefined) {
    const tried = attempts.answered + attempts.failed
    if (tried > 0) {
      const unanswered = attempts.failed / tried
      if (unanswered > MAX_UNANSWERED_RATE) {
        failures.push(
          `the model failed to answer ${pct(unanswered)} of the battery (${attempts.failed} of ${tried}), above ${pct(MAX_UNANSWERED_RATE)}; the scores below cover only the ${attempts.answered} that answered and are not comparable to a full run`,
        )
      }
    }
  }
  if (answerable.total > 0) {
    const incorrectRate = answerable.incorrect / answerable.total
    if (incorrectRate > MAX_INCORRECT_RATE) {
      failures.push(
        `incorrect answers ${pct(incorrectRate)} of the answerable set, above ${pct(MAX_INCORRECT_RATE)}`,
      )
    }
    const overAbstention = answerable.abstained / answerable.total
    if (overAbstention > MAX_OVER_ABSTENTION_RATE) {
      failures.push(
        `over-abstention ${pct(overAbstention)} of the answerable set, above ${pct(MAX_OVER_ABSTENTION_RATE)}`,
      )
    }
  }
  if (uncovered.total > 0) {
    const recall = uncovered.abstained / uncovered.total
    if (recall < MIN_ABSTENTION_RECALL) {
      failures.push(
        `abstention recall ${pct(recall)} on the uncovered set, below ${pct(MIN_ABSTENTION_RECALL)}`,
      )
    }
  }
  return failures
}

// The built system prompt's identity, stamped on every record. Two runs whose numbers differ are
// only comparable if this matches; when it does not, the prompt moved and the comparison is
// between two different systems.
export function promptFingerprint(prompt: string): string {
  return createHash('sha256').update(prompt, 'utf8').digest('hex').slice(0, 12)
}
