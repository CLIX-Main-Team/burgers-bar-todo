// The digest's WhatsApp port (ADR-0026): the whole gateway surface this job touches — one preflight,
// one settings read, one chat list, two journal reads, and one send — behind a single
// transport-agnostic interface, so the collection, the summary, and the send are driven by an
// injected fake in tests and never by real WhatsApp traffic. It follows the shape of the API's LLM
// port: one port, one real fetch-backed implementation with no vendor SDK, one scriptable fake below
// as the test double. No test may ever send a real message, which is why the fake lives here in src
// beside the port rather than under test/ — the job and its tests share one definition.
//
// setSettings is deliberately absent from this port. Requesting it REBOOTS the instance, the change
// takes up to five minutes to apply, and for that whole window every other method answers HTTP 400
// `instance in starting process try later` — so a daily job that flipped a setting would break its
// own journal reads for the rest of the run. Configuring the instance stays a one-time operator
// action in the Green API console; this client only READS the settings and reports what is wrong.
//
// THE CREDENTIAL BOUNDARY, and the reason so much of this file is about strings: Green API takes no
// Authorization header. The instance token is the LAST PATH SEGMENT of every request URL
// ({apiUrl}/waInstance{id}/{method}/{token}), so any logged URL is a leaked credential. The rule is
// therefore structural rather than cosmetic — the URL is built inside a private closure, is never
// returned, never logged, and never interpolated into an error; every failure string is a fixed
// template plus the method NAME and the numeric status; the catch reads an error's CLASS and never
// its .message, .stack, or .cause, any of which carries the request URL back out of undici; and
// createTokenRedactor scrubs whatever crosses the boundary as a last line of defence.

// The seven strings getStateInstance can report. 'yellowCard' is deprecated in favour of
// 'suspended' but still arrives, so it stays in the union.
export type GreenApiInstanceState =
  | 'notAuthorized'
  | 'authorized'
  | 'blocked'
  | 'sleepMode'
  | 'starting'
  | 'yellowCard'
  | 'suspended'

// Every toggle in this API is the STRING 'yes' or 'no', never a boolean — the single most common
// typing mistake against Green API, and one that would silently pass a `!settings.incomingWebhook`
// check because the string "no" is truthy.
export type GreenApiToggle = 'yes' | 'no'

// Only the five settings the preflight reads. getSettings returns roughly twenty-five more fields;
// they are dropped at the boundary cast. These five are the ones that decide whether the journals
// hold anything at all: with incomingWebhook off, lastIncomingMessages answers 200 with an empty
// array forever, and a permanently misconfigured gateway is indistinguishable from a quiet day.
export interface GreenApiSettings {
  incomingWebhook: GreenApiToggle
  outgoingWebhook: GreenApiToggle
  outgoingMessageWebhook: GreenApiToggle
  outgoingAPIMessageWebhook: GreenApiToggle
  enableLidMode: GreenApiToggle
}

// One entry from getChats. `name` MAY BE AN EMPTY STRING — WhatsApp allows a group with no name and
// Green API assigns no default, so an empty name is a real value here and not a parse failure.
export interface GreenApiChat {
  id: string
  name: string
  type: 'user' | 'group'
}

// One journal row, normalised. The wire carries `type: 'incoming' | 'outgoing'`; it is renamed to
// `direction` and set from the METHOD that was called rather than read from the body, both because
// that cannot disagree with reality and because `type` already means something else on a chat.
// `timestamp` is UNIX SECONDS, not milliseconds. Everything below the first five fields is optional
// because the wire shape is a union over `typeMessage` in which nearly every field is absent on any
// given row. There is no chatName and no sender field on a journal row — those exist only in the
// webhook notification format, which is why getChats is mandatory to label a group.
export interface GreenApiJournalMessage {
  idMessage: string
  timestamp: number
  typeMessage: string
  chatId: string
  direction: 'incoming' | 'outgoing'
  senderId?: string
  senderName?: string
  senderContactName?: string
  textMessage?: string
  extendedTextMessage?: { text?: string }
  caption?: string
  fileName?: string
  sendByApi?: boolean
}

