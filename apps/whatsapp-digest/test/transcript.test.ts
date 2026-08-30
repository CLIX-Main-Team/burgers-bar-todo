import { describe, expect, it } from 'vitest'
import type { GreenApiChat, GreenApiJournalMessage } from '../src/green-api-client.js'
import {
  GREEN_API_JOURNAL_CAP,
  MAX_TRANSCRIPT_MESSAGES,
  buildTranscript,
  digestWindow,
} from '../src/transcript.js'

// A fixed instant so every window in this file is arithmetic rather than wall-clock luck.
const NOW = new Date('2026-08-27T09:00:00Z')
const WINDOW = digestWindow(NOW, 24)

const STAFF_GROUP = '972500000001-1581234048@g.us'
const OTHER_GROUP = '972500000002-1581234049@g.us'
const PRIVATE_CHAT = '972501234567@c.us'

const chats: GreenApiChat[] = [
  { id: STAFF_GROUP, name: 'דיזנגוף - צוות', type: 'group' },
  { id: OTHER_GROUP, name: 'נמל חיפה - צוות', type: 'group' },
  { id: PRIVATE_CHAT, name: 'יוסי', type: 'user' },
]

let sequence = 0

function message(overrides: Partial<GreenApiJournalMessage> = {}): GreenApiJournalMessage {
  sequence += 1
  return {
    idMessage: `msg-${sequence}`,
    timestamp: WINDOW.toSeconds - 3600,
    typeMessage: 'textMessage',
    chatId: STAFF_GROUP,
    direction: 'incoming',
    senderName: 'יוסי',
    textMessage: 'הלחם נגמר',
    ...overrides,
  }
}

const build = (incoming: GreenApiJournalMessage[], outgoing: GreenApiJournalMessage[] = []) =>
  buildTranscript({ chats, incoming, outgoing, window: WINDOW })

describe('digestWindow', () => {
  it('spans the requested hours and over-fetches by the safety margin', () => {
    expect(WINDOW.toSeconds - WINDOW.fromSeconds).toBe(24 * 60 * 60)
    // The journal read asks for more than the window it will actually keep, so gateway clock skew
    // cannot shave messages off either end.
    expect(WINDOW.minutes).toBeGreaterThan(24 * 60)
  })
})

describe('buildTranscript window boundaries', () => {
  it('includes a message exactly on the opening edge', () => {
    const transcript = build([message({ timestamp: WINDOW.fromSeconds })])
    expect(transcript.messageCount).toBe(1)
  })

  it('excludes a message one second before the opening edge', () => {
    const transcript = build([message({ timestamp: WINDOW.fromSeconds - 1 })])
    expect(transcript.messageCount).toBe(0)
  })

  it('includes a message one second before the closing edge', () => {
    const transcript = build([message({ timestamp: WINDOW.toSeconds - 1 })])
    expect(transcript.messageCount).toBe(1)
  })

  it('excludes a message exactly on the closing edge, so consecutive days cannot both claim it', () => {
    const transcript = build([message({ timestamp: WINDOW.toSeconds })])
    expect(transcript.messageCount).toBe(0)
  })
})

describe('buildTranscript chat selection', () => {
  it('keeps group chats and drops private ones', () => {
    const transcript = build([
      message({ chatId: STAFF_GROUP }),
      message({ chatId: PRIVATE_CHAT, textMessage: 'שיחה פרטית' }),
    ])
    expect(transcript.messageCount).toBe(1)
    expect(transcript.text).not.toContain('שיחה פרטית')
  })

  it('labels a group by name from getChats', () => {
    const transcript = build([message({ chatId: STAFF_GROUP })])
    expect(transcript.text).toContain('דיזנגוף - צוות')
  })

  it('still summarizes a group getChats never mentioned, labelling it by id', () => {
    // getChats is capped and activity-ordered, so a group can have messages and no entry. Membership
    // is decided on the chatId, never on the chat list, precisely so this message is not lost.
    const missing = '972500000009-1581234099@g.us'
    const transcript = build([message({ chatId: missing, textMessage: 'המקרר לא עובד' })])
    expect(transcript.messageCount).toBe(1)
    expect(transcript.text).toContain('המקרר לא עובד')
  })

  it('includes both incoming and outgoing messages', () => {
    const transcript = build(
      [message({ textMessage: 'יש בעיה במקרר' })],
      [message({ direction: 'outgoing', senderName: undefined, textMessage: 'שולח טכנאי' })],
    )
    expect(transcript.messageCount).toBe(2)
    expect(transcript.text).toContain('יש בעיה במקרר')
    expect(transcript.text).toContain('שולח טכנאי')
  })

  it('de-duplicates a message reported on both journals', () => {
    const duplicated = message({ idMessage: 'same-id' })
    const transcript = build([duplicated], [{ ...duplicated, direction: 'outgoing' }])
    expect(transcript.messageCount).toBe(1)
  })
})

