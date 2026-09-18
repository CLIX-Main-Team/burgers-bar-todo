import { describe, expect, it } from 'vitest'
import type { LlmMessage } from '../src/assistant/llm-client.js'
import {
  type SourceGuardDraft,
  createSourceGuard,
  repairInstruction,
  unbackedAttributions,
  withoutUnbackedAttributions,
} from '../src/assistant/source-guard.js'
import type { ToolTraceEntry } from '../src/assistant/tool-loop.js'

// The guard for an answer that names a source it never received (2026-09-17).
//
// Every positive case below is a real answer, copied from the evaluation records of 2026-09-17 or
// from the production thread the owner caught the same day: no tool ran, no search ran, and the
// answer still said where the figure "came from". Every negative case is a shape the first,
// looser detector (fabricatedWebSource in eval-scoring) would have raised a false alarm on, which
// is tolerable in a report a person reads and not in a check that buys a second model call.

const question = (content: string): LlmMessage[] => [
  {
    role: 'system',
    content: 'Prefer gov.il, kolzchut.org.il and burgersbar.co.il when searching.',
  },
  { role: 'user', content },
]

const draft = (content: string, overrides: Partial<SourceGuardDraft> = {}): SourceGuardDraft => ({
  content,
  messages: question('a question'),
  trace: [],
  webSearched: false,
  citations: [],
  searchResultsListed: false,
  ...overrides,
})

// A search whose every page is handed back to us (Exa: the broker runs it and injects the pages
// as text), as opposed to Google's engine, which shows the model pages it never lists.
const searched = (content: string, citations: { url: string; title: string }[]): SourceGuardDraft =>
  draft(content, { webSearched: true, citations, searchResultsListed: true })

const quotes = (input: SourceGuardDraft): string[] =>
  unbackedAttributions(input).map((found) => found.quote)

