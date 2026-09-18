import type { Clock } from '../auth/clock.js'
import { searchableWords } from './hebrew-text.js'

// The company's own public site, read live at question time.
//
// Staff ask the assistant what any customer can look up: when a branch closes, whether it is
// kosher and under whom, what the club rules say. None of that lives in the Drive documents or in
// the app's tables, so the question used to fall through to a generic paid web search and hope
// Google surfaced burgersbar.co.il rather than a delivery app or an old review.
//
// The site is WordPress and hands out clean feeds (branches, products, pages), each row with a
// title and a link, and robots.txt allows everything. So this lists the feeds, cached for an hour
// at three small requests, and fetches the one or two matching pages when someone asks. Nothing is
// stored: always fresh, no sync job, no migration, no copy of the client's site to keep in step.
//
// What it cannot do is answer across every branch at once ("which branches open after midnight")
// without reading 45 pages. If staff turn out to ask that, a stored mirror is the next step, and
// nothing here is wasted by it.

export type WebsiteKind = 'branch' | 'product' | 'page'

export interface WebsiteEntry {
  kind: WebsiteKind
  title: string
  url: string
}

export type WebsiteLookup =
  // The matching page or two, read a moment ago.
  | { status: 'ok'; pages: { entry: WebsiteEntry; text: string }[] }
  // A menu question. Product pages carry a name and nothing else (checked 2026-09-17: no
  // description, no price), so the names are the whole answer and no page is fetched. The matched
  // entries keep their addresses, so the answer can carry a chip to the item's page.
  | { status: 'menu'; matched: WebsiteEntry[]; all: string[] }
  // Nothing matched. The titles that do exist ride along so the model can ask instead of guessing,
  // the menu included (2026-09-18): "vegan" is no item's name, and without the names in front of
  // it the model said the site had nothing, while it lists Beyond and Portobello.
  | { status: 'empty'; known: { branches: string[]; pages: string[]; products: string[] } }
  | { status: 'failed'; reason: string }

// Every branch, or every item, as the archive page lists them (2026-09-18): the feeds hold the
// whole list, and a lookup built for one name at a time was the only door to it, so "how many
// branches are on the site" got "I cannot count them".
export type WebsiteList =
  | { status: 'ok'; url: string; titles: string[] }
  | { status: 'failed'; reason: string }

export interface CompanyWebsiteReader {
  lookup(query: string): Promise<WebsiteLookup>
  list(kind: 'branch' | 'product'): Promise<WebsiteList>
}

interface ReaderConfig {
  baseUrl: string
  fetchImpl: typeof fetch
  clock: Clock
  timeoutMs: number
}

// A guest on the client's site says who it is and who to write to.
const USER_AGENT =
  'BurgersBarStaffApp/1.0 (internal staff assistant; contact info@clix-solution.com)'

const FEED_TTL_MS = 60 * 60 * 1_000
const MAX_PAGES_PER_LOOKUP = 2
const MAX_PAGE_CHARS = 4_000

// The post-submission page is on the pages feed and answers no question anyone will ask.
const SKIPPED_SLUGS = new Set(['thank-you'])

const FEEDS: { path: string; kind: WebsiteKind }[] = [
  { path: 'branches', kind: 'branch' },
  { path: 'products', kind: 'product' },
  { path: 'pages', kind: 'page' },
]

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

const decodeEntities = (text: string): string =>
  text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (whole, name: string) => ENTITIES[name.toLowerCase()] ?? whole)

// The readable text of a page, without the site around it. The header, footer, navigation and the
// contact form repeat on every page and would drown the ten lines that matter, and the site prints
// most blocks twice (desktop and mobile), so a repeated line is kept once.
export function extractPageText(html: string): string {
  const stripped = html
    .replace(
      /<(script|style|noscript|svg|header|footer|nav|form|title)\b[^>]*>[\s\S]*?<\/\1>/gi,
      ' ',
    )
    .replace(/<[^>]+>/g, '\n')
  const seen = new Set<string>()
  const lines: string[] = []
  for (const raw of decodeEntities(stripped).split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (line.length < 2 || seen.has(line)) continue
    seen.add(line)
    lines.push(line)
  }
  return lines.join('\n').slice(0, MAX_PAGE_CHARS)
}

