import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { Db } from '../db/client.js'
import { whatsappChats, whatsappMessages } from '../db/schema.js'

// Green API's inbound webhook (ADR-0026, amended): the one public write surface in this API, and
// the only route here that is not authenticated by a user session.
//
// It exists because the digest reads its day out of Postgres rather than off the gateway, and
// something has to put the rows there. Green API pushes each message as it happens, which turns out
// to be a queue with retries rather than fire-and-forget: it waits 180 seconds for a response, and
// on anything other than 200 it pauses 60 seconds and RESENDS the same notification, keeping it
// queued for 24 hours. That single fact is what makes this safe without a polling safety net — and
// what makes the response code the most important line in the file.
//
// So the rule this route is built around: answer 200 ONLY after the row is committed. A 200 dequeues
// the notification permanently. Anything we acknowledge and then fail to store is gone from
// WhatsApp, from Green API and from us, with nothing left to reconcile against.

// The literal Green API expects. The docs name 200 three separate times as the acknowledgement that
// dequeues; 202 and 204 are not documented as acceptance, so this is not "any 2xx".
const ACK = 200

// A body larger than this is not a WhatsApp message. Message text caps at 20,000 characters, so the
// ceiling is orders of magnitude above anything legitimate and exists to stop an unbounded read.
const MAX_BODY_BYTES = 1_000_000

// The only notification type that carries a message we want. The other ten (message statuses, state
// changes, calls, blocks, quota) are acknowledged and dropped: retrying a body we will never store
// would just be a redelivery storm against a decision that will not change.
const INCOMING_MESSAGE = 'incomingMessageReceived'

const GROUP_SUFFIX = '@g.us'

// Scheme prefixes to tolerate on the credential. Green API echoes the webhookUrlToken setting into
// the Authorization header VERBATIM, and its own docs contradict each other about what belongs in
// that setting: one page instructs you to store "Bearer AuthToken", the SetSettings example on the
// same page stores a bare token with no prefix. Both therefore have to be accepted, and neither can
// be hard-coded.
const SCHEMES = ['Bearer ', 'Basic ']

// Constant-time comparison, so a wrong token cannot be discovered a character at a time by timing
// the response. timingSafeEqual throws on a length mismatch, hence the explicit length check first —
// and length alone leaks nothing an attacker does not already control.
const secretEquals = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

// True when the request carries the configured credential. A blank configured token FAILS every
// request rather than allowing it: the alternative is an endpoint that writes to the production
// database for anyone who finds the URL, reached by forgetting one line in an on-box .env file.
export function isAuthorized(header: string | undefined, configured: string): boolean {
  if (configured.length === 0 || header === undefined) {
    return false
  }
  // Compare the header as sent, and again with a scheme stripped from either side, so a token stored
  // with a prefix and a token stored bare both work without the route caring which was chosen.
  const strip = (value: string): string => {
    const scheme = SCHEMES.find((candidate) => value.startsWith(candidate))
    return scheme === undefined ? value : value.slice(scheme.length)
  }
  return secretEquals(header, configured) || secretEquals(strip(header), strip(configured))
}

