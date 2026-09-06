import type { Clock } from './clock.js'
import type { DigestResult } from './digest.js'
import type { GreenApiClient } from './green-api-client.js'
import type { DigestStore } from './repository.js'
import { formatForWhatsapp } from './whatsapp-format.js'

// Summaries asked for by name in WhatsApp, rather than waited for at 08:00 (migration 0040).
//
// This half of the feature exists here, and not in the API, because of how the deployment is
// shaped. The webhook that hears the keyword runs in the API container, which holds only the
// webhook token: it has no Green API credentials and no sending code, so it can hear and nothing
// else. This container can summarize and send but has no inbound surface at all, deliberately, and
// giving it one to save a few seconds of latency would be a poor trade. So the API writes a row and
// this reads it.
//
// The promise the whole module is built around: ANYONE WHO ASKS GETS AN ANSWER. Every path below
// ends in a message back to the chat that asked, including the paths where nothing was produced.
// Silence after somebody types a keyword is indistinguishable from a broken feature, and they will
// type it again.

// How often to look for a request. Far faster than the daily scheduler's minute, because this one
// has a person waiting on the other end, and one indexed query against a table that is almost
// always empty costs nothing.
export const REQUEST_POLL_MS = 10_000

// How long after a completed summary before another may be asked for. The reason is cost: one run
// is roughly one model call per branch plus a large merge, and two runs a few minutes apart read
// nearly the same messages and produce nearly the same text for twice the money.
export const COOLDOWN_MS = 30 * 60_000

// A request claimed but never finished is a crashed run, not a slow one. Reclaiming it matters more
// than the number does: without this, one crash leaves a row marked 'running' forever, the guard
// that stops concurrent runs never lets another through, and the feature is silently dead until
// somebody thinks to look in the database.
export const STALE_RUN_MS = 10 * 60_000

const MS_PER_MINUTE = 60_000

export const ACKNOWLEDGEMENT = 'קיבלתי, מכין סיכום.'

export const UNAVAILABLE_REPLY = 'הסיכום אינו זמין כרגע. אפשר לנסות שוב מאוחר יותר.'

export const FAILURE_REPLY = 'לא הצלחתי להכין את הסיכום. אפשר לנסות שוב בעוד כמה דקות.'

// Told, not ignored: a request that silently does nothing reads as a broken keyword and gets typed
// again at once. The wording carries no number by choice, so the minutes actually left are logged
// rather than said.
export const COOLDOWN_REPLY = 'המערכת בהמתנה. אפשר לנסות שוב בעוד כמה דקות.'

// Every line this module sends is a single Hebrew sentence, and it goes through the same formatter
// the digest uses so it lays out right to left for the same reason (whatsapp-format.ts). An empty
// body collapses to exactly one marked line.
const oneLine = (text: string): string => formatForWhatsapp(text, '')

export type RequestOutcome = 'idle' | 'answered' | 'cooling-down' | 'unavailable' | 'failed'

export interface OnDemandDeps {
  store: DigestStore
  greenApi: GreenApiClient
  clock: Clock
  // Run a digest as the answer to this chat. Injected rather than imported so the outcomes can be
  // driven in a test without a model, a gateway or a clock.
  run: (chatId: string) => Promise<DigestResult>
  log: (message: string) => void
  cooldownMs?: number
  staleAfterMs?: number
}

// Take at most one request and see it through. Returns what happened, which is what the tests
// assert on and what the loop logs.
export async function handleSummaryRequest({
  store,
  greenApi,
  clock,
  run,
  log,
  cooldownMs = COOLDOWN_MS,
  staleAfterMs = STALE_RUN_MS,
}: OnDemandDeps): Promise<RequestOutcome> {
  const request = await store.claimSummaryRequest(staleAfterMs)
  if (request === null) {
    return 'idle'
  }

  // Best-effort throughout: a send that fails must not abandon a claimed request, because the row
  // would then sit 'running' until the reclaim window and block everything behind it.
  const say = async (text: string): Promise<void> => {
    const sent = await greenApi.sendMessage({ chatId: request.chatId, message: oneLine(text) })
    if (!sent.ok) {
      log(`warning: could not reply to the summary request: ${sent.error}`)
    }
  }

  const lastRun = await store.lastManualRunAt()
  const sinceLast =
    lastRun === null ? Number.POSITIVE_INFINITY : clock.now().getTime() - lastRun.getTime()
  if (sinceLast < cooldownMs) {
    const minutesLeft = Math.max(1, Math.ceil((cooldownMs - sinceLast) / MS_PER_MINUTE))
    log(`summary requested, refused by the cooldown with ${minutesLeft} minute(s) left`)
    await say(COOLDOWN_REPLY)
    await store.finishSummaryRequest(request.idMessage, 'skipped', `cooldown, ${minutesLeft}m left`)
    return 'cooling-down'
  }

  log('summary requested, running now')
  // The acknowledgement goes first and on its own, before any work starts. It is the entire point of
  // the feature feeling responsive: the run behind it can take minutes.
  await say(ACKNOWLEDGEMENT)

  const result = await run(request.chatId)

  if (!result.ok) {
    log(`the requested summary failed at the ${result.stage} step: ${result.error}`)
    await say(FAILURE_REPLY)
    await store.finishSummaryRequest(
      request.idMessage,
      'failed',
      `${result.stage}: ${result.error}`,
    )
    return 'failed'
  }

  // A successful run that sent nothing. The commonest cause is the off switch, which is a perfectly
  // ordinary state, but from the asker's side it is indistinguishable from a hang unless we say so.
  // This is the branch that keeps the module's one promise on the day the switch is off.
  if (result.delivery.status === 'skipped') {
    log(`the requested summary was not sent: ${result.delivery.reason}`)
    await say(UNAVAILABLE_REPLY)
    await store.finishSummaryRequest(request.idMessage, 'skipped', result.delivery.reason)
    return 'unavailable'
  }

  log(`the requested summary was queued (idMessage ${result.delivery.idMessage})`)
  await store.finishSummaryRequest(request.idMessage, 'done', null)
  return 'answered'
}

export interface OnDemandRunner {
  // Runs until stopped. Resolves only when stop() is called, so main() can await it alongside the
  // scheduler.
  start(): Promise<void>
  stop(): void
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function createOnDemandRunner(deps: OnDemandDeps & { pollMs?: number }): OnDemandRunner {
  const pollMs = deps.pollMs ?? REQUEST_POLL_MS
  let running = false

  return {
    start: async () => {
      running = true
      while (running) {
        try {
          // One per tick rather than draining the queue. Requests that piled up behind a long run
          // are almost always the same person tapping twice, and answering each of them in turn
          // would be several identical summaries and several bills; the cooldown collapses the rest.
          await handleSummaryRequest(deps)
        } catch (error) {
          // The loop must outlive any single failure. A container whose poller died is a keyword
          // that silently stopped working, which nobody would notice for days.
          deps.log(
            `warning: the on-demand poller stumbled: ${error instanceof Error ? error.message : 'unknown'}`,
          )
        }
        if (!running) {
          return
        }
        await sleep(pollMs)
      }
    },
    stop: () => {
      running = false
    },
  }
}