describe('buildTranscript message rendering', () => {
  it('renders a photo as a Hebrew placeholder rather than dropping it', () => {
    const transcript = build([message({ typeMessage: 'imageMessage', textMessage: undefined })])
    expect(transcript.messageCount).toBe(1)
    expect(transcript.text).toContain('[תמונה]')
  })

  it('carries a media caption into the placeholder', () => {
    const transcript = build([
      message({ typeMessage: 'imageMessage', textMessage: undefined, caption: 'המשלוח הגיע' }),
    ])
    expect(transcript.text).toContain('המשלוח הגיע')
  })

  it('renders a message type it has never seen instead of crashing on it', () => {
    // Green API adds message types over time; an unknown one is an expected future, not a bug.
    const transcript = build([
      message({ typeMessage: 'someFutureMessageType', textMessage: undefined }),
    ])
    expect(transcript.messageCount).toBe(1)
    expect(transcript.text).toContain('[הודעה]')
  })

  it('attributes an outgoing message to us when the journal names no sender', () => {
    const transcript = build([], [message({ direction: 'outgoing', senderName: undefined })])
    expect(transcript.text).toContain('אנחנו')
  })
})

describe('buildTranscript truncation reporting', () => {
  it('reports nothing on an ordinary day', () => {
    const transcript = build([message()])
    expect(transcript.truncationNotes).toEqual([])
  })

  it('reports the journal cap, because a capped read looks exactly like a quiet day', () => {
    const capped = Array.from({ length: GREEN_API_JOURNAL_CAP }, () => message())
    const transcript = build(capped)
    expect(transcript.truncationNotes.join(' ')).toContain(String(GREEN_API_JOURNAL_CAP))
  })

  it('keeps the newest messages when over budget and says how many it dropped', () => {
    const overBudget = Array.from({ length: MAX_TRANSCRIPT_MESSAGES + 10 }, (_, index) =>
      message({ timestamp: WINDOW.fromSeconds + index }),
    )
    const transcript = build(overBudget)
    expect(transcript.messageCount).toBe(MAX_TRANSCRIPT_MESSAGES)
    expect(transcript.truncationNotes.join(' ')).toContain('10')
  })
})

// The allowlist. A group passes the suffix test and is still excluded unless the run names it,
// which is the only thing standing between a personal linked phone and its owner's private groups
// reaching a model. Blank keeps the every-group behaviour a dedicated production number wants.
describe('buildTranscript group allowlist', () => {
  const both = [message({ chatId: STAFF_GROUP }), message({ chatId: OTHER_GROUP })]

  it('reads every group when the allowlist is empty', () => {
    const transcript = buildTranscript({
      chats,
      incoming: both,
      outgoing: [],
      window: WINDOW,
      allowedGroups: [],
    })
    expect(transcript.groups.map((group) => group.chatId).sort()).toEqual(
      [STAFF_GROUP, OTHER_GROUP].sort(),
    )
  })

  it('drops a group the allowlist does not name', () => {
    const transcript = buildTranscript({
      chats,
      incoming: both,
      outgoing: [],
      window: WINDOW,
      allowedGroups: [STAFF_GROUP],
    })
    expect(transcript.groups).toHaveLength(1)
    expect(transcript.groups[0]?.chatId).toBe(STAFF_GROUP)
    expect(transcript.messageCount).toBe(1)
  })

  it('never lets a private chat in, even when the allowlist names it', () => {
    const transcript = buildTranscript({
      chats,
      incoming: [message({ chatId: PRIVATE_CHAT })],
      outgoing: [],
      window: WINDOW,
      allowedGroups: [PRIVATE_CHAT],
    })
    expect(transcript.groups).toHaveLength(0)
  })
})