// How many of the query's words a title carries, prefix-folded on both sides so "in Eilat" finds
// "Eilat". Zero means no match at all.
const titleScore = (queryWords: string[], title: string): number => {
  const titleWords = new Set(searchableWords(title))
  return queryWords.filter((word) => titleWords.has(word)).length
}

export function createCompanyWebsiteReader(config: ReaderConfig): CompanyWebsiteReader {
  let cache: { at: number; entries: WebsiteEntry[] } | null = null

  const get = async (url: string): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      return await config.fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  const loadEntries = async (): Promise<WebsiteEntry[]> => {
    const now = config.clock.now().getTime()
    if (cache && now - cache.at < FEED_TTL_MS) return cache.entries
    const entries: WebsiteEntry[] = []
    for (const feed of FEEDS) {
      const response = await get(
        `${config.baseUrl}/wp-json/wp/v2/${feed.path}?per_page=100&_fields=slug,link,title`,
      )
      if (!response.ok) throw new Error(`the ${feed.path} feed answered ${response.status}`)
      const rows = (await response.json()) as {
        slug?: string
        link?: string
        title?: { rendered?: string }
      }[]
      for (const row of rows) {
        if (!row.link || !row.title?.rendered || SKIPPED_SLUGS.has(row.slug ?? '')) continue
        entries.push({
          kind: feed.kind,
          title: decodeEntities(row.title.rendered),
          url: row.link,
        })
      }
    }
    cache = { at: now, entries }
    return entries
  }

  return {
    lookup: async (query) => {
      try {
        const entries = await loadEntries()
        const queryWords = [...new Set(searchableWords(query))]
        const scored = entries
          .map((entry) => ({ entry, score: titleScore(queryWords, entry.title) }))
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score || a.entry.title.length - b.entry.title.length)

        const readable = scored.filter((row) => row.entry.kind !== 'product')
        if (readable.length > 0) {
          // Only the matches that did as well as the best one. "Ben Yehuda" also scores a point
          // against a branch on David Ben Gurion boulevard, through the everyday word "ben"; a
          // weaker match is a wasted request against the client's site and a page of noise for the
          // model. Two Eilat branches tie, and both are worth reading.
          const best = readable[0]?.score ?? 0
          const chosen = readable.filter((row) => row.score === best).slice(0, MAX_PAGES_PER_LOOKUP)
          const pages = await Promise.all(
            chosen.map(async ({ entry }) => {
              const response = await get(entry.url)
              if (!response.ok) throw new Error(`the page answered ${response.status}`)
              return { entry, text: extractPageText(await response.text()) }
            }),
          )
          return { status: 'ok', pages }
        }

        const products = entries.filter((entry) => entry.kind === 'product')
        const matchedProducts = scored.filter((row) => row.entry.kind === 'product')
        if (matchedProducts.length > 0) {
          return {
            status: 'menu',
            matched: matchedProducts.map((row) => row.entry),
            all: products.map((entry) => entry.title),
          }
        }

        return {
          status: 'empty',
          known: {
            branches: entries
              .filter((entry) => entry.kind === 'branch')
              .map((entry) => entry.title),
            pages: entries.filter((entry) => entry.kind === 'page').map((entry) => entry.title),
            products: products.map((entry) => entry.title),
          },
        }
      } catch (error) {
        // Down, slow, or answering nonsense. The assistant says it could not reach the site; it
        // never guesses what the page would have said.
        return { status: 'failed', reason: error instanceof Error ? error.message : 'unreachable' }
      }
    },
    list: async (kind) => {
      try {
        const entries = await loadEntries()
        const feed = FEEDS.find((candidate) => candidate.kind === kind) as (typeof FEEDS)[number]
        return {
          status: 'ok',
          url: `${config.baseUrl}/${feed.path}/`,
          titles: entries.filter((entry) => entry.kind === kind).map((entry) => entry.title),
        }
      } catch (error) {
        return { status: 'failed', reason: error instanceof Error ? error.message : 'unreachable' }
      }
    },
  }
}
