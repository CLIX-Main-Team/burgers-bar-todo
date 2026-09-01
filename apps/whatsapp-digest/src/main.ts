import { systemClock } from './clock.js'
import { type DigestResult, runDigest } from './digest.js'
import { loadEnv } from './env.js'
import { createFileFiredState } from './fired-state.js'
import { createHttpGreenApiClient, resolveGreenApiConfig } from './green-api-client.js'
import { jerusalemWallClock } from './jerusalem-time.js'
import {
  MERGE_TIMEOUT_MS,
  createHttpLlmClient,
  resolveGroupLlmConfig,
  resolveLlmConfig,
} from './llm-client.js'
import { loadRootEnv } from './load-env.js'
import { createNoopDigestStore, createPostgresDigestStore } from './repository.js'
import { createScheduledDigest } from './schedule.js'

// The one process entrypoint (ADR-0026), in two modes from one image:
//
//   npm run once    -- a manual pass that runs now and exits, and the only way this is tested before
//                      a real 08:00 arrives. Its exit code is the run's verdict.
//   npm start       -- the long-running container, which fires once per Jerusalem local day.
//
// Every line printed here is operator-facing. None of it may carry raw chat content, a request URL
// (the Green API token is a path segment) or a response body.
//
// The digest text itself IS printed, on both paths, and that is a deliberate exception rather than
// an oversight. Sending is off until the chain has a dedicated number, so the log is currently the
// only place the owner can read what the job produced and judge whether it is any good. Withholding
// it would leave a daily run whose entire output nobody can see. It is also not raw chat: it is the
// model's own summary, the same thing the summaries and digests tables keep and are never purged of.
// Once a recipient exists this can go back to being manual-only, and it is one line.

const ONCE_FLAG = '--once'

const stamp = (): string => {
  const wall = jerusalemWallClock(systemClock.now())
  return `${wall.date} ${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`
}

const log = (message: string): void => {
  console.log(`[${stamp()}] ${message}`)
}

// The run's outcome as an operator reads it. Warnings print on both paths because a degraded digest
// that still went out is exactly the thing that otherwise passes unnoticed for weeks — and so does
// the digest, for the reason at the top of this file. There is deliberately no flag to turn the text
// off per call site: the two paths printed different things once, and the quiet one was the daily
// run, which is the only one anybody actually reads.
function report(result: DigestResult): void {
  for (const warning of result.warnings) {
    log(`warning: ${warning}`)
  }
  if (!result.ok) {
    log(`digest failed at the ${result.stage} step: ${result.error}`)
    return
  }
  for (const note of result.truncationNotes) {
    log(`incomplete: ${note}`)
  }
  log(`scanned ${result.messageCount} messages across ${result.groupCount} group chats`)
  if (result.delivery.status === 'skipped') {
    log(`not sent: ${result.delivery.reason}`)
  } else {
    log(`queued for delivery (idMessage ${result.delivery.idMessage})`)
  }
  // Only when there is one. A switched-off run is a success that produced no text, and printing an
  // empty block for it would read like a digest that came back blank.
  if (result.message.length > 0) {
    console.log(`\n--- the digest ---\n${result.message}\n------------------\n`)
  }
}

