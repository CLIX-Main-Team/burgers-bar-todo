import type { Clock } from './clock.js'
import type { GreenApiClient } from './green-api-client.js'
import { jerusalemWallClock } from './jerusalem-time.js'
import type { LlmClient } from './llm-client.js'
import type { DigestStore } from './repository.js'
import { summarizeDay } from './summary.js'
import { type DigestWindow, buildTranscript, digestWindow } from './transcript.js'

// One digest run, start to finish (ADR-0026): check the gateway, read the day, summarize it, send
// it. Called once by --once and once per day by the scheduler, and it is the only place the order of
// those steps is decided.
//
// Nothing here throws. A run is a scheduled batch with no operator watching, so every way it can go
// wrong — an unauthorized instance, a gateway outage, a model timeout, a refused send — is a
// reported outcome. The container must survive a bad day and try again tomorrow.

// The WhatsApp text limit. The summary is capped far below this by its token budget, so this is a
// backstop against a model that ignores its instructions, not an expected path.
const WHATSAPP_MESSAGE_LIMIT = 20_000

// Every private chat is addressed this way; the digest goes to one person, never to a group.
const PRIVATE_CHAT_SUFFIX = '@c.us'

export const DEFAULT_WINDOW_HOURS = 24

export type DigestStage = 'preflight' | 'journals' | 'summary' | 'send'

export interface DigestDependencies {
  greenApi: GreenApiClient
  llm: LlmClient
  clock: Clock
  // Where the run remembers itself. A no-op implementation is wired when no DATABASE_URL is
  // configured, so the job still runs statelessly for anyone who wants a summary without a
  // database — the store is a capability, never a requirement.
  store: DigestStore
  // The model that wrote the summaries, recorded against every row. Passed in rather than read
  // from the llm client because it is configuration this module only forwards.
  model: string
}

export interface DigestOptions {
  // Digits only, full international format. Empty means "run everything, send nothing" — the
  // expected configuration until the owner supplies a number (env.ts).
  recipient: string
  windowHours?: number
  // The group chatIds this run may read, empty meaning every group (env.ts, transcript.ts).
  allowedGroups?: readonly string[]
}

export type DigestDelivery =
  // "queued", never "sent": a 200 from sendMessage means the gateway accepted the message into its
  // queue, where it can wait up to 24 hours. Delivery is a separate webhook this job does not read.
  { status: 'queued'; idMessage: string } | { status: 'skipped'; reason: string }

export interface DigestSuccess {
  ok: true
  window: DigestWindow
  groupCount: number
  messageCount: number
  truncationNotes: string[]
  warnings: string[]
  message: string
  delivery: DigestDelivery
}

export interface DigestFailure {
  ok: false
  stage: DigestStage
  error: string
  warnings: string[]
}

export type DigestResult = DigestSuccess | DigestFailure

// The Hebrew greeting and header every digest carries. Composed here rather than asked of the model,
// so the date is always right even when the summary is not and the opening line cannot drift: a
// model asked to write its own greeting rewrites it slightly every day, and a daily message people
// skim is one whose shape must stay identical so the parts that changed are the parts that stand out.
const digestHeader = (localDate: string): string => {
  const [year, month, day] = localDate.split('-')
  const readable =
    year !== undefined && month !== undefined && day !== undefined
      ? `${day}/${month}/${year}`
      : localDate
  return `יום טוב! הנה הסיכום היומי מכל קבוצות הסניפים (${readable}):`
}