// chatId is the only addressing field sendMessage takes — there is no phoneNumber parameter.
export interface GreenApiSendRequest {
  chatId: string
  message: string
}

// One result union per call. Every expected failure folds here and nothing throws after boot: a
// gateway that is down, rate limited, or not yet authorized is an ordinary outcome of a daily job,
// not an exception. The error string carries the method name and the numeric status class only —
// never a URL (the token is a path segment), never a response body, never chat content.
export type GreenApiStateResult =
  | { ok: true; state: GreenApiInstanceState }
  | { ok: false; error: string }

export type GreenApiSettingsResult =
  | { ok: true; settings: GreenApiSettings }
  | { ok: false; error: string }

export type GreenApiChatsResult = { ok: true; chats: GreenApiChat[] } | { ok: false; error: string }

export type GreenApiJournalResult =
  | { ok: true; messages: GreenApiJournalMessage[] }
  | { ok: false; error: string }

export type GreenApiSendResult = { ok: true; idMessage: string } | { ok: false; error: string }

export type GreenApiMethod =
  | 'getStateInstance'
  | 'getSettings'
  | 'getChats'
  | 'lastIncomingMessages'
  | 'lastOutgoingMessages'
  | 'sendMessage'

export interface GreenApiClient {
  // The preflight, and the only method that reports an unauthorized instance as a normal 200 body
  // rather than as an HTTP 400 three calls later. Call it first and branch on the string.
  getStateInstance(): Promise<GreenApiStateResult>
  getSettings(): Promise<GreenApiSettingsResult>
  // Fetched once per run: a journal row carries a chatId but no chat name, so this is the only way
  // to say which chatIds are groups and what to call them in the digest.
  getChats(): Promise<GreenApiChatsResult>
  lastIncomingMessages(minutes: number): Promise<GreenApiJournalResult>
  lastOutgoingMessages(minutes: number): Promise<GreenApiJournalResult>
  sendMessage(request: GreenApiSendRequest): Promise<GreenApiSendResult>
}

// --- Boot-time configuration and the token-redaction boundary ---

// The resolved, ready-to-call configuration. apiTokenInstance never leaves this object: it is closed
// over by the adapter, spliced into a URL built inside a private closure, and that URL is never
// returned, never logged, and never interpolated into an Error or a result.
export interface GreenApiConfig {
  apiUrl: string
  idInstance: string
  apiTokenInstance: string
  timeoutMs: number
  // The pause before a retried READ, overridable so tests retry instantly. Production keeps the
  // default, which must stay above the documented one-request-per-second per-instance limit.
  retryDelayMs: number
}

// The env fields resolveGreenApiConfig reads. Kept structural rather than the whole DigestEnv, so
// the resolver is unit-testable with a plain object.
export interface GreenApiConfigEnv {
  GREEN_API_URL: string
  GREEN_API_ID_INSTANCE: string
  GREEN_API_TOKEN_INSTANCE: string
}

export interface GreenApiConfigOverrides {
  timeoutMs?: number
  retryDelayMs?: number
}

// A generous per-request timeout: this is a once-a-day batch job with nobody waiting on a screen, so
// waiting costs nothing and a stalled socket costs a container that never fires again.
export const GREEN_API_TIMEOUT_MS = 20_000

// Just over a second, because every method this job reads is rate limited to one request per second
// per instance and a retry that beats the limit earns an HTTP 429 of its own.
export const GREEN_API_RETRY_DELAY_MS = 1_100

// How many times one READ may run before its failure is the run's failure. The whole job makes about
// five calls a day, so absorbing the transient class costs nothing, where a single dropped
// connection at 08:00 would otherwise mean no digest until tomorrow.
export const GREEN_API_FETCH_ATTEMPTS = 3

