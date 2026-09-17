import { SOURCES_PREFIX } from './grounding.js'
import type { LlmMessage } from './llm-client.js'
import type { DraftForReview, DraftReview, ToolTraceEntry } from './tool-loop.js'

// The guard for an answer that names a source it never received.
//
// On 2026-09-17 the assistant was caught seven times in the evaluation records, and once by the
// owner on production, writing "according to <a site>" with no search run and no page opened. On
// production the site was not even about the company, and the opening hours it "cited" were wrong
// for three days of the week. Two prompt rules did not stop it (#394), and they cannot: Google
// documents that with its native search the model alone decides whether to search, and no request
// setting forces one. So the check has to sit outside the model, in code, after the draft exists.
//
// The chips under an answer were never the problem. They are built by the server from what ran,
// and the model cannot forge one. The claim lives in the prose, where nothing was looking.
//
// This is deliberately much narrower than fabricatedWebSource in eval-scoring.ts. That one flags
// any domain or the bare word "site" and is read by a person, who shrugs at a false alarm. This
// one buys a second model call when it trips, so it trips only on an attribution ("according to
// X"), only when X is nowhere in what the answer was actually given, and never once a search ran.
//
// Every Hebrew character in this file is a codepoint escape, never a literal: a regex is where an
// invisible mark or a look-alike letter changes behaviour without changing how the line reads.

export interface SourceGuardDraft {
  // The draft as the model wrote it, SOURCES trailer and all.
  content: string
  // Everything the model was shown for this answer: the prompt, the replayed history, the
  // question, and every tool turn.
  messages: LlmMessage[]
  trace: ToolTraceEntry[]
  // Whether a web search ran for this answer: a cited page, or a billed search.
  webSearched: boolean
}

export interface UnbackedAttribution {
  // "domain": a named site, as in "according to example.co.il". "site": the word alone, as in
  // "according to several news sites", which is the tell when outlets are named in words.
  kind: 'domain' | 'site'
  // The exact words in the draft.
  quote: string
  start: number
  end: number
}

