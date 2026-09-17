import { describe, expect, it } from 'vitest'
import {
  abstained,
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
} from '../src/assistant/eval-scoring.js'

// The scoring the evaluation harness grades with (PR4). Every function here is pure and free: no
// model, no network, no database. That is the point — the paid part of an eval run is buying the
// answer, so everything that can be decided by looking at the answer text and the trace is decided
// here, once, and asserted by this suite rather than by a reader's eye.

const trace = (...entries: [string, string][]) =>
  entries.map(([tool, status]) => ({ tool, status }))

describe('routesTaken', () => {
  it('reads the document search as the docs route', () => {
    expect(
      routesTaken({ trace: trace(['search_documents', 'ok']), citations: [], webSearches: null }),
    ).toEqual(['docs'])
  })

  it('names every other tool as its own app route', () => {
    expect(
      routesTaken({
        trace: trace(['my_tasks', 'ok'], ['people_directory', 'empty']),
        citations: [],
        webSearches: null,
      }),
    ).toEqual(['app:my_tasks', 'app:people_directory'])
  })

  it('counts a lookup that ran and found nothing as a route taken', () => {
    // Routing is about where the model chose to look, not about whether the shelf held the answer.
    expect(
      routesTaken({
        trace: trace(['search_documents', 'empty']),
        citations: [],
        webSearches: null,
      }),
    ).toContain('docs')
  })

  it('reads a citation as the web route even when the broker reported no count', () => {
    // The production engine returns citations with no server_tool_use block (ADR-0028), so a cited
    // page is the only evidence the search ran at all.
    expect(
      routesTaken({ trace: [], citations: [{ url: 'https://gov.il/vat' }], webSearches: null }),
    ).toEqual(['web'])
  })

  it('reads a billed search with no citation as the web route', () => {
    expect(routesTaken({ trace: [], citations: [], webSearches: 1 })).toEqual(['web'])
  })

  it('calls an answer with no lookup at all general', () => {
    expect(routesTaken({ trace: [], citations: [], webSearches: 0 })).toEqual(['general'])
  })
})

describe('routeHit', () => {
  it('passes when the expected route is among those taken', () => {
    expect(routeHit('docs', ['docs', 'web'])).toBe(true)
  })

  it('fails a general expectation when anything ran', () => {
    // A greeting that buys a paid search is a failure even though it reads fine.
    expect(routeHit('general', ['general'])).toBe(true)
    expect(routeHit('general', ['docs'])).toBe(false)
  })

  it('fails when the expected route was never taken', () => {
    expect(routeHit('web', ['docs'])).toBe(false)
  })
})

describe('toolScore', () => {
  it('scores an exact match as one', () => {
    const score = toolScore(['my_tasks'], trace(['my_tasks', 'ok']))
    expect(score.f1).toBe(1)
    expect(score.missing).toEqual([])
    expect(score.extra).toEqual([])
  })

  it('names the tool that was expected and never called', () => {
    const score = toolScore(['people_directory'], trace(['search_documents', 'ok']))
    expect(score.missing).toEqual(['people_directory'])
    expect(score.extra).toEqual(['search_documents'])
    expect(score.f1).toBe(0)
  })

  it('scores expecting nothing and calling nothing as one', () => {
    expect(toolScore([], []).f1).toBe(1)
  })

  it('counts a tool called twice once', () => {
    const score = toolScore(
      ['search_documents'],
      trace(['search_documents', 'ok'], ['search_documents', 'empty']),
    )
    expect(score.precision).toBe(1)
  })
})

describe('narratedSearch', () => {
  it('catches an English claim to have searched', () => {
    expect(narratedSearch('I searched the web and the rate is 18%.')).toBe(true)
    expect(narratedSearch('I checked the Tax Authority site.')).toBe(true)
  })

  it('catches a Hebrew claim to have searched', () => {
    expect(narratedSearch('חיפשתי באינטרנט ומצאתי שהמעם הוא 18%.')).toBe(true)
    expect(narratedSearch('בדקתי באתר רשות המסים.')).toBe(true)
  })

  it('leaves an answer that claims nothing alone', () => {
    expect(narratedSearch('The VAT rate is 18%, as of September 2026 according to gov.il.')).toBe(
      false,
    )
    expect(narratedSearch('שיעור המעם הוא 18 אחוז.')).toBe(false)
  })
})

describe('abstained', () => {
  it('reads the prompt-mandated miss wording in both languages', () => {
    expect(
      abstained('I did not find an answer for that in the knowledge base or on the web.'),
    ).toBe(true)
    expect(abstained('לא מצאתי תשובה לזה בבסיס הידע או באינטרנט.')).toBe(true)
  })

  it('reads an out-of-scope reply as an abstention', () => {
    expect(abstained('That is outside what you can view in the app.')).toBe(true)
  })

  it('does not read a normal answer as an abstention', () => {
    expect(abstained('Shut the gas valve, then wipe the grill.')).toBe(false)
  })
})