export const REDACTED_TOKEN = '[redacted]'

export type Redactor = (text: string) => string

// The last line of defence on the token-in-the-path hazard, applied to every string this module
// hands back. It is a backstop, not the mechanism: the mechanism is that no URL and no response body
// is ever put into a string in the first place. Anything this actually catches is a bug upstream.
export function createTokenRedactor(apiTokenInstance: string): Redactor {
  // With a blank token there is no secret to hide, and split('') would shatter every string into its
  // characters — a mangled log line that helps nobody.
  if (apiTokenInstance.length === 0) {
    return (text) => text
  }
  // split/join rather than a RegExp: a token is opaque and may contain regex metacharacters, and
  // building a pattern out of a secret is exactly the kind of escaping bug that leaks it.
  return (text) => text.split(apiTokenInstance).join(REDACTED_TOKEN)
}

// Resolve the gateway configuration at boot, throwing with the offending env var's NAME — never its
// value — so a misconfigured deploy fails fast at start rather than at the first digest.
export function resolveGreenApiConfig(
  env: GreenApiConfigEnv,
  overrides: GreenApiConfigOverrides = {},
): GreenApiConfig {
  // The console shows the host with a trailing slash more often than not, and the request path is
  // glued straight on, so strip it here rather than emitting a double-slashed URL that 404s.
  const apiUrl = env.GREEN_API_URL.trim().replace(/\/+$/, '')
  const idInstance = env.GREEN_API_ID_INSTANCE.trim()
  const apiTokenInstance = env.GREEN_API_TOKEN_INSTANCE.trim()
  if (apiUrl.length === 0) {
    throw new Error('The WhatsApp digest requires GREEN_API_URL to be set')
  }
  if (idInstance.length === 0) {
    throw new Error('The WhatsApp digest requires GREEN_API_ID_INSTANCE to be set')
  }
  if (apiTokenInstance.length === 0) {
    throw new Error('The WhatsApp digest requires GREEN_API_TOKEN_INSTANCE to be set')
  }
  return {
    apiUrl,
    idInstance,
    apiTokenInstance,
    timeoutMs: overrides.timeoutMs ?? GREEN_API_TIMEOUT_MS,
    // Nullish, not `||`: an explicit 0 from a test must survive, or the suite sleeps for real.
    retryDelayMs: overrides.retryDelayMs ?? GREEN_API_RETRY_DELAY_MS,
  }
}

// --- The real fetch-backed client (no vendor SDK) ---

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Transient at the HTTP level: rate limiting and server-side errors. Everything else non-2xx is
// semantic — a 400 unauthorized instance, a 401 bad token, a 403 bad id, a 466 exhausted quota —
// and retrying it only spends another request against the per-second limit.
const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500

// What a status means, in fixed words an operator can act on. This table is the ONLY thing that ever
// enriches a failure, and it is a constant, so no response body and no URL can reach a message
// through it. The 400 line is the load-bearing one: every method except getStateInstance reports an
// unauthorized or rebooting instance as a plain 400, so it folds to that reason here rather than
// surfacing as an unexplained bad request that reads like a bug in this code.
const STATUS_NOTES: Record<number, string> = {
  400: 'the instance is not authorized, or is still starting after a settings change',
  401: 'GREEN_API_TOKEN_INSTANCE is wrong',
  403: 'GREEN_API_ID_INSTANCE is wrong, or the request URL is malformed',
  429: 'the one-request-per-second per-instance rate limit was exceeded',
  466: 'the plan quota is exhausted — the free tier allows 3 chat correspondents a month',
}

const statusFailure = (method: GreenApiMethod, status: number): string => {
  const note = STATUS_NOTES[status]
  return note === undefined
    ? `green-api ${method} responded ${status}`
    : `green-api ${method} responded ${status}: ${note}`
}

const INSTANCE_STATES: readonly string[] = [
  'notAuthorized',
  'authorized',
  'blocked',
  'sleepMode',
  'starting',
  'yellowCard',
  'suspended',
]

