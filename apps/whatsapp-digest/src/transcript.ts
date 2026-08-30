import type { GreenApiChat, GreenApiJournalMessage } from './green-api-client.js'
import { formatJerusalemTime } from './jerusalem-time.js'

// Turning two journal reads into the one block of text the model summarizes (ADR-0026). This is the
// only place the digest decides what counts as "a group message in the last day", so every rule that
// could quietly change the answer — which chats are groups, which messages are inside the window,
// what a photo looks like as text — is here rather than spread across the run.

// The gateway returns at most this many rows per journal read, and it returns them with no flag
// saying it truncated. A day busy enough to hit the cap therefore looks exactly like a normal day
// with fewer messages, which would be a silently incomplete digest. Reaching it is reported instead.
export const GREEN_API_JOURNAL_CAP = 10_000

// The window is asked for with a few minutes of slack and then filtered exactly. The gateway applies
// `minutes` against ITS clock, not ours, so a container whose clock drifts by a minute would shave a
// minute of messages off one end of the day. Over-fetching and filtering here makes our timestamps
// the only ones that decide the boundary.
export const WINDOW_FETCH_MARGIN_MINUTES = 5

// A ceiling on how much transcript reaches the model. It is a cost and context guard, not a
// correctness one: a day this long is already unusual, and the newest messages are kept because a
// digest that misses this morning is worse than one that misses last night.
export const MAX_TRANSCRIPT_MESSAGES = 3_000

// A group chatId always ends in this. getChats is asked for group NAMES, but membership is decided
// structurally on the id, because getChats can answer with fewer chats than the journals mention
// (it is capped and activity-ordered) and a group missing from that list must still be summarized.
const GROUP_CHAT_SUFFIX = '@g.us'

const SECONDS_PER_MINUTE = 60

// What a non-text message becomes in the transcript. Dropping them would make a day of photos read
// as silence, and passing the raw typeMessage through would put English type names in a Hebrew
// summary, so each becomes a short Hebrew placeholder the model can describe.
const MESSAGE_TYPE_LABELS: Record<string, string> = {
  imageMessage: 'תמונה',
  videoMessage: 'סרטון',
  audioMessage: 'הודעה קולית',
  documentMessage: 'קובץ',
  documentWithCaptionMessage: 'קובץ',
  stickerMessage: 'מדבקה',
  locationMessage: 'מיקום',
  liveLocationMessage: 'מיקום בזמן אמת',
  contactMessage: 'איש קשר',
  contactsArrayMessage: 'אנשי קשר',
  pollMessage: 'סקר',
  pollUpdateMessage: 'הצבעה בסקר',
  reactionMessage: 'תגובה',
  groupInviteMessage: 'הזמנה לקבוצה',
  buttonsResponseMessage: 'לחיצה על כפתור',
  templateButtonReplyMessage: 'לחיצה על כפתור',
  listResponseMessage: 'בחירה מרשימה',
}

// The fallback placeholder for a type this app has never seen. Green API adds message types over
// time, so an unknown type is an expected future, not a bug — it must still appear in the transcript.
const UNKNOWN_TYPE_LABEL = 'הודעה'

// How the linked account's own messages are attributed. A journal row for an outgoing message
// carries no sender name (the sender is the instance itself), so without this every message the
// branch sent would read as coming from nobody.
const OUTGOING_SENDER_LABEL = 'אנחנו'

const UNKNOWN_SENDER_LABEL = 'לא ידוע'

// A group WhatsApp allows to have no name, shown with its id stub so two unnamed groups stay
// distinguishable in the summary.
const unnamedGroupLabel = (chatId: string): string =>
  `קבוצה ללא שם (${chatId.replace(GROUP_CHAT_SUFFIX, '')})`

// The half-open interval the digest covers, plus the `minutes` value the journal reads ask for.
// Half-open — `to` excluded — so consecutive daily runs can never both claim a message that lands
// exactly on the boundary.
export interface DigestWindow {
  fromSeconds: number
  toSeconds: number
  minutes: number
}

export function digestWindow(now: Date, hours: number): DigestWindow {
  // Journal timestamps are UNIX SECONDS; the JS clock is milliseconds. Every comparison in this
  // module happens in seconds, and this is the one conversion.
  const toSeconds = Math.floor(now.getTime() / 1000)
  const spanMinutes = Math.round(hours * 60)
  return {
    fromSeconds: toSeconds - spanMinutes * SECONDS_PER_MINUTE,
    toSeconds,
    minutes: spanMinutes + WINDOW_FETCH_MARGIN_MINUTES,
  }
}

export interface TranscriptGroup {
  chatId: string
  name: string
  lines: string[]
}

export interface DigestTranscript {
  groups: TranscriptGroup[]
  // The rows that survived every filter, in time order, as they came off the wire. The grouped
  // `lines` above are formatted for a model to read and have thrown away the ids and timestamps a
  // store needs, so the raw rows are carried alongside rather than reconstructed from the text.
  messages: GreenApiJournalMessage[]
  messageCount: number
  // Why a digest may be incomplete, empty when it is not. Carried rather than logged so the run
  // result can repeat it to the operator and the summary itself can admit it.
  truncationNotes: string[]
  text: string
}

export interface TranscriptInput {
  chats: GreenApiChat[]
  incoming: GreenApiJournalMessage[]
  outgoing: GreenApiJournalMessage[]
  window: DigestWindow
  // The chatIds this digest is allowed to read, empty meaning "every group". See isSelectedGroup.
  allowedGroups?: readonly string[]
}