// A hostname as it appears in prose, with the path when one is written out. The lookbehind keeps
// an email address from reading as a website and stops a match from starting halfway through a
// longer name. A path ends before a closing bracket, a quote or a comma, and never on the full
// stop that ends the sentence.
const DOMAIN =
  /(?<![@\w.])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:il|com|org|net|news|info|io|gov|edu)\b(?:\/(?:[^\s)\]"'*,;]*[^\s)\]"'*,;.!?:])?)?/gi
const DOMAIN_ANYWHERE = new RegExp(DOMAIN.source, 'i')

// The words that claim "this came from there", each anchored to the END of the text before a
// domain, so only a domain named directly by the claim counts. "The usual reference is
// kolzchut.org.il" is a pointer, and pointing at a site is the helpful thing to do when the web
// could not be checked; "according to kolzchut.org.il" says it was read. The scheme and any
// opening mark (a bracket, a quote, bold) may sit between the claim and the name.
const EN_LEAD =
  /(?:\b(?:according to|as per|based on|as reported (?:by|on|in)|reported (?:by|on|in)|cited (?:by|in|on)|published (?:by|on|in)|as stated (?:by|on|in))\s+|\bsources?:\s*)(?:(?:the|an?|its|their)\s+)?(?:(?:official\s+)?(?:web ?)?sites?\s+(?:of\s+)?)?(?:https?:\/\/)?[(["'*_]*$/i

// lefi, al pi, the abbreviation, and "source:", each optionally wearing "and" or "that" as a
// one-letter prefix, then optionally "the site (of)". The lookbehind matters: "alfei" (thousands
// of) contains "lefi". The prefix kaf is deliberately not allowed: "klapei" means "towards".
const HE_LEAD =
  /(?<![\u05d0-\u05ea])(?:[\u05d5\u05e9]?\u05dc\u05e4\u05d9|[\u05d5\u05e9]?\u05e2\u05dc[ \u05be-]\u05e4\u05d9|\u05e2\u05e4["\u05f4]\u05d9|\u05de\u05e7\u05d5\u05e8(?:\u05d5\u05ea)?:)\s*(?:\u05d4?\u05d0\u05ea\u05e8(?:\s+\u05d4\u05d0\u05d9\u05e0\u05d8\u05e8\u05e0\u05d8)?\s+(?:\u05e9\u05dc\s+)?)?(?:https?:\/\/)?[(["'*_]*$/

// What may stand between two sites named in one breath: a comma, "and", "or", an ampersand, or
// the Hebrew "ve" with or without its hyphen.
const JOIN =
  /^(?:\s*,\s*|\s*,?\s+(?:and|or|as well as)\s+|\s*&\s*|\s*,?\s+\u05d5-?|\s*,?\s+(?:\u05d5\u05d2\u05dd|\u05d0\u05d5)\s+)$/i

// The same claim with no domain at all: "according to several news sites", "lefi atarim". The
// word has to end the phrase: "the site manager", "the site visit" and "the site plan" are a
// place, and the chain opens branches, so that prose is in scope. The Hebrew needs the cue in
// front of it, because the bare letters of "site" also spell the verb "to locate", which every
// honest "I could not find it" uses; and a site of building, work or an event is a place too.
const EN_SITE =
  /\b(?:according to|as per|based on|as reported (?:by|on|in)|reported (?:by|on|in)|cited (?:by|in|on)|published (?:by|on|in)|as stated (?:by|on|in))\s+(?:[a-z-]+\s+){0,3}?(?:web ?)?sites?(?=\s*(?:[,.;:!?)\]]|$)|\s+(?:such as|like|including|of)\b)/gi
const HE_SITE =
  /(?<![\u05d0-\u05ea])(?:[\u05d5\u05e9]?\u05dc\u05e4\u05d9|[\u05d5\u05e9]?\u05e2\u05dc[ \u05be-]\u05e4\u05d9|\u05e2\u05e4["\u05f4]\u05d9)\s+\u05d4?\u05d0\u05ea\u05e8(?:\u05d9\u05dd|\u05d9)?(?![\u05d0-\u05ea])(?!\s+\u05d4?(?:\u05d1\u05e0\u05d9\u05d9?\u05d4|\u05d4\u05e7\u05de\u05d4|\u05e2\u05d1\u05d5\u05d3(?:\u05d4|\u05d5\u05ea)|\u05e4\u05e8\u05d5\u05d9\u05e7\u05d8|\u05e9\u05d9\u05e4\u05d5\u05e5|\u05e9\u05d9\u05e4\u05d5\u05e6\u05d9\u05dd|\u05d0\u05d9\u05e8\u05d5\u05e2|\u05e6\u05d9\u05dc\u05d5\u05dd|\u05e6\u05d9\u05dc\u05d5\u05de\u05d9\u05dd|\u05e0\u05d5\u05e4\u05e9|\u05e7\u05de\u05e4\u05d9\u05e0\u05d2|\u05de\u05d5\u05e8\u05e9\u05ea|\u05d4\u05e0\u05e6\u05d7\u05d4|\u05e7\u05d1\u05d5\u05e8\u05d4|\u05d0\u05e1\u05d5\u05df|\u05ea\u05d0\u05d5\u05e0\u05d4|\u05e9\u05e8\u05d9\u05e4\u05d4)(?![\u05d0-\u05ea]))/g

// Whether the material mentions any site at all, in either language.
const SITE_WORD = /(?:web ?)?sites?\b|\u05d0\u05ea\u05e8/i

// Where the prose ends and the SOURCES trailer begins. The trailer names documents and is parsed
// by extractSources; nothing in it is a claim the reader sees.
const proseEnd = (content: string): number => {
  const lines = content.split('\n')
  let last = lines.length - 1
  while (last >= 0 && lines[last]?.trim() === '') last -= 1
  if (last < 0) return content.length
  if (!(lines[last] as string).trim().toUpperCase().startsWith(SOURCES_PREFIX)) {
    return content.length
  }
  return lines.slice(0, last).join('\n').length
}

// Everything the answer legitimately had in front of it, as one lowercase haystack: the questions,
// every tool result, and the sources a tool attached. Two things are left out on purpose. The
// system prompt names sites to prefer when searching, which is advice, not material, and an
// answer that says "according to gov.il" because the prompt mentioned gov.il has read nothing.
// And the model's own words, in this answer or an earlier one, are never material: counted, a
// rejected draft's site would be "backed" by the tool-call turn that said "let me re-check that
// site", and one invention would back every repeat of it for the life of a thread.
const materialOf = (draft: SourceGuardDraft): string =>
  [
    ...draft.messages
      .filter((message) => message.role === 'user' || message.role === 'tool')
      .map((message) => message.content),
    ...draft.trace.flatMap((entry) =>
      entry.sources.flatMap((source) => [source.id, source.title, source.url ?? '']),
    ),
  ]
    .join('\n')
    .toLowerCase()

// How far back from a domain its cue can sit: the longest lead is about forty characters. Only
// that much is searched, because an end-anchored pattern run over a whole long answer, once per
// domain, is wasted work on the one path every production answer goes through.
const LEAD_WINDOW = 160

const hostOf = (domain: string): string =>
  (domain.split('/')[0] as string).toLowerCase().replace(/^www\./, '')

// The closing mark that pairs with each opening mark a lead may have swallowed, so that
// "**kolzchut.org.il**" and "(kolzchut.org.il)" are cut whole and leave no orphan behind.
const CLOSER: Record<string, string> = { '(': ')', '[': ']', '*': '*', '"': '"', "'": "'", _: '_' }

const closeMarks = (prose: string, from: number, lead: string): number => {
  const openers = /[(["'*_]*$/.exec(lead)?.[0] ?? ''
  let end = from
  for (const opener of [...openers].reverse()) {
    if (prose[end] === CLOSER[opener]) end += 1
  }
  return end
}

interface Scan {
  found: UnbackedAttribution[]
  // A site nothing backs that sits OUTSIDE every attribution found. It is not a claim, so it is
  // not reported, but its presence means the sentence is not the simple shape that is safe to cut.
  strays: number
}

// One claim may name several sites in one breath ("according to X and Y"). It is one attribution,
// judged as a whole: unbacked if any site in it is, and cut as a whole, because cutting one name
// out of the middle leaves "according to X and," behind.
interface Chain {
  start: number
  end: number
  unbacked: boolean
}

const scanDomains = (prose: string, material: string): Scan => {
  const found: UnbackedAttribution[] = []
  let strays = 0
  let chain: Chain | null = null
  const close = (): void => {
    if (chain?.unbacked) {
      found.push({
        kind: 'domain',
        quote: prose.slice(chain.start, chain.end),
        start: chain.start,
        end: chain.end,
      })
    }
    chain = null
  }
  for (const match of prose.matchAll(DOMAIN)) {
    const start = match.index
    const domainEnd = start + match[0].length
    const backed = material.includes(hostOf(match[0]))
    const windowStart = Math.max(0, start - LEAD_WINDOW)
    const before = prose.slice(windowStart, start)
    const lead = EN_LEAD.exec(before) ?? HE_LEAD.exec(before)
    if (lead !== null) {
      close()
      chain = {
        start: windowStart + lead.index,
        end: closeMarks(prose, domainEnd, lead[0]),
        unbacked: !backed,
      }
    } else if (chain !== null && JOIN.test(prose.slice(chain.end, start))) {
      chain.end = domainEnd
      chain.unbacked = chain.unbacked || !backed
    } else {
      close()
      if (!backed) strays += 1
    }
  }
  close()
  return { found, strays }
}

const STARTS_WITH_DOMAIN = new RegExp(`^\\s*(?:${DOMAIN.source})`, 'i')

const scanSiteWords = (prose: string): UnbackedAttribution[] => {
  const found: UnbackedAttribution[] = []
  for (const pattern of [EN_SITE, HE_SITE]) {
    for (const match of prose.matchAll(pattern)) {
      const start = match.index
      const end = start + match[0].length
      // "According to the site example.co.il" was already judged as a domain, backed or not.
      if (STARTS_WITH_DOMAIN.test(prose.slice(end))) continue
      found.push({ kind: 'site', quote: match[0], start, end })
    }
  }
  return found
}

const scan = (draft: SourceGuardDraft): Scan => {
  // A search that ran is the end of what can be checked here. What Google's engine showed the
  // model is not handed to us page by page, so a site named after a search may well have been
  // read, and a guess in the other direction would punish the answers that did the right thing.
  if (draft.webSearched) return { found: [], strays: 0 }
  const prose = draft.content.slice(0, proseEnd(draft.content))
  const material = materialOf(draft)
  const domains = scanDomains(prose, material)
  // "According to the company site" is true once something the model was given mentions a site
  // or names one, and cannot be told apart from an invention when it does. With no site anywhere
  // in the material it can only be one.
  const siteMentioned = SITE_WORD.test(material) || DOMAIN_ANYWHERE.test(material)
  const sites = siteMentioned ? [] : scanSiteWords(prose)
  return {
    found: [...domains.found, ...sites].sort((a, b) => a.start - b.start),
    strays: domains.strays,
  }
}

export function unbackedAttributions(draft: SourceGuardDraft): UnbackedAttribution[] {
  return scan(draft).found
}

// What the model is told when its draft trips the guard. Written by the server, sent as a user
// turn because that is the one role every provider replays faithfully mid-conversation, and
// marked so the model does not take it for the person speaking. The only model-written text in it
// is the quote, which the patterns above limit to a hostname or a handful of plain words.
export function repairInstruction(found: UnbackedAttribution[], canSearch: boolean): string {
  const named = found.map((attribution) => `"${attribution.quote}"`).join(', ')
  const options = canSearch
    ? 'Either run the web search now and answer from what it returns, or answer from your own knowledge'
    : 'No web search is available now, so answer from your own knowledge'
  return [
    '[Automatic source check by the app. The person you are talking to did not write this and will not see it.]',
    `Your draft says ${named}. At least one site named there is one you received nothing from for this answer: no web search ran, and no result you were given names it. So that attribution is not true.`,
    'Write the whole answer again, in the language of the question.',
    `${options}. If you answer from your own knowledge: name no site, write no "as of <date>", and say in one short clause that it is from general knowledge and may be out of date.`,
    `Do not mention this check. End with the ${SOURCES_PREFIX} line as before.`,
  ].join('\n')
}

// The Hebrew reads: "Note: no website was opened for this answer. What does not come from a
// company source is based on general knowledge and may not be up to date."
const NOTE = {
  en: 'Note: no website was opened for this answer. Anything in it that does not come from a company source is from general knowledge and may be out of date.',
  he: '\u05d4\u05e2\u05e8\u05d4: \u05dc\u05d0 \u05e0\u05e4\u05ea\u05d7 \u05d0\u05e3 \u05d0\u05ea\u05e8 \u05d0\u05d9\u05e0\u05d8\u05e8\u05e0\u05d8 \u05e2\u05d1\u05d5\u05e8 \u05d4\u05ea\u05e9\u05d5\u05d1\u05d4 \u05d4\u05d6\u05d5. \u05de\u05d4 \u05e9\u05d0\u05d9\u05e0\u05d5 \u05de\u05d2\u05d9\u05e2 \u05de\u05de\u05e7\u05d5\u05e8 \u05e9\u05dc \u05d4\u05d7\u05d1\u05e8\u05d4 \u05de\u05d1\u05d5\u05e1\u05e1 \u05e2\u05dc \u05d9\u05d3\u05e2 \u05db\u05dc\u05dc\u05d9 \u05d5\u05d9\u05d9\u05ea\u05db\u05df \u05e9\u05d0\u05d9\u05e0\u05d5 \u05de\u05e2\u05d5\u05d3\u05db\u05df.',
}

const HEBREW_LETTER = /[\u05d0-\u05ea]/g
const LATIN_LETTER = /[a-z]/gi

// Which language the reader is being answered in, by counting script over the words. The account
// language is the wrong guide: an English account asking in Hebrew is answered in Hebrew. The
// domains are taken out first, or a Hebrew answer that names two sites counts as English.
const languageOf = (text: string, fallback: 'he' | 'en'): 'he' | 'en' => {
  const words = text.replace(DOMAIN, '')
  const hebrew = (words.match(HEBREW_LETTER) ?? []).length
  const latin = (words.match(LATIN_LETTER) ?? []).length
  if (hebrew + latin < 10) return fallback
  return hebrew > latin ? 'he' : 'en'
}

// What may stand in front of a claim that opens its line: a bullet or a number, a quote mark, bold
// marks, a bracket.
const LINE_OPENING = /(?:^|\n)[ \t>*+\-\d.)]*(?:\*\*|__)?[(["]?\s*$/
const SENTENCE_END = /[.!?]\s*$/
const CLAUSE_END = /[:;]\s*$/

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

// Remove one attribution from its sentence. A claim that opens its line, its sentence or its
// clause takes the punctuation after it and hands its capital to the next word; anywhere else it
// takes the comma or the space that led into it.
const cut = (text: string, attribution: UnbackedAttribution): string => {
  const before = text.slice(0, attribution.start)
  const after = text.slice(attribution.end)
  const opensLine = LINE_OPENING.test(before)
  if (opensLine || SENTENCE_END.test(before) || CLAUSE_END.test(before)) {
    const rest = after.replace(/^\s*[,.!?;:]?\s*/, '')
    return before + (opensLine || SENTENCE_END.test(before) ? capitalise(rest) : rest)
  }
  return before.replace(/\s*,?\s*$/, '') + after
}

// The last resort, for a draft that was sent back once and still names what it never read (or
// that could not be sent back at all, because the time budget was spent). The reader is never
// shown an attribution the server knows to be untrue without being told so.
//
// A named site is cut out only where that is safe: every finding a plain "according to <site>",
// and no other unbacked site left in the text for the cut to orphan. Anything less tidy is left
// as written, because a regex editing prose in two languages garbles it sooner or later, and the
// note below carries the truth either way.
export function withoutUnbackedAttributions(
  draft: SourceGuardDraft,
  fallbackLanguage: 'he' | 'en',
): string {
  const { found, strays } = scan(draft)
  if (found.length === 0) return draft.content
  const end = proseEnd(draft.content)
  const prose = draft.content.slice(0, end)
  const trailer = draft.content.slice(end)
  const safeToCut = strays === 0 && found.every((attribution) => attribution.kind === 'domain')
  const body = safeToCut
    ? [...found]
        .reverse()
        .reduce(cut, prose)
        .replace(/\s*[([]\s*[)\]]/g, '')
        .replace(/(\S)[ \t]{2,}/g, '$1 ')
    : prose
  return `${body.trimEnd()}\n\n${NOTE[languageOf(body, fallbackLanguage)]}${trailer}`
}

// One guard for one answer: the hook the tool loop calls on each finished draft, and the last word
// on what the reader is shown. The two halves share one instance because the fallback has to judge
// the draft against exactly what the reviewer was shown, tool results included, and the loop keeps
// that conversation to itself. The answer path and the evaluation both build one per answer, so an
// eval run grades the guarded system a reader actually meets.
export interface SourceGuard {
  review: DraftReview
  // The loop's answer as it stands, unless the loop marked it 'unrepaired': then the fallback.
  settle(
    outcome: { content: string; review?: 'repaired' | 'unrepaired' },
    fallbackLanguage: 'he' | 'en',
  ): string
}

export function createSourceGuard(): SourceGuard {
  let lastReviewed: DraftForReview | null = null
  return {
    review: (draft) => {
      lastReviewed = draft
      const found = unbackedAttributions(draft)
      return found.length === 0 ? null : repairInstruction(found, draft.canSearch)
    },
    settle: (outcome, fallbackLanguage) =>
      outcome.review === 'unrepaired' && lastReviewed?.content === outcome.content
        ? withoutUnbackedAttributions(lastReviewed, fallbackLanguage)
        : outcome.content,
  }
}