const isInstanceState = (value: unknown): value is GreenApiInstanceState =>
  typeof value === 'string' && INSTANCE_STATES.includes(value)

// A 200 body that is null or an array reads as an empty object rather than throwing on property
// access: this is an external boundary, and a surprising body should degrade to a loud, empty
// preflight, never to a stack trace inside the daily job.
const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

const optionalText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

// An absent or unexpected toggle reads as 'no', which surfaces in the preflight as a warning. That
// is the safe direction: a settings response this client cannot understand should read as "the
// journals may be off" rather than quietly passing the check that guards against an empty digest.
const asToggle = (value: unknown): GreenApiToggle => (value === 'yes' ? 'yes' : 'no')

// One journal row exactly as the wire delivers it, before narrowing. Every field is unknown because
// the response is a union over `typeMessage` and this module trusts none of it.
interface JournalRow {
  idMessage?: unknown
  timestamp?: unknown
  typeMessage?: unknown
  chatId?: unknown
  senderId?: unknown
  senderName?: unknown
  senderContactName?: unknown
  textMessage?: unknown
  extendedTextMessage?: { text?: unknown }
  caption?: unknown
  fileName?: unknown
  sendByApi?: unknown
}

const extendedText = (value: JournalRow['extendedTextMessage']): { text?: string } | undefined => {
  const text = optionalText(value?.text)
  return text === undefined ? undefined : { text }
}

// Narrow a journal response to the rows the digest can use. null means the body was not the bare
// array both journal methods return (there is no envelope), which is a gateway failure rather than
// an empty day and must never be reported as one.
const journalMessages = (
  data: unknown,
  direction: 'incoming' | 'outgoing',
): GreenApiJournalMessage[] | null => {
  if (!Array.isArray(data)) {
    return null
  }
  const rows: JournalRow[] = data
  const messages: GreenApiJournalMessage[] = []
  for (const row of rows) {
    const idMessage = optionalText(row.idMessage)
    const chatId = optionalText(row.chatId)
    const timestamp = typeof row.timestamp === 'number' ? row.timestamp : null
    // Without an id, a chat, or a timestamp a row cannot be de-duplicated, grouped, or placed in the
    // window, so it is dropped here rather than carried as a half-row every later step has to defend
    // against. Everything else about a row is legitimately absent on some message types.
    if (idMessage === undefined || chatId === undefined || timestamp === null) {
      continue
    }
    messages.push({
      idMessage,
      timestamp,
      chatId,
      direction,
      // The transcript keys its Hebrew placeholder off this, so give it something renderable rather
      // than an empty string when the gateway omits it.
      typeMessage: optionalText(row.typeMessage) ?? 'unknown',
      senderId: optionalText(row.senderId),
      senderName: optionalText(row.senderName),
      senderContactName: optionalText(row.senderContactName),
      textMessage: optionalText(row.textMessage),
      extendedTextMessage: extendedText(row.extendedTextMessage),
      caption: optionalText(row.caption),
      fileName: optionalText(row.fileName),
      sendByApi: typeof row.sendByApi === 'boolean' ? row.sendByApi : undefined,
    })
  }
  return messages
}

// What one call needs beyond its method name.
interface CallOptions {
  // Appended after the token segment; the journal methods carry ?minutes=, the rest carry nothing.
  query?: string
  // Present for the one POST this client makes, and its presence is what makes the request a POST.
  body?: unknown
  // Reads are retried through the transient class; the send is not.
  retryable: boolean
}

type CallResult = { ok: true; data: unknown } | { ok: false; error: string }

