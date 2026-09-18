import { describe, expect, it, vi } from 'vitest'
import { createCompanyWebsiteReader, extractPageText } from '../src/assistant/company-website.js'

// The company's own public site, read live (2026-09-17).
//
// Staff ask the assistant what any customer can look up: when a branch closes, whether it is
// kosher and under whom, what the club rules say. None of that lives in the Drive documents or in
// the app's tables, so until now the question fell through to a generic paid web search and hoped
// Google surfaced burgersbar.co.il rather than a delivery app or an old review.
//
// The site is WordPress and hands out clean feeds: 45 branches, 53 products, 11 pages, each with
// a modified date, and robots.txt allows everything. So the reader lists the feeds (cached for an
// hour, three small requests) and fetches the one or two matching pages at question time. Nothing
// is stored: always fresh, no sync job, no migration, and no copy of the client's site to keep.
//
// Product pages carry a name and nothing else (checked: no description, no price), so the menu is
// served as the list of names and a product page is never fetched.

const BASE = 'https://burgersbar.example'

const feed = (rows: { title: string; slug: string }[], kind: string) =>
  rows.map((row, index) => ({
    id: index + 1,
    slug: row.slug,
    link: `${BASE}/${kind}/${row.slug}/`,
    title: { rendered: row.title },
    modified: '2026-07-14T06:31:30',
  }))

const BRANCHES = feed(
  [
    { title: 'אילת ביג', slug: 'eilat-big' },
    { title: 'אילת פנינה', slug: 'eilat-pnina' },
    { title: 'באר שבע', slug: 'beer-sheva' },
  ],
  'branches',
)
const PRODUCTS = feed(
  [
    { title: 'פסטו', slug: 'pesto' },
    { title: "צ'ימיצ'ורי", slug: 'chimichurri' },
  ],
  'products',
)
const PAGES = feed([{ title: 'אירועים', slug: 'events' }], 'pages')

// A branch page as the real site renders it: the facts sit between a header full of navigation
// and a footer, a popup form and social links, most of it printed twice (desktop and mobile).
const BRANCH_HTML = `<!doctype html><html><head><title>Eilat - Burgers Bar</title>
<style>.x{color:red}</style><script>var tracking = 'noise'</script></head><body>
<header><nav><a>ראשי</a><a>תפריט</a></nav><a>EN</a></header>
<div class="elementor">
  <h1>אילת ביג</h1>
  <h3>כשרות</h3><p>בד"ץ יורה דעה</p>
  <h3>שעות פעילות</h3>
  <p>א'-ד': 11:00-23:00</p><p>ו': 11:00-15:00</p>
  <p>א'-ד': 11:00-23:00</p>
</div>
<form><label>שם</label><input><button>שליחה</button></form>
<footer><nav><a>צור קשר</a></nav><p>&copy; Burgers Bar</p></footer>
</body></html>`

interface Call {
  url: string
  headers: Record<string, string>
}

const site = (over: { failAll?: boolean; pageHtml?: string } = {}) => {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    if (over.failAll) throw new Error('site down')
    if (url.includes('/wp-json/wp/v2/branches')) return Response.json(BRANCHES)
    if (url.includes('/wp-json/wp/v2/products')) return Response.json(PRODUCTS)
    if (url.includes('/wp-json/wp/v2/pages')) return Response.json(PAGES)
    return new Response(over.pageHtml ?? BRANCH_HTML, { status: 200 })
  })
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch }
}

const readerAt = (fetchImpl: typeof fetch, now = { value: new Date('2026-09-17T09:00:00Z') }) => ({
  now,
  reader: createCompanyWebsiteReader({
    baseUrl: BASE,
    fetchImpl,
    clock: { now: () => now.value },
    timeoutMs: 2_000,
  }),
})