describe('unbackedAttributions: the real answers that named a site nothing fetched', () => {
  it('catches "As of <date>, according to <domain>"', () => {
    expect(
      quotes(
        draft(
          'As of August 17, 2026, according to kolzchut.org.il, the hourly minimum wage in Israel is **35.40 NIS** (based on a 182-hour work month).\n\nSOURCES: none',
        ),
      ),
    ).toEqual(['according to kolzchut.org.il'])
  })

  it('catches two sites named in one breath, as one attribution', () => {
    expect(
      quotes(
        draft(
          'This year, Passover eve (Erev Pesach) falls on **Wednesday, April 1, 2026**, according to ynet.co.il and chabad.org (as of early 2026).',
        ),
      ),
    ).toEqual(['according to ynet.co.il and chabad.org'])
  })

  it('catches the attribution at the end of a sentence', () => {
    expect(
      quotes(
        draft(
          'This year (2026), Yom Kippur begins at sundown on Sunday, September 20, and ends at nightfall on Monday, September 21, according to hebcal.com.',
        ),
      ),
    ).toEqual(['according to hebcal.com'])
  })

  it('catches the Hebrew shape with a domain', () => {
    expect(
      quotes(
        draft(
          'שלום איל,\n\nנכון ל-21 בפברואר 2026, לפי אתר infinityfinance.co.il, שיעור המע"מ בישראל עומד על **18%** (השיעור עלה מ-17% בינואר 2025).',
        ),
      ),
    ).toEqual(['לפי אתר infinityfinance.co.il'])
  })

  it('catches the production case: a site that is not even about the company', () => {
    expect(
      quotes(draft('לפי tabitisrael.co.il, הסניף בבן יהודה פתוח בימים א-ה בין 11:00 ל-23:00.')),
    ).toEqual(['לפי tabitisrael.co.il'])
  })

  it('sees through a URL, bold marks or brackets around the site', () => {
    expect(
      quotes(
        draft(
          'As of today, according to https://www.kolzchut.org.il/he/minimum_wage, it is 35.40 NIS.',
        ),
      ),
    ).toEqual(['according to https://www.kolzchut.org.il/he/minimum_wage'])
    expect(quotes(draft('According to **kolzchut.org.il**, the wage is 35.40 NIS.'))).toEqual([
      'According to **kolzchut.org.il**',
    ])
    expect(quotes(draft('According to (kolzchut.org.il), the wage is 35.40 NIS.'))).toEqual([
      'According to (kolzchut.org.il)',
    ])
  })

  it('treats sites named in one breath as one claim, even when one of them is backed', () => {
    const trace: ToolTraceEntry[] = [
      {
        tool: 'company_website',
        status: 'ok',
        args: {},
        sources: [
          {
            id: 'https://burgersbar.co.il/branches/ben-yehuda/',
            title: 'Ben Yehuda',
            type: 'website',
            url: 'https://burgersbar.co.il/branches/ben-yehuda/',
          },
        ],
      },
    ]
    expect(
      quotes(
        draft('According to burgersbar.co.il and ynet.co.il, the branch is open until 23:00.', {
          trace,
        }),
      ),
    ).toEqual(['According to burgersbar.co.il and ynet.co.il'])
    expect(
      quotes(
        draft('According to ynet.co.il and burgersbar.co.il, the branch is open until 23:00.', {
          trace,
        }),
      ),
    ).toEqual(['According to ynet.co.il and burgersbar.co.il'])
  })

  it('reports where the claim sits, however far into a long answer it is', () => {
    const opening = 'The rate has changed several times over the years. '.repeat(12)
    const content = `${opening}As of today, according to kolzchut.org.il, it is 35.40 NIS.`
    const [found] = unbackedAttributions(draft(content))
    expect(found?.quote).toBe('according to kolzchut.org.il')
    expect(content.slice(found?.start, found?.end)).toBe('according to kolzchut.org.il')
  })

  it('catches outlets named in words, where "site" is the only tell', () => {
    expect(
      quotes(
        draft(
          'נכון לשנת 2026, לפי אתר כלכליסט (ואתרים נוספים כמו אין סוף פיננסים), שיעור המע"מ בישראל עומד על **18%**.',
        ),
      ),
    ).toEqual(['לפי אתר'])
    expect(
      quotes(
        draft(
          'נכון לשנת 2026, שיעור המע"מ בישראל עומד על **18%** (לפי אתרים כמו כלכליסט ולשכת המסחר, המס עלה מ-17% ל-18% ב-1 בינואר 2025).',
        ),
      ),
    ).toEqual(['לפי אתרים'])
    expect(quotes(draft('VAT is 18%, according to several news sites such as Calcalist.'))).toEqual(
      ['according to several news sites'],
    )
  })
})