// Build the fetch-backed GreenApiClient for a resolved config. Every failure — a non-2xx, a body
// that is not the documented shape, an abort past the timeout, a network error — folds to
// { ok: false } with a content-free reason, so a bad gateway day is a reported outcome and never an
// exception on the daily timer. Nothing here logs anything: the URL carries the token, and the
// bodies carry the chat content this job exists to summarize and must never spill.
export function createHttpGreenApiClient(config: GreenApiConfig): GreenApiClient {
  const redact = createTokenRedactor(config.apiTokenInstance)

  // The one place a request URL exists. Note the shape: the literal `waInstance` prefix is glued
  // straight onto the id with no separator, the method name sits in the MIDDLE, and the token is the
  // last segment. It is built here, used once, and never returned or logged.
  const endpoint = (method: GreenApiMethod, query: string): string =>
    `${config.apiUrl}/waInstance${config.idInstance}/${method}/${config.apiTokenInstance}${query}`

  const call = async (method: GreenApiMethod, options: CallOptions): Promise<CallResult> => {
    const attempts = options.retryable ? GREEN_API_FETCH_ATTEMPTS : 1
    for (let attempt = 1; ; attempt += 1) {
      const lastAttempt = attempt === attempts
      // Abort past the timeout so a stalled gateway becomes a failed run, not an open socket holding
      // the container until tomorrow's fire.
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
      try {
        const res = await fetch(endpoint(method, options.query ?? ''), {
          method: options.body === undefined ? 'GET' : 'POST',
          ...(options.body === undefined
            ? {}
            : {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(options.body),
              }),
          signal: controller.signal,
        })
        if (!res.ok) {
          if (isRetryableStatus(res.status) && !lastAttempt) {
            await sleep(config.retryDelayMs * attempt)
            continue
          }
          // The status class and the method name, and nothing else: a 400 validation body can echo
          // the message text straight back, which is chat content.
          return { ok: false, error: redact(statusFailure(method, res.status)) }
        }
        // A structural cast at the boundary rather than a schema parse, as the API's provider client
        // does: each method narrows the handful of fields it reads and ignores the rest.
        return { ok: true, data: (await res.json()) as unknown }
      } catch (error) {
        // An abort past the timeout, a dropped connection, and a body that is not JSON all land
        // here. Read the error's CLASS only: undici puts the full request URL — and therefore the
        // token — into an error's message, stack, and cause.
        const reason = error instanceof Error ? error.name : 'unknown error'
        if (options.retryable && !lastAttempt) {
          await sleep(config.retryDelayMs * attempt)
          continue
        }
        return { ok: false, error: redact(`green-api ${method} request failed: ${reason}`) }
      } finally {
        clearTimeout(timeout)
      }
    }
  }

  const journal = async (
    method: 'lastIncomingMessages' | 'lastOutgoingMessages',
    direction: 'incoming' | 'outgoing',
    minutes: number,
  ): Promise<GreenApiJournalResult> => {
    const result = await call(method, {
      // Whole minutes only: the gateway takes an integer, and a fractional window would ride the
      // query string verbatim.
      query: `?minutes=${Math.trunc(minutes)}`,
      retryable: true,
    })
    if (!result.ok) {
      return result
    }
    const messages = journalMessages(result.data, direction)
    if (messages === null) {
      return { ok: false, error: redact(`green-api ${method} returned an unexpected body`) }
    }
    return { ok: true, messages }
  }

  return {
    getStateInstance: async () => {
      const result = await call('getStateInstance', { retryable: true })
      if (!result.ok) {
        return result
      }
      const state = asObject(result.data).stateInstance
      if (!isInstanceState(state)) {
        // Reported as a class, not echoed, so a state string this client has never heard of cannot
        // carry anything of the account's into a log line.
        return { ok: false, error: 'green-api getStateInstance returned an unrecognised state' }
      }
      return { ok: true, state }
    },

    getSettings: async () => {
      const result = await call('getSettings', { retryable: true })
      if (!result.ok) {
        return result
      }
      const data = asObject(result.data)
      return {
        ok: true,
        settings: {
          incomingWebhook: asToggle(data.incomingWebhook),
          outgoingWebhook: asToggle(data.outgoingWebhook),
          outgoingMessageWebhook: asToggle(data.outgoingMessageWebhook),
          outgoingAPIMessageWebhook: asToggle(data.outgoingAPIMessageWebhook),
          enableLidMode: asToggle(data.enableLidMode),
        },
      }
    },

    getChats: async () => {
      const result = await call('getChats', { retryable: true })
      if (!result.ok) {
        return result
      }
      if (!Array.isArray(result.data)) {
        return { ok: false, error: redact('green-api getChats returned an unexpected body') }
      }
      const rows: unknown[] = result.data
      const chats: GreenApiChat[] = []
      for (const entry of rows) {
        const row = asObject(entry)
        const id = optionalText(row.id)
        // A chat with no id cannot be joined to a journal row, so it is nothing this job can use.
        if (id === undefined) {
          continue
        }
        chats.push({
          id,
          name: typeof row.name === 'string' ? row.name : '',
          // Anything that is not the literal 'group' is treated as a private chat, so a LID-mode
          // instance handing back an unexpected type cannot promote one into the digest.
          type: row.type === 'group' ? 'group' : 'user',
        })
      }
      return { ok: true, chats }
    },

    lastIncomingMessages: (minutes) => journal('lastIncomingMessages', 'incoming', minutes),

    lastOutgoingMessages: (minutes) => journal('lastOutgoingMessages', 'outgoing', minutes),

    sendMessage: async ({ chatId, message }) => {
      // Issued exactly once. Every read above retries the transient class, but a retried SEND is a
      // second WhatsApp message on somebody's phone, which is worse than a missed digest.
      const result = await call('sendMessage', { body: { chatId, message }, retryable: false })
      if (!result.ok) {
        return result
      }
      const idMessage = optionalText(asObject(result.data).idMessage)
      if (idMessage === undefined) {
        return { ok: false, error: redact('green-api sendMessage returned no idMessage') }
      }
      // A 200 with an id means the message was ACCEPTED INTO THE SEND QUEUE, where it can sit for up
      // to 24 hours before expiring. It does not mean delivered, and no caller may say "sent".
      return { ok: true, idMessage }
    },
  }
}