describe('finding the page a question is about', () => {
  it('finds a branch by its name and reads the page live', async () => {
    const { fetchImpl } = site()
    const { reader } = readerAt(fetchImpl)
    const result = await reader.lookup('באר שבע')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.pages).toHaveLength(1)
    expect(result.pages[0]?.entry.url).toBe(`${BASE}/branches/beer-sheva/`)
    expect(result.pages[0]?.text).toContain('11:00-23:00')
  })

  // "in Eilat" wears a one-letter prefix in Hebrew, and a raw match against the branch name
  // fails on that single letter. The same fold the people search uses.
  it('finds a branch through a Hebrew prefix', async () => {
    const { fetchImpl } = site()
    const { reader } = readerAt(fetchImpl)
    const result = await reader.lookup('באילת')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.pages.map((page) => page.entry.title)).toEqual(['אילת ביג', 'אילת פנינה'])
  })

  // Found on the first live lookup (2026-09-17): "Ben Yehuda" also pulled in Mitzpe Ramon, which
  // sits on David Ben Gurion boulevard, because the two share the everyday word "ben". A weaker
  // match is a wasted request against the client's site and a page of noise for the model, so a
  // second page rides along only when it matched as well as the first.
  it('does not read a weaker match alongside a clear winner', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/wp-json/wp/v2/branches')) {
        return Response.json(
          feed(
            [
              { title: 'ירושלים / בן יהודה 2', slug: 'ben-yehuda' },
              { title: 'מצפה רמון / דוד בן גוריון', slug: 'mitzpe' },
            ],
            'branches',
          ),
        )
      }
      if (url.includes('/wp-json/')) return Response.json([])
      return new Response(BRANCH_HTML, { status: 200 })
    })
    const { reader } = readerAt(fetchImpl as unknown as typeof fetch)
    const result = await reader.lookup('בן יהודה')
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.pages.map((page) => page.entry.url)).toEqual([`${BASE}/branches/ben-yehuda/`])
    expect(calls.some((url) => url.includes('/branches/mitzpe'))).toBe(false)
  })

  it('reads at most two pages, however many titles match', async () => {
    const { fetchImpl, calls } = site()
    const { reader } = readerAt(fetchImpl)
    await reader.lookup('אילת')
    const pageFetches = calls.filter((call) => !call.url.includes('/wp-json/'))
    expect(pageFetches.length).toBeLessThanOrEqual(2)
  })

  it('says which branches exist when nothing matches, so the model can ask', async () => {
    const { fetchImpl } = site()
    const { reader } = readerAt(fetchImpl)
    const result = await reader.lookup('טבריה')
    expect(result.status).toBe('empty')
    if (result.status !== 'empty') return
    expect(result.known.branches).toContain('באר שבע')
  })
})

describe('the menu', () => {
  // A product page holds a name and nothing else. Fetching one buys a second of latency and a
  // request against the client's site for no facts at all.
  it('answers from the list of names and never fetches a product page', async () => {
    const { fetchImpl, calls } = site()
    const { reader } = readerAt(fetchImpl)
    const result = await reader.lookup('פסטו')
    expect(result.status).toBe('menu')
    if (result.status !== 'menu') return
    // The page is not fetched, but its address rides along: a menu answer used to carry no chip
    // at all (2026-09-18), and a chip to the item's page is the one honest link there is.
    expect(result.matched).toEqual([
      { kind: 'product', title: 'פסטו', url: expect.stringContaining('/products/pesto') },
    ])
    expect(result.all).toHaveLength(2)
    expect(calls.some((call) => call.url.includes('/products/pesto'))).toBe(false)
  })

  // Found on production 2026-09-18: "is there a vegan option?" matched no item name, because no
  // item is called "vegan", and the miss handed back branches and pages but not the menu. The
  // model never saw that the site lists Beyond and Portobello, and said there was nothing. A
  // colleague who knows the menu judges from the names; the model can too, if it sees them.
  it('hands the whole menu back when no item name matches, so the model can judge', async () => {
    const { fetchImpl } = site()
    const { reader } = readerAt(fetchImpl)
    const result = await reader.lookup('טבעוני')
    expect(result.status).toBe('empty')
    if (result.status !== 'empty') return
    expect(result.known.products).toEqual(['פסטו', "צ'ימיצ'ורי"])
  })
})