export async function runDigest(
  { greenApi, llm, clock, store, model }: DigestDependencies,
  { recipient, windowHours = DEFAULT_WINDOW_HOURS, allowedGroups = [] }: DigestOptions,
): Promise<DigestResult> {
  const warnings: string[] = []
  const now = clock.now()

  // The preflight, first and on its own. Every other method reports an unauthorized instance as a
  // bare HTTP 400, so without this a fresh deploy fails three calls in with a message that reads
  // like a bug in this code rather than a QR code nobody scanned.
  const state = await greenApi.getStateInstance()
  if (!state.ok) {
    return { ok: false, stage: 'preflight', error: state.error, warnings }
  }
  if (state.state !== 'authorized') {
    return {
      ok: false,
      stage: 'preflight',
      error: `the WhatsApp instance is "${state.state}", not "authorized" — link the phone in the Green API console (a "sleepMode" instance usually means the phone is off or offline)`,
      warnings,
    }
  }

  // The journals only hold anything while incoming notifications are switched on. With them off,
  // both reads answer 200 with an empty array forever, which is indistinguishable from a quiet day —
  // so this stops the run rather than sending a confident "nothing happened" every morning.
  const settings = await greenApi.getSettings()
  if (settings.ok) {
    if (settings.settings.incomingWebhook === 'no') {
      return {
        ok: false,
        stage: 'preflight',
        error:
          'incomingWebhook is off on this instance, so the message journal stays empty and any digest would be falsely quiet — switch it on in the Green API console, then log out and re-authorize to backfill history',
        warnings,
      }
    }
    if (
      settings.settings.outgoingMessageWebhook === 'no' ||
      settings.settings.outgoingAPIMessageWebhook === 'no'
    ) {
      warnings.push(
        'outgoing message notifications are off, so messages sent from the linked phone are missing from the digest',
      )
    }
  } else {
    warnings.push(`could not read instance settings: ${settings.error}`)
  }

  // Group names only. Membership is decided on the chatId suffix (transcript.ts), so a getChats that
  // fails or answers short costs the digest its labels, never its messages.
  const chats = await greenApi.getChats()
  if (!chats.ok) {
    warnings.push(`could not read the chat list, so groups are labelled by id: ${chats.error}`)
  }

  // Persisting is never allowed to fail a run: the gateway and the model have already done the
  // expensive, rate-limited work by the time any of this is reached, and a digest that could be
  // delivered must be delivered even when the database is unreachable. Every store call is wrapped
  // for that reason, and every failure becomes a warning the operator sees.
  const persist = async (what: string, action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch (error) {
      // The SQLSTATE code, when there is one, and nothing else. A pg error's `name` is the useless
      // string "error" on every failure alike, while the code says which failure it was (23502 is a
      // not-null violation, 42P01 a missing table) — and unlike the message it can never carry a
      // row's contents, which here would mean somebody's chat text in a log line.
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'unknown'
      warnings.push(`could not store ${what} (SQLSTATE ${code})`)
    }
  }

  if (chats.ok) {
    await persist('the chat directory', () =>
      store.saveChats(
        chats.chats
          .filter((chat) => chat.type === 'group')
          .map((chat) => ({ chatId: chat.id, name: chat.name })),
      ),
    )
  }

  const window = digestWindow(now, windowHours)

  const incoming = await greenApi.lastIncomingMessages(window.minutes)
  if (!incoming.ok) {
    return { ok: false, stage: 'journals', error: incoming.error, warnings }
  }

  // A failed outgoing read is degraded, not fatal: the staff side of every group is still there, and
  // a digest missing our own replies beats no digest at all. It is reported so it cannot pass unseen.
  const outgoing = await greenApi.lastOutgoingMessages(window.minutes)
  if (!outgoing.ok) {
    warnings.push(
      `could not read outgoing messages, so only received messages are summarized: ${outgoing.error}`,
    )
  }

  const transcript = buildTranscript({
    chats: chats.ok ? chats.chats : [],
    incoming: incoming.messages,
    outgoing: outgoing.ok ? outgoing.messages : [],
    window,
    allowedGroups,
  })

  await persist('the messages', () =>
    store.saveMessages(
      transcript.messages.map((message) => ({
        idMessage: message.idMessage,
        chatId: message.chatId,
        senderId: message.senderId ?? null,
        senderName: message.senderName ?? message.senderContactName ?? null,
        typeMessage: message.typeMessage,
        textMessage: message.textMessage ?? message.extendedTextMessage?.text ?? null,
        direction: message.direction,
        // Journal timestamps are UNIX SECONDS; the column is timestamptz.
        sentAt: new Date(message.timestamp * 1000),
      })),
    ),
  )

  const localDate = jerusalemWallClock(now).date
  const summary = await summarizeDay(llm, transcript)

  // Stage 1's output is stored even when stage 2 went on to fail, because it is the half a retry
  // most wants to skip: one call per branch against the merge's single call.
  await persist('the branch summaries', () =>
    store.saveSummaries(summary.groups, transcript.groups, localDate, model),
  )
  if (!summary.ok) {
    return { ok: false, stage: 'summary', error: summary.error, warnings }
  }

  const header = digestHeader(localDate)
  const composed = `${header}\n\n${summary.summary}`
  const message =
    composed.length > WHATSAPP_MESSAGE_LIMIT ? composed.slice(0, WHATSAPP_MESSAGE_LIMIT) : composed

  const outcome = {
    ok: true,
    window,
    groupCount: transcript.groups.length,
    messageCount: transcript.messageCount,
    truncationNotes: transcript.truncationNotes,
    warnings,
    message,
  } as const

  // The digest row is written BEFORE the send is attempted, and that order is the point of the
  // table. A refused send would otherwise throw away every model call the run made; this way the
  // text survives it, and a row whose sent_at is still null is exactly the "built but never
  // delivered" state worth retrying. It is written on the blank-recipient path too, which is how a
  // production run with sending switched off still leaves a readable record of what it produced.
  let digestId: string | null = null
  await persist('the digest', async () => {
    digestId = await store.saveDigest({
      digestDate: localDate,
      message,
      groupCount: transcript.groups.length,
      messageCount: transcript.messageCount,
      model,
    })
  })

  // The blank-recipient short circuit, and the reason it is the LAST thing that happens: everything
  // above has already run, so the daily job is fully exercised in production before a message can
  // reach a real phone. Switching sending on is one env value, not a release.
  if (recipient.length === 0) {
    return {
      ...outcome,
      delivery: {
        status: 'skipped',
        reason: 'WHATSAPP_DIGEST_RECIPIENT is blank, so the digest was built but not sent',
      },
    }
  }

  const sent = await greenApi.sendMessage({
    chatId: `${recipient}${PRIVATE_CHAT_SUFFIX}`,
    message,
  })
  if (!sent.ok) {
    return { ok: false, stage: 'send', error: sent.error, warnings }
  }

  // Stamped only once the gateway has accepted it, so the column means "handed over", never
  // "attempted". A retry looks for the null.
  if (digestId !== null) {
    await persist('the delivery stamp', () =>
      store.markDigestSent(digestId as string, sent.idMessage),
    )
  }

  return { ...outcome, delivery: { status: 'queued', idMessage: sent.idMessage } }
}
