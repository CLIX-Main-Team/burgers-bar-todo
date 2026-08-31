import type { Clock } from './clock.js'
import type { GreenApiChat, GreenApiClient } from './green-api-client.js'
import { storedToJournal } from './ingest.js'
import { jerusalemWallClock } from './jerusalem-time.js'
import type { LlmClient } from './llm-client.js'
import type { DigestStore, DigestSwitch, StoredMessage } from './repository.js'
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

export type DigestStage = 'preflight' | 'journals' | 'switch' | 'summary' | 'send'

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
  // The webhook URL this deployment believes the gateway should be posting to. Blank disables the
  // comparison, which is right for a local run that is not the configured consumer.
  expectedWebhookUrl?: string
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
  {
    recipient,
    windowHours = DEFAULT_WINDOW_HOURS,
    allowedGroups = [],
    expectedWebhookUrl = '',
  }: DigestOptions,
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

  // The gateway must still be POSTing to us, and this is the only cheap way to know. The digest now
  // reads Postgres, so a webhook that was switched off, or repointed at some other project, does not
  // fail loudly — it just stops filling the table, and every morning after that the digest reports a
  // beautifully quiet day. That silent-empty failure is the one this whole preflight exists for, so
  // the two settings that would cause it are checked before anything is summarized.
  const settings = await greenApi.getSettings()
  if (settings.ok) {
    if (settings.settings.incomingWebhook === 'no') {
      return {
        ok: false,
        stage: 'preflight',
        error:
          'incomingWebhook is off on this instance, so the gateway is sending us nothing and any digest would be falsely quiet — switch it on in the Green API console',
        warnings,
      }
    }
    if (settings.settings.webhookUrl.length === 0) {
      return {
        ok: false,
        stage: 'preflight',
        error:
          'no webhookUrl is configured on this instance, so nothing is feeding the database and any digest would be falsely quiet — point it at the /whatsapp/webhook route of this deployment',
        warnings,
      }
    }
    // Reported, not fatal: a URL we do not recognise may be a rename or a second consumer, and the
    // rows already in the table are still a real day. It must not pass unseen all the same.
    if (expectedWebhookUrl.length > 0 && settings.settings.webhookUrl !== expectedWebhookUrl) {
      warnings.push(
        'the instance webhookUrl is not the one this deployment expects, so some messages may be going elsewhere',
      )
    }
  } else {
    warnings.push(`could not read instance settings: ${settings.error}`)
  }

  // Persisting and reading are never allowed to fail the run silently: every store call is wrapped
  // so a database problem becomes a warning the operator sees rather than an exception nobody reads.
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

  const window = digestWindow(now, windowHours)

  // The day comes out of Postgres, not off the gateway. The webhook has been writing rows as the
  // messages arrived, so by the time this runs the day is already here — and unlike the gateway's
  // journal, which keeps only 24 hours and drops whatever a failed run did not collect, a row that
  // was stored stays stored. That is the whole reason the store exists.
  let stored: StoredMessage[]
  try {
    const rows = await store.loadMessages(
      new Date(window.fromSeconds * 1000),
      new Date(window.toSeconds * 1000),
      allowedGroups,
    )
    if (rows === null) {
      // Not an empty day — a store that cannot read at all. Reporting these as the same thing is how
      // a broken digest reassures everyone that nothing happened, every morning, indefinitely.
      return {
        ok: false,
        stage: 'journals',
        error:
          'no database is configured (DATABASE_URL is unset), so there are no stored messages to summarize — the digest now reads its day from Postgres, which the webhook fills',
        warnings,
      }
    }
    stored = rows
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown'
    return {
      ok: false,
      stage: 'journals',
      error: `could not read the day's messages from the database (SQLSTATE ${code})`,
      warnings,
    }
  }

  // Names for the groups, from the directory the webhook keeps up to date. A missing name costs a
  // group its label, never its messages, so a failure here is a warning.
  let chats: GreenApiChat[] = []
  try {
    const directory = await store.loadChats()
    chats = (directory ?? []).map((chat) => ({ id: chat.chatId, name: chat.name, type: 'group' }))
  } catch {
    warnings.push('could not read the chat directory, so groups are labelled by id')
  }

  // Stored rows are fed back through the SAME transcript builder the gateway path used, so every
  // rule it owns — the window test, the dedup, the media labels, the busiest-group-first ordering —
  // keeps working with no second implementation to drift.
  const transcript = buildTranscript({
    chats,
    incoming: stored.map(storedToJournal),
    outgoing: [],
    window,
    allowedGroups,
  })

  const localDate = jerusalemWallClock(now).date

  // The off switch (migration 0037), and its position in this function is the whole design.
  //
  // Everything above this line is free and reaches nobody: two gateway calls, a database read, and
  // string assembly. Everything below it is a paid model call per branch, a paid merge, and a
  // message on somebody's phone. So the switch is read HERE rather than at the top, and a
  // switched-off deployment still does its whole cheap half every morning — the log still reports
  // how many messages arrived across how many groups. That is the daily proof that the webhook is
  // still feeding the database, and it is exactly what you want to have been watching for a week
  // before you turn the expensive half on.
  let digestSwitch: DigestSwitch | null
  try {
    digestSwitch = await store.readSwitch()
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : 'unknown'
    // Not "assume on". A database we cannot question is not permission to spend.
    return {
      ok: false,
      stage: 'switch',
      error: `could not read the digest switch, so the run stopped rather than assume it is on (SQLSTATE ${code})`,
      warnings,
    }
  }
  if (digestSwitch === null || !digestSwitch.enabled) {
    const why =
      digestSwitch?.note ?? 'no switch could be read, which is read as off rather than as on'
    return {
      ok: true,
      window,
      groupCount: transcript.groups.length,
      messageCount: transcript.messageCount,
      truncationNotes: transcript.truncationNotes,
      warnings,
      // Empty, and it has to be: there is no digest. A placeholder here would be written to the
      // digests table and read later as a day that produced nothing worth saying.
      message: '',
      delivery: {
        status: 'skipped',
        reason: `the digest is switched off in the database (${why})`,
      },
    }
  }

  const summary = await summarizeDay(llm, transcript)

  // Stage 1's output is stored even when stage 2 went on to fail, because it is the half a retry
  // most wants to skip: one call per branch against the merge's single call.
  await persist('the branch summaries', () =>
    store.saveSummaries(summary.groups, transcript.groups, localDate, model),
  )

  // Branches that failed stage 1, named for the operator. The digest itself says it is incomplete
  // (summary.ts folds this into the merge's closing line), but that line is written by a model and
  // the operator needs the count from us. Pushed before the ok check so it is reported on the failed
  // path too: a stage 2 failure does not make the stage 1 losses less true.
  const lost = summary.groups.filter((group) => !group.ok)
  if (lost.length > 0) {
    warnings.push(
      `${lost.length} of ${summary.groups.length} branches could not be summarized and are missing from the digest: ${lost.map((group) => group.name).join(', ')}`,
    )
  }
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
