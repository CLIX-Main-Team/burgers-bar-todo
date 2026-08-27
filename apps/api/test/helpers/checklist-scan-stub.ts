import type {
  ChecklistScanOutcome,
  ChecklistScanner,
} from '../../src/assistant/checklist-scanner.js'

// The board route's checklist scan, scripted (owner ask 2026-08-27). The scan itself — retrieval,
// prompt, parsing, the padding cap — is unit-tested against a fake LLM in checklist-scan.test.ts.
// What the ROUTE owns is the chain-owner gate and the mapping of a model outage to a 503, so a
// route case only needs to say what came back and to see whether the scan was reached at all.

export interface ChecklistScanStub extends ChecklistScanner {
  // What the next (and every subsequent) scan answers with.
  respondWith(outcome: ChecklistScanOutcome): void
  // The titles scan() was called with, in order. Empty proves a rejected caller never reached the
  // corpus — the assertion that a gate actually gates, rather than merely changing the status code.
  readonly titles: string[]
  reset(): void
}

const DEFAULT: ChecklistScanOutcome = { status: 'ok', steps: [], sourceTitle: null }

export function createChecklistScanStub(): ChecklistScanStub {
  let outcome: ChecklistScanOutcome = DEFAULT
  const titles: string[] = []

  return {
    respondWith: (next) => {
      outcome = next
    },
    get titles() {
      return titles
    },
    reset: () => {
      outcome = DEFAULT
      titles.length = 0
    },
    scan: async (_principal, title) => {
      titles.push(title)
      return outcome
    },
  }
}