async function main(): Promise<void> {
  loadRootEnv()
  const env = loadEnv()

  // Both resolvers throw on a missing credential, and that is the whole of this app's fail-fast
  // surface: a container that cannot reach WhatsApp or the model must die at boot, where the restart
  // policy makes it obvious, rather than at 08:00 tomorrow where nobody is looking.
  const greenApi = createHttpGreenApiClient(resolveGreenApiConfig(env))
  // Two clients, one per stage. Stage 1 makes one call per branch and only restates what a group
  // said; stage 2 makes one call and decides what the whole day meant. Measured on a real chain-wide
  // day, the cheap model is not merely adequate for stage 1, it is the one that SUCCEEDS on the
  // busiest branch, where the expensive thinking model spends its whole budget reasoning and returns
  // nothing.
  const groupConfig = resolveGroupLlmConfig(env)
  // Five minutes for the merge, not the branch calls' sixty seconds: it is the one call whose
  // output grows with the size of the chain, and the one whose failure wastes every call before it.
  const llmConfig = resolveLlmConfig(env, MERGE_TIMEOUT_MS)
  const llm = createHttpLlmClient(groupConfig)
  const mergeLlm = createHttpLlmClient(llmConfig)
  // Rung 2 of the per-branch ladder is the strong model. A branch the cheap model cannot read is
  // precisely the branch worth spending on, and it is one call rather than sixty.
  const fallbackLlm = mergeLlm
  // The store is a capability, not a requirement: with no DATABASE_URL the job runs exactly as it
  // did before it had a memory, which is the only reason the no-op implementation exists.
  const store =
    env.DATABASE_URL === undefined
      ? createNoopDigestStore()
      : createPostgresDigestStore(env.DATABASE_URL)
  const dependencies = {
    greenApi,
    llm,
    mergeLlm,
    fallbackLlm,
    clock: systemClock,
    store,
    model: groupConfig.model,
    mergeModel: llmConfig.model,
  }
  const options = {
    recipient: env.WHATSAPP_DIGEST_RECIPIENT,
    allowedGroups: env.WHATSAPP_DIGEST_GROUPS,
    expectedWebhookUrl: env.WHATSAPP_WEBHOOK_URL,
  }

  // Said on every boot, first, because it is the one line that answers "can this thing message a
  // real person right now" — and the value it reports lives in an on-box .env.prod that no pull
  // request can show you.
  log(
    env.WHATSAPP_DIGEST_RECIPIENT.length === 0
      ? 'delivery is LOG-ONLY: WHATSAPP_DIGEST_RECIPIENT is blank, so every step runs and the digest is printed here instead of sent'
      : `delivery is LIVE: the digest will be sent to ...${env.WHATSAPP_DIGEST_RECIPIENT.slice(-4)}`,
  )
  log(
    groupConfig.model === llmConfig.model
      ? `both stages run ${llmConfig.model}`
      : `branches run ${groupConfig.model}, the merge runs ${llmConfig.model}`,
  )
  if (env.DATABASE_URL === undefined) {
    log('DATABASE_URL is not set: this run will not be stored anywhere')
  }
  // The other half of "can this thing spend money right now", and unlike the recipient it lives in
  // the database, so a boot line is the only place an operator sees it without running a query.
  // Best-effort by design: an unreadable switch is no reason to refuse to boot, because the run
  // itself already refuses to spend on one.
  try {
    const digestSwitch = await store.readSwitch()
    log(
      digestSwitch?.enabled === true
        ? 'the digest is switched ON: summaries will be written and, if a recipient is set, sent'
        : `the digest is switched OFF: messages are still stored, but no summaries are requested and nothing is sent (${digestSwitch?.note ?? 'no note'})`,
    )
  } catch {
    log('warning: could not read the digest switch at boot; the run reads it again when it fires')
  }
  // Said out loud on every boot, because the difference between the two is the difference between
  // digesting four branches and digesting the linked phone's owner's entire social life, and the
  // wrong one is invisible until a digest arrives carrying somebody's private group.
  if (env.WHATSAPP_DIGEST_GROUPS.length === 0) {
    log(
      'WHATSAPP_DIGEST_GROUPS is blank: EVERY group chat the linked account belongs to will be read',
    )
  } else {
    log(`restricted to ${env.WHATSAPP_DIGEST_GROUPS.length} allowed group chat(s)`)
  }

  // Retention, wrapped like every other store call: an unreachable database must not turn a
  // delivered digest into a failed run.
  const retainMessages = async (days: number): Promise<void> => {
    try {
      const purged = await store.purgeMessagesOlderThan(days)
      if (purged > 0) {
        log(`purged ${purged} stored message(s) older than ${days} days`)
      }
    } catch (error) {
      log(
        `warning: could not purge old messages: ${error instanceof Error ? error.name : 'unknown'}`,
      )
    }
  }

  if (process.argv.includes(ONCE_FLAG)) {
    log('running a single digest now')
    const result = await runDigest(dependencies, options)
    report(result)
    await retainMessages(env.WHATSAPP_MESSAGE_RETENTION_DAYS)
    // The pool holds the event loop open; without this a --once pass would print its digest and
    // then hang instead of exiting.
    await store.close()
    process.exitCode = result.ok ? 0 : 1
    return
  }

  const firedState = createFileFiredState(env.DIGEST_STATE_FILE, (warning) =>
    log(`warning: ${warning}`),
  )
  const schedule = createScheduledDigest({
    clock: systemClock,
    firedState,
    fireHour: env.DIGEST_FIRE_HOUR,
    run: async () => {
      log('firing the daily digest')
      report(await runDigest(dependencies, options))
      // Retention rides the daily fire rather than a timer of its own: it is the only other thing
      // that has to happen once a day, and a second schedule would be a second thing to get wrong.
      await retainMessages(env.WHATSAPP_MESSAGE_RETENTION_DAYS)
    },
  })

  // Compose stops a container with SIGTERM and waits ten seconds before killing it. Stopping the
  // loop lets an in-flight run finish rather than being cut off mid-send.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      log(`${signal} received, stopping after the current tick`)
      schedule.stop()
    })
  }

  log(`scheduled: the digest fires daily at ${env.DIGEST_FIRE_HOUR}:00 Asia/Jerusalem`)
  await schedule.start()
  await store.close()
  log('scheduler stopped')
}

main().catch((error: unknown) => {
  // Boot-time misconfiguration only — every runtime failure folds to a DigestResult above. The
  // message is ours (an env var name), never a gateway response, so printing it leaks nothing.
  console.error(error instanceof Error ? error.message : 'the digest failed to start')
  process.exitCode = 1
})