// The parsed shape of one incoming-message notification. Parsed by name, never by position: the
// docs' own examples disagree on key order.
export interface WebhookMessage {
  idMessage: string
  chatId: string
  senderId: string | null
  senderName: string | null
  chatName: string | null
  typeMessage: string
  textMessage: string | null
  caption: string | null
  fileName: string | null
  sentAt: Date
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

// Pull the readable body out of whatever shape this message type uses.
//
// The trap this exists for: a message containing a URL is NOT typeMessage "textMessage". It arrives
// as "extendedTextMessage" with the body under extendedTextMessageData.text, and a reply arrives as
// "quotedMessage" with the body in the same place. Reading only textMessageData.textMessage would
// silently drop every link and every reply in every branch group — the messages most likely to
// carry an order, a photo of a delivery note, or an answer to a question.
const readBody = (messageData: Record<string, unknown>): string | null => {
  const plain = asString(asRecord(messageData.textMessageData).textMessage)
  if (plain !== null) {
    return plain
  }
  return asString(asRecord(messageData.extendedTextMessageData).text)
}

const readFile = (
  messageData: Record<string, unknown>,
): { caption: string | null; fileName: string | null } => {
  const file = asRecord(messageData.fileMessageData)
  return { caption: asString(file.caption), fileName: asString(file.fileName) }
}

// Narrow a notification body to the message we store, or null when it is not one. Null covers two
// different things on purpose — a type we ignore, and a body we could not read — because both get
// the same answer: acknowledged, because redelivering something we will never parse is a storm.
export function parseWebhook(body: unknown): WebhookMessage | null {
  const root = asRecord(body)
  if (asString(root.typeWebhook) !== INCOMING_MESSAGE) {
    return null
  }
  const idMessage = asString(root.idMessage)
  const timestamp = root.timestamp
  const senderData = asRecord(root.senderData)
  const chatId = asString(senderData.chatId)
  const messageData = asRecord(root.messageData)
  const typeMessage = asString(messageData.typeMessage)
  if (
    idMessage === null ||
    chatId === null ||
    typeMessage === null ||
    typeof timestamp !== 'number'
  ) {
    return null
  }
  const file = readFile(messageData)
  return {
    idMessage,
    chatId,
    // In a group, chatId is the group and sender is the participant; in a 1:1 they are identical.
    // This is the only reliable group-vs-DM discriminator the payload carries.
    senderId: asString(senderData.sender),
    senderName: asString(senderData.senderName) ?? asString(senderData.senderContactName),
    chatName: asString(senderData.chatName),
    typeMessage,
    textMessage: readBody(messageData),
    caption: file.caption,
    fileName: file.fileName,
    // UNIX seconds, and it is the EVENT time, so it survives redelivery unchanged and stays the
    // correct sort key for a digest that cannot rely on arrival order.
    sentAt: new Date(timestamp * 1000),
  }
}

export interface WhatsappWebhookDeps {
  db: Db
  // The shared secret configured on the instance as webhookUrlToken. Blank rejects everything.
  token: string
  // The group chatIds we may store, empty meaning every group. Applied HERE, in front of the write,
  // because storing is the irreversible step: the linked account belongs to well over a hundred
  // groups, most of them not branches, and a row written is a row kept.
  allowedGroups: readonly string[]
}

export function registerWhatsappWebhookRoutes(
  app: FastifyInstance,
  deps: WhatsappWebhookDeps,
): void {
  const allowed = (chatId: string): boolean =>
    chatId.endsWith(GROUP_SUFFIX) &&
    (deps.allowedGroups.length === 0 || deps.allowedGroups.includes(chatId))

  app.post(
    '/whatsapp/webhook',
    {
      // No preHandler: this is the one route with no session. The gateway holds a shared secret, not
      // a user account, so authentication happens in the handler against that secret.
      // Deliberately unschema'd. Green API adds notification types and fields over time, and a
      // strict body schema would reject an unknown shape — which, given a retry policy that resends
      // every 60 seconds for 24 hours, turns one unrecognised field into a day-long storm against a
      // verdict that will never change. The body is narrowed in code instead, and anything we cannot
      // use is acknowledged rather than refused.
      bodyLimit: MAX_BODY_BYTES,
    },
    async (request, reply) => {
      if (!isAuthorized(request.headers.authorization, deps.token)) {
        // 401, not 200. This is the one rejection we WANT redelivered: if the token is briefly
        // misconfigured on our side, the gateway keeps the messages queued for 24 hours and they
        // arrive once it is fixed.
        return reply.code(401).send({ error: 'unauthorized' })
      }

      const message = parseWebhook(request.body)
      if (message === null) {
        // A type we do not store, or a body we cannot read. Acknowledged so it leaves the queue.
        return reply.code(ACK).send({ ok: true, stored: false })
      }
      if (!allowed(message.chatId)) {
        // Not a branch group. Acknowledged and dropped without a trace in the database — the gate is
        // in front of the write precisely so this leaves nothing behind.
        return reply.code(ACK).send({ ok: true, stored: false })
      }

      try {
        // The directory and the message in one transaction, so a stored message always has a name to
        // be labelled with, and a failure leaves neither.
        await deps.db.transaction(async (tx) => {
          if (message.chatName !== null) {
            await tx
              .insert(whatsappChats)
              .values({ chatId: message.chatId, name: message.chatName })
              .onConflictDoUpdate({
                target: whatsappChats.chatId,
                set: { name: message.chatName, updatedAt: new Date() },
              })
          }
          await tx
            .insert(whatsappMessages)
            .values({
              idMessage: message.idMessage,
              chatId: message.chatId,
              senderId: message.senderId,
              senderName: message.senderName,
              typeMessage: message.typeMessage,
              textMessage: message.textMessage,
              caption: message.caption,
              fileName: message.fileName,
              // Everything arriving here is inbound by definition: this route is only reachable for
              // incomingMessageReceived.
              direction: 'incoming',
              sentAt: message.sentAt,
            })
            // Redelivery is expected, not exceptional — the gateway resends anything it did not see
            // a 200 for, so the same message legitimately arrives twice and collapses here.
            .onConflictDoNothing({ target: whatsappMessages.idMessage })
        })
      } catch (error) {
        // 500, so the gateway keeps it queued and brings it back in 60 seconds. This is the single
        // most important branch in the file: answering 200 here would acknowledge a message we did
        // not store, and it would then exist nowhere.
        request.log.error(
          {
            code:
              typeof error === 'object' && error !== null && 'code' in error
                ? String((error as { code: unknown }).code)
                : 'unknown',
          },
          'whatsapp webhook could not store a message',
        )
        return reply.code(500).send({ error: 'could not store the message' })
      }

      return reply.code(ACK).send({ ok: true, stored: true })
    },
  )
}