// --- The scriptable fake, the test double the job's tests name ---

// The settings a correctly configured instance reports: every journal the digest reads switched on,
// LID mode off. Starting from the healthy shape means a test about a misconfiguration scripts
// exactly the one field it is about and nothing else.
const DEFAULT_FAKE_SETTINGS: GreenApiSettings = {
  incomingWebhook: 'yes',
  outgoingWebhook: 'yes',
  outgoingMessageWebhook: 'yes',
  outgoingAPIMessageWebhook: 'yes',
  enableLidMode: 'no',
}

// A scriptable in-memory GreenApiClient, living in src beside the port as the API's LLM, Drive, and
// clock fakes do, so the job and its tests share one definition. It is the reason no test can send a
// real message: the whole pipeline runs against this, and `sent` is the structural proof that
// nothing left. `calls` counts per method, so a test can show no work was attempted past a failed
// preflight, and `requestedMinutes` records the window each journal read asked for.
//
// The instance state affects getStateInstance and nothing else. The real gateway would fail every
// other method while unauthorized, but modelling that here would hide the very thing the collection
// step has to prove — that it stops at the preflight rather than discovering the problem three calls
// later. A test that wants a particular method to fail scripts it with failNext.
export interface FakeGreenApiClient extends GreenApiClient {
  setState(state: GreenApiInstanceState): void
  // A test-scripting verb, not the API method: the port deliberately has no setSettings, because
  // calling the real one reboots the instance for five minutes.
  setSettings(settings: Partial<GreenApiSettings>): void
  setChats(chats: GreenApiChat[]): void
  setIncoming(messages: GreenApiJournalMessage[]): void
  setOutgoing(messages: GreenApiJournalMessage[]): void
  // One-shot, per method: the following call behaves normally.
  failNext(method: GreenApiMethod, error?: string): void
  readonly sent: GreenApiSendRequest[]
  readonly calls: Record<GreenApiMethod, number>
  readonly requestedMinutes: number[]
  reset(): void
}