// Found on production on 2026-09-17: the VAT answer said "according to trykintsugi.com" under
// four chips for other sites. Google's engine had run, so the guard looked away. With a search
// whose pages are all listed, the check is the same as with no search at all: a named site has
// to be among what was received.
describe('unbackedAttributions: after a search whose pages are all listed', () => {
  const vat = [
    { url: 'https://www.taxatlas.io/israel/vat', title: 'Israel VAT guide' },
    { url: 'https://zcpa.co.il/Article/maam-18-achuz-2026', title: 'VAT 18% in 2026' },
  ]

  it('catches a site the search never returned', () => {
    expect(
      quotes(searched('As of July 2026, according to trykintsugi.com, VAT is 18%.', vat)).join(' '),
    ).toContain('trykintsugi.com')
  })

  it('accepts a site among the pages returned, with or without www', () => {
    expect(quotes(searched('According to taxatlas.io, VAT is 18%.', vat))).toEqual([])
    expect(quotes(searched('According to zcpa.co.il, VAT is 18%.', vat))).toEqual([])
  })

  it('accepts a site a returned page names in its title', () => {
    const pages = [{ url: 'https://example.org/x', title: 'VAT explained by kolzchut.org.il' }]
    expect(quotes(searched('According to kolzchut.org.il, VAT is 18%.', pages))).toEqual([])
  })

  it('still says nothing when the pages received are not listed (the Google engine)', () => {
    expect(
      quotes(
        draft('According to trykintsugi.com, VAT is 18%.', {
          webSearched: true,
          citations: vat,
          searchResultsListed: false,
        }),
      ),
    ).toEqual([])
  })

  it('tells the model the search results are what it must answer from', () => {
    const guard = createSourceGuard({ searchResultsListed: true })
    const instruction = guard.review({
      ...searched('According to trykintsugi.com, VAT is 18%.', vat),
      canSearch: false,
    })
    expect(instruction).toContain('trykintsugi.com')
    expect(instruction).toContain('search results')
    expect(instruction).not.toContain('no web search ran')
  })

  it('leaves a note that fits: the site was not among the pages read, not "no site was opened"', () => {
    const note = withoutUnbackedAttributions(
      searched('As of July 2026, according to trykintsugi.com, VAT is 18%.', vat),
      'en',
    )
    expect(note).not.toContain('trykintsugi.com')
    expect(note).toContain('not among the pages')
    expect(note).not.toContain('no website was opened')
  })
})