// "How many branches are on the website?" (2026-09-18). The feeds already hold every branch and
// every item; a lookup was the only door, and it was built for one name at a time, so the model
// told the reader it could not count. The list is the archive page's content, and its address.
describe('listing what the site has', () => {
  it('lists every branch with the archive page it comes from, fetching no branch page', async () => {
    const { fetchImpl, calls } = site()
    const { reader } = readerAt(fetchImpl)
    const result = await reader.list('branch')
    expect(result).toEqual({
      status: 'ok',
      url: `${BASE}/branches/`,
      titles: ['אילת ביג', 'אילת פנינה', 'באר שבע'],
    })
    expect(calls.every((call) => call.url.includes('/wp-json/'))).toBe(true)
  })

  it('lists the menu the same way', async () => {
    const { reader } = readerAt(site().fetchImpl)
    const result = await reader.list('product')
    expect(result).toEqual({
      status: 'ok',
      url: `${BASE}/products/`,
      titles: ['פסטו', "צ'ימיצ'ורי"],
    })
  })

  it('reports the site as unreachable rather than throwing', async () => {
    const { reader } = readerAt(site({ failAll: true }).fetchImpl)
    const result = await reader.list('branch')
    expect(result.status).toBe('failed')
  })
})

describe('being a polite guest on the client site', () => {
  it('lists the feeds once and reuses them for an hour', async () => {
    const { fetchImpl, calls } = site()
    const { reader, now } = readerAt(fetchImpl)
    await reader.lookup('באר שבע')
    await reader.lookup('אילת')
    const feedCalls = () => calls.filter((call) => call.url.includes('/wp-json/')).length
    expect(feedCalls()).toBe(3)

    now.value = new Date('2026-09-17T10:01:00Z')
    await reader.lookup('באר שבע')
    expect(feedCalls()).toBe(6)
  })

  it('names itself and a contact on every request', async () => {
    const { fetchImpl, calls } = site()
    const { reader } = readerAt(fetchImpl)
    await reader.lookup('באר שבע')
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.headers['User-Agent']).toMatch(/BurgersBarStaffApp/)
    }
  })

  it('reports the site as unreachable rather than throwing', async () => {
    const { fetchImpl } = site({ failAll: true })
    const { reader } = readerAt(fetchImpl)
    const result = await reader.lookup('באר שבע')
    expect(result.status).toBe('failed')
  })
})

describe('extractPageText', () => {
  it('keeps the facts', () => {
    const text = extractPageText(BRANCH_HTML)
    expect(text).toContain('שעות פעילות')
    expect(text).toContain("ו': 11:00-15:00")
    expect(text).toContain('בד"ץ יורה דעה')
  })

  it('drops the navigation, the form, the footer, scripts and styles', () => {
    const text = extractPageText(BRANCH_HTML)
    expect(text).not.toContain('תפריט')
    expect(text).not.toContain('שליחה')
    expect(text).not.toContain('צור קשר')
    expect(text).not.toContain('tracking')
    expect(text).not.toContain('color:red')
  })

  // The site prints most blocks twice, once for desktop and once for mobile.
  it('prints a repeated line once', () => {
    const text = extractPageText(BRANCH_HTML)
    expect(text.split("א'-ד': 11:00-23:00").length - 1).toBe(1)
  })

  it('decodes entities', () => {
    expect(extractPageText('<p>Fish &amp; chips &#8211; daily</p>')).toBe('Fish & chips – daily')
  })

  it('caps a very long page', () => {
    const long = `<p>${'word '.repeat(5_000)}</p>`
    expect(extractPageText(long).length).toBeLessThanOrEqual(4_000)
  })
})