const isGroupChatId = (chatId: string): boolean => chatId.endsWith(GROUP_CHAT_SUFFIX)

// Which groups a run may summarize. The suffix test alone answers "is this a group", which was
// enough while the linked account was assumed to be a dedicated bot sitting in branch groups and
// nothing else. A real phone is never that: the account that scanned the QR carries its owner's
// own group chats — a work team, a community, a news feed — and every one of them was being read,
// summarized by a model and mailed to a phone alongside the branches.
//
// So membership is now two tests, not one: a group by suffix AND, when an allowlist is configured,
// named in it. An empty allowlist keeps the original every-group behaviour, because a dedicated
// production number genuinely wants it and a deploy that forgot the variable must not fall silent.
// The protection is therefore opt-in and belongs in .env next to the credentials, which is exactly
// where the comment on WHATSAPP_DIGEST_GROUPS says so.
const isSelectedGroup = (chatId: string, allowed: readonly string[]): boolean =>
  isGroupChatId(chatId) && (allowed.length === 0 || allowed.includes(chatId))

// The readable content of one row. Media carries its caption when it has one, so a photo with
// "הזמנה הגיעה" reads as that sentence rather than as a bare placeholder.
const messageBody = (message: GreenApiJournalMessage): string => {
  const text = message.textMessage ?? message.extendedTextMessage?.text
  if (text !== undefined && text.trim().length > 0) {
    return text.trim()
  }
  const label = MESSAGE_TYPE_LABELS[message.typeMessage] ?? UNKNOWN_TYPE_LABEL
  const detail = message.fileName ?? message.caption
  return detail !== undefined && detail.trim().length > 0
    ? `[${label}: ${detail.trim()}]`
    : `[${label}]`
}

// Who a line is attributed to. senderName is the WhatsApp profile name and senderContactName is what
// the linked phone has saved for them; either is better than the raw id, which is a phone number and
// reads as noise in a summary.
const senderLabel = (message: GreenApiJournalMessage): string => {
  if (message.direction === 'outgoing') {
    return OUTGOING_SENDER_LABEL
  }
  const named = message.senderName ?? message.senderContactName
  if (named !== undefined && named.trim().length > 0) {
    return named.trim()
  }
  return message.senderId?.split('@')[0] ?? UNKNOWN_SENDER_LABEL
}

export function buildTranscript({
  chats,
  incoming,
  outgoing,
  window,
  allowedGroups = [],
}: TranscriptInput): DigestTranscript {
  const truncationNotes: string[] = []
  if (incoming.length >= GREEN_API_JOURNAL_CAP) {
    truncationNotes.push(
      `the incoming journal returned its ${GREEN_API_JOURNAL_CAP}-message cap, so the oldest part of the day is missing`,
    )
  }
  if (outgoing.length >= GREEN_API_JOURNAL_CAP) {
    truncationNotes.push(
      `the outgoing journal returned its ${GREEN_API_JOURNAL_CAP}-message cap, so the oldest part of the day is missing`,
    )
  }

  const groupNames = new Map<string, string>()
  for (const chat of chats) {
    if (chat.type === 'group' && chat.name.trim().length > 0) {
      groupNames.set(chat.id, chat.name.trim())
    }
  }

  // One pass over both directions. De-duplication is keyed on idMessage because the safety margin on
  // the window means consecutive runs overlap, and a message must not be summarized twice inside one
  // run if the gateway ever reports it on both journals.
  const seen = new Set<string>()
  const selected: GreenApiJournalMessage[] = []
  for (const message of [...incoming, ...outgoing]) {
    if (!isSelectedGroup(message.chatId, allowedGroups)) {
      continue
    }
    if (message.timestamp < window.fromSeconds || message.timestamp >= window.toSeconds) {
      continue
    }
    if (seen.has(message.idMessage)) {
      continue
    }
    seen.add(message.idMessage)
    selected.push(message)
  }

  selected.sort((a, b) => a.timestamp - b.timestamp)

  // Keep the newest when there are too many, and say so. Slicing silently here is exactly the
  // failure this module's cap reporting exists to prevent.
  const kept =
    selected.length > MAX_TRANSCRIPT_MESSAGES ? selected.slice(-MAX_TRANSCRIPT_MESSAGES) : selected
  if (kept.length < selected.length) {
    truncationNotes.push(
      `${selected.length - kept.length} of ${selected.length} messages were dropped to fit the transcript budget; the newest ${MAX_TRANSCRIPT_MESSAGES} were kept`,
    )
  }

  const byChat = new Map<string, TranscriptGroup>()
  for (const message of kept) {
    let group = byChat.get(message.chatId)
    if (group === undefined) {
      group = {
        chatId: message.chatId,
        name: groupNames.get(message.chatId) ?? unnamedGroupLabel(message.chatId),
        lines: [],
      }
      byChat.set(message.chatId, group)
    }
    group.lines.push(
      `[${formatJerusalemTime(message.timestamp)}] ${senderLabel(message)}: ${messageBody(message)}`,
    )
  }

  // Busiest group first: when a summary has to be shortened, the model should spend its words where
  // the day actually happened.
  const groups = [...byChat.values()].sort((a, b) => b.lines.length - a.lines.length)

  const text = groups.map((group) => `### ${group.name}\n${group.lines.join('\n')}`).join('\n\n')

  return { groups, messages: kept, messageCount: kept.length, truncationNotes, text }
}