describe('hebrewSurface', () => {
  it('flags niqqud', () => {
    // The vowelled word lives here as codepoints, never as pasted text. Combining marks do not
    // survive a terminal, a formatter round-trip or a copy between editors, and a fixture that
    // silently loses them asserts nothing while still passing.
    const vowelled = 'מְנַהֵל'
    expect(hebrewSurface(`${vowelled} המשמרת`).niqqud).toBe(true)
    expect(hebrewSurface('מנהל המשמרת').niqqud).toBe(false)
  })

  it('flags eastern arabic-indic digits', () => {
    expect(hebrewSurface('שיעור המעם הוא ١٨ אחוז').easternDigits).toBe(true)
    expect(hebrewSurface('שיעור המעם הוא 18 אחוז').easternDigits).toBe(false)
  })

  it('flags a Hebrew block whose first strong character is Latin', () => {
    // dir="auto" resolves that block left to right, so the whole Hebrew paragraph flips.
    expect(hebrewSurface('VAT הוא 18 אחוז היום').latinLed).toBe(true)
    expect(hebrewSurface('שיעור ה-VAT הוא 18 אחוז').latinLed).toBe(false)
  })

  it('leaves a purely English answer alone', () => {
    const flags = hebrewSurface('The VAT rate is 18%.')
    expect(flags.latinLed).toBe(false)
    expect(flags.niqqud).toBe(false)
  })
})

describe('tally', () => {
  it('punishes a wrong answer twice as hard as a declined one', () => {
    const scored = tally(['correct', 'correct', 'incorrect', 'abstained'])
    expect(scored.correct).toBe(2)
    expect(scored.incorrect).toBe(1)
    expect(scored.abstained).toBe(1)
    expect(scored.headline).toBe(0)
  })

  it('reports an empty set without dividing by zero', () => {
    expect(tally([]).headlineRate).toBe(0)
  })
})

describe('gateFailures', () => {
  const clean = {
    answerable: tally(['correct', 'correct', 'correct', 'correct', 'correct']),
    uncovered: tally(['abstained', 'abstained', 'abstained', 'abstained', 'abstained']),
  }

  it('passes a clean run', () => {
    expect(gateFailures(clean)).toEqual([])
  })

  it('fails when the answerable set holds a wrong answer above the threshold', () => {
    const failures = gateFailures({
      ...clean,
      answerable: tally(['correct', 'incorrect', 'correct', 'correct', 'correct']),
    })
    expect(failures.join(' ')).toMatch(/incorrect/i)
  })

  it('fails when the uncovered set was answered instead of declined', () => {
    const failures = gateFailures({
      ...clean,
      uncovered: tally(['correct', 'abstained', 'abstained', 'abstained', 'abstained']),
    })
    expect(failures.join(' ')).toMatch(/abstention recall/i)
  })

  it('fails when too many answerable questions were declined', () => {
    const failures = gateFailures({
      ...clean,
      answerable: tally(['abstained', 'abstained', 'correct', 'correct', 'correct']),
    })
    expect(failures.join(' ')).toMatch(/over-abstention/i)
  })
})

describe('promptFingerprint', () => {
  it('is stable for the same prompt and different for a changed one', () => {
    expect(promptFingerprint('you are the assistant')).toBe(
      promptFingerprint('you are the assistant'),
    )
    expect(promptFingerprint('you are the assistant')).not.toBe(
      promptFingerprint('you are an assistant'),
    )
  })
})

describe('factCoverage', () => {
  it('counts a fact the answer states in its own words', () => {
    const coverage = factCoverage('Shut the gas valve, then wipe the grill down.', [
      'shut the gas valve',
    ])
    expect(coverage.covered).toEqual([true])
    expect(coverage.rate).toBe(1)
  })

  it('counts a Hebrew fact through a prefixed form', () => {
    const coverage = factCoverage('יש שני מנהלי מוקד ברשת.', ['שני מנהלי מוקד'])
    expect(coverage.covered).toEqual([true])
  })

  it('does not count a fact the answer never states', () => {
    const coverage = factCoverage('The fryer oil is drained on Sunday.', ['shut the gas valve'])
    expect(coverage.covered).toEqual([false])
    expect(coverage.rate).toBe(0)
  })

  it('treats a set with no gold facts as fully covered', () => {
    expect(factCoverage('anything', []).rate).toBe(1)
  })
})

describe('verdictFor', () => {
  it('calls a decline an abstention rather than a wrong answer', () => {
    expect(
      verdictFor({
        text: 'I did not find an answer for that in the knowledge base or on the web.',
        goldFacts: ['shut the gas valve'],
        expectAbstention: false,
      }),
    ).toBe('abstained')
  })

  it('calls an answer that carries the gold facts correct', () => {
    expect(
      verdictFor({
        text: 'Shut the gas valve, then wipe the grill.',
        goldFacts: ['shut the gas valve'],
        expectAbstention: false,
      }),
    ).toBe('correct')
  })

  it('calls an answer that misses the gold facts incorrect', () => {
    expect(
      verdictFor({
        text: 'Drain the fryer oil.',
        goldFacts: ['shut the gas valve'],
        expectAbstention: false,
      }),
    ).toBe('incorrect')
  })

  it('calls answering something we do not cover incorrect, not correct', () => {
    // The uncovered set: a confident reply where a decline was the only honest move.
    expect(
      verdictFor({ text: 'The rule is 14 days.', goldFacts: [], expectAbstention: true }),
    ).toBe('incorrect')
  })
})