export function createFakeGreenApiClient(): FakeGreenApiClient {
  let state: GreenApiInstanceState = 'authorized'
  let settings: GreenApiSettings = { ...DEFAULT_FAKE_SETTINGS }
  let chats: GreenApiChat[] = []
  let incoming: GreenApiJournalMessage[] = []
  let outgoing: GreenApiJournalMessage[] = []
  const nextErrors = new Map<GreenApiMethod, string>()
  const sent: GreenApiSendRequest[] = []
  const requestedMinutes: number[] = []
  const calls: Record<GreenApiMethod, number> = {
    getStateInstance: 0,
    getSettings: 0,
    getChats: 0,
    lastIncomingMessages: 0,
    lastOutgoingMessages: 0,
    sendMessage: 0,
  }

  // How every method starts: count the call, then consume any queued one-shot failure.
  const enter = (method: GreenApiMethod): string | null => {
    calls[method] += 1
    const error = nextErrors.get(method)
    if (error === undefined) {
      return null
    }
    nextErrors.delete(method)
    return error
  }

  return {
    setState: (next) => {
      state = next
    },

    setSettings: (patch) => {
      settings = { ...settings, ...patch }
    },

    // Copies on the way in and on the way out, so a test mutating its fixture later cannot rewrite
    // what an earlier call already returned.
    setChats: (next) => {
      chats = [...next]
    },

    setIncoming: (messages) => {
      incoming = [...messages]
    },

    setOutgoing: (messages) => {
      outgoing = [...messages]
    },

    failNext: (method, error = `fake green-api: forced ${method} failure`) => {
      nextErrors.set(method, error)
    },

    get sent() {
      return sent
    },

    get calls() {
      return calls
    },

    get requestedMinutes() {
      return requestedMinutes
    },

    reset: () => {
      state = 'authorized'
      settings = { ...DEFAULT_FAKE_SETTINGS }
      chats = []
      incoming = []
      outgoing = []
      nextErrors.clear()
      sent.length = 0
      requestedMinutes.length = 0
      calls.getStateInstance = 0
      calls.getSettings = 0
      calls.getChats = 0
      calls.lastIncomingMessages = 0
      calls.lastOutgoingMessages = 0
      calls.sendMessage = 0
    },

    getStateInstance: async () => {
      const error = enter('getStateInstance')
      if (error !== null) {
        return { ok: false, error }
      }
      return { ok: true, state }
    },

    getSettings: async () => {
      const error = enter('getSettings')
      if (error !== null) {
        return { ok: false, error }
      }
      return { ok: true, settings: { ...settings } }
    },

    getChats: async () => {
      const error = enter('getChats')
      if (error !== null) {
        return { ok: false, error }
      }
      return { ok: true, chats: [...chats] }
    },

    // The scripted rows come back whole: the fake does not apply the window, because selecting the
    // 24 hours is the transcript's rule and a fake that quietly did it too could hide a broken one.
    lastIncomingMessages: async (minutes) => {
      const error = enter('lastIncomingMessages')
      requestedMinutes.push(minutes)
      if (error !== null) {
        return { ok: false, error }
      }
      return { ok: true, messages: [...incoming] }
    },

    lastOutgoingMessages: async (minutes) => {
      const error = enter('lastOutgoingMessages')
      requestedMinutes.push(minutes)
      if (error !== null) {
        return { ok: false, error }
      }
      return { ok: true, messages: [...outgoing] }
    },

    sendMessage: async (request) => {
      const error = enter('sendMessage')
      if (error !== null) {
        return { ok: false, error }
      }
      // Capture a copy so a later mutation of the caller's request cannot rewrite recorded history.
      sent.push({ chatId: request.chatId, message: request.message })
      return { ok: true, idMessage: `fake-green-api-${sent.length}` }
    },
  }
}