describe('unbackedAttributions: what it must leave alone', () => {
  it('says nothing once a search ran, because the pages it read are not ours to list', () => {
    expect(
      quotes(
        draft('As of today, according to kolzchut.org.il, it is 35.40.', { webSearched: true }),
      ),
    ).toEqual([])
  })

  it('accepts a site the person named themselves', () => {
    expect(
      quotes(
        draft('According to ynet.co.il, as you say, the rate is 18%.', {
          messages: question('I read on ynet.co.il that VAT is 18%, is that right?'),
        }),
      ),
    ).toEqual([])
  })

  it("never takes the model's own words as backing, not an earlier answer and not its narration", () => {
    // The review of 2026-09-17 laundered an invention this way: the rejected draft named a site,
    // the second pass "re-checked" it in a tool-call turn, and that turn backed the same claim in
    // the third. One invention would also back every repeat of it for the life of a thread.
    const messages: LlmMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'What is the minimum wage?' },
      { role: 'assistant', content: 'As of today, according to kolzchut.org.il, 35.40 NIS.' },
      { role: 'user', content: 'and per month?' },
      {
        role: 'assistant',
        content: 'Let me re-check what kolzchut.org.il says.',
        toolCalls: [{ id: 'c1', name: 'my_tasks', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'c1', content: 'no tasks' },
    ]
    expect(quotes(draft('According to kolzchut.org.il, 6,443 NIS.', { messages }))).toEqual([
      'According to kolzchut.org.il',
    ])
  })

  it('accepts a site a tool result actually contained', () => {
    const messages: LlmMessage[] = [
      ...question('Where do we order packaging?'),
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'search_documents', arguments: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        content: 'Packaging is ordered through pack-supply.co.il every Sunday.',
      },
    ]
    expect(
      quotes(draft('According to pack-supply.co.il, orders close on Sunday.', { messages })),
    ).toEqual([])
  })

  it('accepts a site that arrived as a source chip rather than as text', () => {
    const trace: ToolTraceEntry[] = [
      {
        tool: 'company_website',
        status: 'ok',
        args: { query: 'Ben Yehuda' },
        sources: [
          {
            id: 'https://burgersbar.co.il/branches/ben-yehuda/',
            title: 'Ben Yehuda',
            type: 'website',
            url: 'https://burgersbar.co.il/branches/ben-yehuda/',
          },
        ],
      },
    ]
    expect(
      quotes(
        draft('According to burgersbar.co.il, the branch closes at midnight on Thursday.', {
          trace,
        }),
      ),
    ).toEqual([])
    // "The company site" in words is backed by the same lookup.
    expect(quotes(draft('לפי אתר החברה, הסניף נסגר בחצות ביום חמישי.', { trace }))).toEqual([])
  })

  it('does not take the system prompt as backing: it names sites to prefer, not facts read', () => {
    expect(quotes(draft('According to gov.il, the rate is 18%.'))).toEqual(['According to gov.il'])
  })

  it('does not read an email address as a website', () => {
    expect(quotes(draft('According to the directory, write to dana@gmail.com about it.'))).toEqual(
      [],
    )
  })

  it('does not read a pointer as an attribution', () => {
    expect(
      quotes(draft('I could not check the web. The usual reference for this is kolzchut.org.il.')),
    ).toEqual([])
  })

  it('does not trip on the Hebrew verb "to locate", which contains the word "site"', () => {
    expect(
      quotes(
        draft('לא הצלחתי לאתר את הנוסח המדויק של הנוהל. לפי ספר הנהלים, כדאי לבדוק עם מנהל הסניף.'),
      ),
    ).toEqual([])
  })

  it('does not read a physical site as a website', () => {
    // The chain opens branches, so "site plan" and "site visit" prose is in scope.
    for (const text of [
      'According to the site manager, we close at 22:00 on Thursdays.',
      'Based on the site visit last week, the walk-in needs a new gasket.',
      'As per the site survey, the new branch has 240 sqm of floor space.',
      'According to our site checklist, the closing routine has nine steps.',
      'The delay was reported by the site foreman on Sunday.',
      'על פי אתר הבנייה, העבודות יסתיימו במרץ.',
      'לפי אתר ההקמה של הסניף החדש, נותרו שלושה שלבים.',
    ]) {
      expect(quotes(draft(text)), text).toEqual([])
    }
    // While a site that ends the phrase is still a website.
    expect(quotes(draft('According to the website, the branch closes at 23:00.'))).toEqual([
      'According to the website',
    ])
    expect(quotes(draft('As stated on their website, the supplier delivers on Tuesdays.'))).toEqual(
      ['As stated on their website'],
    )
    expect(quotes(draft('לפי אתר כלכליסט, המע"מ הוא 18%.'))).toEqual(['לפי אתר'])
  })

  it('does not read the Hebrew "towards" as "according to"', () => {
    expect(quotes(draft('הביקורת הופנתה כלפי ynet.co.il ולא אלינו.'))).toEqual([])
    expect(quotes(draft('התלונות שהופנו כלפי אתר ההזמנות טופלו בשבוע שעבר.'))).toEqual([])
  })

  it('lets a tool result that mentions a site back "according to the site", and nothing else', () => {
    const tasks: ToolTraceEntry[] = [{ tool: 'my_tasks', status: 'ok', args: {}, sources: [] }]
    const messages: LlmMessage[] = [
      ...question('When does the branch close?'),
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'my_tasks', arguments: '{}' }],
      },
      { role: 'tool', toolCallId: 'c1', content: '- Close the grill (due today)' },
    ]
    expect(
      quotes(
        draft('According to the company site, the branch closes at midnight.', {
          messages,
          trace: tasks,
        }),
      ),
    ).toEqual(['According to the company site'])
  })

  it('does not read "thousands of" as "according to": one Hebrew word hides inside the other', () => {
    expect(quotes(draft('ההזמנה עלתה אלפי אתרים... סתם, אלפי שקלים.'))).toEqual([])
  })

  it('ignores the SOURCES trailer, which names documents and is parsed elsewhere', () => {
    expect(quotes(draft('The answer.\n\nSOURCES: according to example.com | none'))).toEqual([])
  })
})

