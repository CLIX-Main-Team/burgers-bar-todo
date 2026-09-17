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
  ...overrides,
})

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

  it('accepts a site an earlier answer in the thread already carried', () => {
    const messages: LlmMessage[] = [
      { role: 'system', content: 'prompt' },
      { role: 'user', content: 'What is the minimum wage?' },
      { role: 'assistant', content: 'As of today, according to kolzchut.org.il, 35.40 NIS.' },
      { role: 'user', content: 'and per month?' },
    ]
    expect(quotes(draft('According to kolzchut.org.il again, 6,443 NIS.', { messages }))).toEqual(
      [],
    )
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
