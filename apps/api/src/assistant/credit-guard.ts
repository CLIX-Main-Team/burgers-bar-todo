// The prepaid-credit guard (the 2026-08 outage class): OpenRouter serves 402s the moment the
// account balance crosses zero, and the first anyone knew was the client's bot going quiet. The
// provider's own guidance is to poll and act before requests start failing, and it ships a
// first-party endpoint for exactly that: GET /api/v1/credits reports lifetime credits and usage,
// whose difference is the live balance. The server drives checkOnce() from a real timer (the
// sync-triggers pattern); this module owns the read, the threshold, and the one-alert-per-crossing
// state, and hands the human side to an injected alert port.
//
// Only meaningful for the openrouter provider — the caller gates on that; the guard itself is
// provider-shaped only in the URL and response it reads.

export const CREDIT_POLL_INTERVAL_MS = 60 * 60 * 1000

const CREDITS_ENDPOINT = 'https://openrouter.ai/api/v1/credits'

export interface CreditStatus {
  remainingUsd: number
  checkedAt: Date
}

export interface CreditGuardConfig {
  apiKey: string
  // Alert when the balance drops below this many dollars. Sized in the env so the runway can be
  // widened without a deploy.
  thresholdUsd: number
  // The human channel — a push to the chain admins in the server wiring. Awaited so a test can
  // observe it; failures are the port's own problem (the ops notifier never rejects).
  alert: (remainingUsd: number) => Promise<void>
  onError?: (message: string) => void
  fetchImpl?: typeof fetch
}

export interface CreditGuard {
  checkOnce(): Promise<void>
  status(): CreditStatus | null
}

export function createCreditGuard(config: CreditGuardConfig): CreditGuard {
  const report = config.onError ?? ((message: string) => console.error(message))
  const fetchImpl = config.fetchImpl ?? fetch
  let latest: CreditStatus | null = null
  // Armed means "the next low reading rings". Recovery above the threshold re-arms, so a low
  // balance rings once per drain, not once per poll — and a failed poll leaves the state alone,
  // so an outage cannot eat the alert the next real reading deserves.
  let armed = true

  return {
    status: () => latest,
    checkOnce: async () => {
      try {
        const res = await fetchImpl(CREDITS_ENDPOINT, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        })
        if (!res.ok) {
          report(`assistant credit guard: provider responded ${res.status}`)
          return
        }
        const body = (await res.json()) as {
          data?: { total_credits?: number; total_usage?: number }
        }
        const credits = body.data?.total_credits
        const usage = body.data?.total_usage
        if (typeof credits !== 'number' || typeof usage !== 'number') {
          report('assistant credit guard: malformed credits response')
          return
        }
        const remainingUsd = credits - usage
        latest = { remainingUsd, checkedAt: new Date() }
        if (remainingUsd < config.thresholdUsd) {
          if (armed) {
            armed = false
            await config.alert(remainingUsd)
          }
        } else {
          armed = true
        }
      } catch (error) {
        // Class only, never a payload (ADR-0011 discipline, applied to the guard's own traffic).
        const reason = error instanceof Error ? error.name : 'unknown error'
        report(`assistant credit guard: poll failed: ${reason}`)
      }
    },
  }
}