describe('repairInstruction', () => {
  it('quotes what was named and offers the search only when one can still run', () => {
    const found = unbackedAttributions(
      draft('As of today, according to kolzchut.org.il, it is 35.40.'),
    )
    const withSearch = repairInstruction(found, true)
    expect(withSearch).toContain('according to kolzchut.org.il')
    expect(withSearch).toContain('run the web search now')
    const without = repairInstruction(found, false)
    expect(without).toContain('according to kolzchut.org.il')
    expect(without).not.toContain('run the web search now')
  })
})

describe('withoutUnbackedAttributions: the fallback when the second draft is no better', () => {
  it('removes a mid-sentence attribution cleanly and says nothing was opened', () => {
    const text =
      'As of August 17, 2026, according to kolzchut.org.il, the hourly minimum wage in Israel is **35.40 NIS**.'
    const out = withoutUnbackedAttributions(draft(text), 'en')
    expect(out).toContain(
      'As of August 17, 2026, the hourly minimum wage in Israel is **35.40 NIS**.',
    )
    expect(out).not.toContain('kolzchut')
    expect(out).toContain('no website was opened for this answer')
  })

  it('removes a closing attribution without leaving a stray comma', () => {
    const out = withoutUnbackedAttributions(
      draft('Yom Kippur ends at nightfall on Monday, September 21, according to hebcal.com.'),
      'en',
    )
    expect(out).toContain('Yom Kippur ends at nightfall on Monday, September 21.')
    expect(out).not.toContain('hebcal')
  })

  it('removes an opening attribution and keeps the sentence standing', () => {
    const out = withoutUnbackedAttributions(
      draft('According to kolzchut.org.il, the wage is 35.40 NIS.'),
      'en',
    )
    expect(out.startsWith('The wage is 35.40 NIS.')).toBe(true)
  })

  it('does the same in Hebrew, with a Hebrew note', () => {
    const out = withoutUnbackedAttributions(
      draft(
        'נכון ל-21 בפברואר 2026, לפי אתר infinityfinance.co.il, שיעור המע"מ בישראל עומד על **18%**.',
      ),
      'he',
    )
    expect(out).toContain('נכון ל-21 בפברואר 2026, שיעור המע"מ בישראל עומד על **18%**.')
    expect(out).not.toContain('infinityfinance')
    expect(out).toContain('לא נפתח אף אתר')
  })

  it('cuts cleanly from a bullet, after a colon, inside bold, inside brackets, and with no comma', () => {
    const cases: [string, string][] = [
      [
        '- לפי tabitisrael.co.il, הסניף פתוח עד 23:00.\n- המטבח נסגר ב-22:30.',
        '- הסניף פתוח עד 23:00.\n- המטבח נסגר ב-22:30.',
      ],
      ['Opening hours: according to burgers-il.com, 11:00-23:00.', 'Opening hours: 11:00-23:00.'],
      ['**According to kolzchut.org.il, the wage is 35.40 NIS.**', '**The wage is 35.40 NIS.**'],
      ['The wage is 35.40 [according to kolzchut.org.il].', 'The wage is 35.40.'],
      ['According to kolzchut.org.il the wage is 35.40 NIS.', 'The wage is 35.40 NIS.'],
      [
        'It is 35.40 NIS. According to kolzchut.org.il. That is the figure.',
        'It is 35.40 NIS. That is the figure.',
      ],
      ['על-פי calcalist.co.il המע"מ עומד על 18%.', 'המע"מ עומד על 18%.'],
      [
        'As of today, according to https://www.kolzchut.org.il/he/minimum_wage, it is 35.40 NIS.',
        'As of today, it is 35.40 NIS.',
      ],
      ['According to **kolzchut.org.il**, the wage is 35.40 NIS.', 'The wage is 35.40 NIS.'],
      ['According to (kolzchut.org.il), the wage is 35.40 NIS.', 'The wage is 35.40 NIS.'],
    ]
    for (const [text, expected] of cases) {
      const out = withoutUnbackedAttributions(draft(text), 'en')
      expect(out.split('\n\n')[0], text).toBe(expected)
    }
  })

  it('cuts the whole claim when one of the sites named in it was backed', () => {
    const trace: ToolTraceEntry[] = [
      {
        tool: 'company_website',
        status: 'ok',
        args: {},
        sources: [
          {
            id: 'https://burgersbar.co.il/',
            title: 'Home',
            type: 'website',
            url: 'https://burgersbar.co.il/',
          },
        ],
      },
    ]
    for (const text of [
      'According to burgersbar.co.il and ynet.co.il, the branch is open until 23:00.',
      'According to ynet.co.il and burgersbar.co.il, the branch is open until 23:00.',
    ]) {
      const out = withoutUnbackedAttributions(draft(text, { trace }), 'en')
      expect(out.split('\n\n')[0], text).toBe('The branch is open until 23:00.')
    }
  })

  it('decides the language of the note on the words, not on the domains left in', () => {
    const out = withoutUnbackedAttributions(
      draft('לפי אתר infinityfinance.co.il המע"מ 18%. ראו misc-site.com גם.'),
      'en',
    )
    expect(out).toContain('לא נפתח אף אתר')
  })

  it('leaves the wording alone when cutting would garble it, and still adds the note', () => {
    const text =
      'נכון ל-2026, לפי אתר calcalist.co.il (ואתרים נוספים כמו infinityfinance.co.il), שיעור המע"מ בישראל עומד על **18%**.'
    const out = withoutUnbackedAttributions(draft(text), 'he')
    expect(out.startsWith(text)).toBe(true)
    expect(out).toContain('לא נפתח אף אתר')
  })

  it('keeps the SOURCES trailer last, where the parser looks for it', () => {
    const out = withoutUnbackedAttributions(
      draft('According to kolzchut.org.il, the wage is 35.40 NIS.\n\nSOURCES: none'),
      'en',
    )
    expect(out.trimEnd().endsWith('SOURCES: none')).toBe(true)
    expect(out).toContain('no website was opened for this answer')
  })

  it('writes the note in the language of the answer, not of the account', () => {
    const out = withoutUnbackedAttributions(
      draft('לפי tabitisrael.co.il, הסניף בבן יהודה פתוח בימים א-ה בין 11:00 ל-23:00.'),
      'en',
    )
    expect(out).toContain('לא נפתח אף אתר')
    expect(out).not.toContain('no website was opened')
  })

  it('returns a clean answer untouched', () => {
    const text = 'Close the gas valve, then the hood.'
    expect(withoutUnbackedAttributions(draft(text), 'en')).toBe(text)
  })
})

describe('createSourceGuard: one guard for one answer', () => {
  const INVENTED = 'As of March 30, 2026, according to israelhayom.co.il, VAT is 18%.'

  it('objects to a draft through the loop hook, with the instruction to send back', () => {
    const guard = createSourceGuard()
    const instruction = guard.review({ ...draft(INVENTED), canSearch: true })
    expect(instruction).toContain('according to israelhayom.co.il')
    expect(guard.review({ ...draft('Shut the gas valve.'), canSearch: true })).toBeNull()
  })

  it('settles an answer the loop could not repair, judged against what the reviewer was shown', () => {
    const guard = createSourceGuard()
    guard.review({ ...draft(INVENTED), canSearch: true })
    const settled = guard.settle({ content: INVENTED, review: 'unrepaired' }, 'en')
    expect(settled).toContain('As of March 30, 2026, VAT is 18%.')
    expect(settled).toContain('no website was opened for this answer')
  })

  it('hands back untouched an answer the loop did not mark', () => {
    const guard = createSourceGuard()
    guard.review({ ...draft(INVENTED), canSearch: true })
    expect(guard.settle({ content: 'The second, honest draft.', review: 'repaired' }, 'en')).toBe(
      'The second, honest draft.',
    )
    expect(guard.settle({ content: 'A clean answer.' }, 'en')).toBe('A clean answer.')
  })
})
