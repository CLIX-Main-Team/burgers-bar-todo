import { describe, expect, it } from 'vitest'
import { isAuthorized, parseWebhook } from '../src/routes/whatsapp-webhook.js'

// The two halves of the webhook that can fail silently and expensively: who is allowed to write to
// the production database, and which messages survive parsing. Both are pure, so both are tested
// here without a server or a database.

describe('the webhook credential', () => {
  const TOKEN = 'dscnsdiuafkascndjhsalbcvatsvcbasn23rfregvfdg54tds'

  it('accepts the token exactly as the gateway echoes it', () => {
    expect(isAuthorized(TOKEN, TOKEN)).toBe(true)
  })

  // Green API echoes the webhookUrlToken setting into the header verbatim, and its own docs
  // contradict each other about whether that setting should carry a scheme: one page says to store
  // "Bearer AuthToken", the SetSettings example on the same page stores a bare token. Both shapes
  // have to work, in both directions, or the route rejects everything the day someone follows the
  // other half of the documentation.
  it('accepts a scheme-prefixed header against a bare configured token', () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true)
    expect(isAuthorized(`Basic ${TOKEN}`, TOKEN)).toBe(true)
  })

  it('accepts a bare header against a scheme-prefixed configured token', () => {
    expect(isAuthorized(TOKEN, `Bearer ${TOKEN}`)).toBe(true)
  })

  it('rejects a wrong token', () => {
    expect(isAuthorized('nope', TOKEN)).toBe(false)
    expect(isAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false)
  })

  it('rejects a request with no Authorization header at all', () => {
    expect(isAuthorized(undefined, TOKEN)).toBe(false)
  })

  // The failure mode worth a test of its own: with a blank configured secret the naive comparison
  // succeeds for an empty header, and a public endpoint that writes to production authenticates
  // anyone who omits the credential entirely. Blank must reject everything.
  it('rejects everything when no token is configured, rather than failing open', () => {
    expect(isAuthorized('', '')).toBe(false)
    expect(isAuthorized(undefined, '')).toBe(false)
    expect(isAuthorized('Bearer ', '')).toBe(false)
    expect(isAuthorized('anything', '')).toBe(false)
  })
})

describe('parsing a notification', () => {
  // The docs' own published example of a text message from a group chat, verbatim.
  const GROUP_TEXT = {
    typeWebhook: 'incomingMessageReceived',
    instanceData: { idInstance: 7103000000, wid: '79876543210@c.us', typeInstance: 'whatsapp' },
    timestamp: 1732268220,
    idMessage: '2D9D6721A977D369246509EBE0CE44CA',
    senderData: {
      chatId: '120363369140947676@g.us',
      chatName: 'Group',
      sender: '79001234567@c.us',
      senderName: 'John',
      senderContactName: 'John Doe',
    },
    messageData: {
      typeMessage: 'textMessage',
      textMessageData: { textMessage: 'I use Green-API to send this message to you!' },
    },
  }

  it('reads a group text message', () => {
    const parsed = parseWebhook(GROUP_TEXT)
    expect(parsed).not.toBeNull()
    expect(parsed?.chatId).toBe('120363369140947676@g.us')
    // The group and the person are different questions, and in a group they have different answers.
    expect(parsed?.senderId).toBe('79001234567@c.us')
    expect(parsed?.senderName).toBe('John')
    expect(parsed?.textMessage).toBe('I use Green-API to send this message to you!')
    // UNIX seconds, not milliseconds.
    expect(parsed?.sentAt.toISOString()).toBe('2024-11-22T09:37:00.000Z')
  })

  // The trap that would have cost the digest every link and every reply in every branch group. A
  // message containing a URL is not typeMessage "textMessage" and its body is not under
  // textMessageData — reading only the obvious field drops it with no error anywhere.
  it('reads a link message, whose body lives somewhere else entirely', () => {
    const parsed = parseWebhook({
      ...GROUP_TEXT,
      messageData: {
        typeMessage: 'extendedTextMessage',
        extendedTextMessageData: { text: 'https://example.com the new menu' },
      },
    })
    expect(parsed?.textMessage).toBe('https://example.com the new menu')
  })

  it('reads a reply, which uses the same alternate field', () => {
    const parsed = parseWebhook({
      ...GROUP_TEXT,
      messageData: {
        typeMessage: 'quotedMessage',
        extendedTextMessageData: { text: 'כן, אני מטפל בזה' },
      },
    })
    expect(parsed?.textMessage).toBe('כן, אני מטפל בזה')
  })

  it('keeps a file name and caption, which the digest renders instead of a bare placeholder', () => {
    const parsed = parseWebhook({
      ...GROUP_TEXT,
      messageData: {
        typeMessage: 'documentMessage',
        fileMessageData: { fileName: 'menu.pdf', caption: 'התפריט החדש' },
      },
    })
    expect(parsed?.fileName).toBe('menu.pdf')
    expect(parsed?.caption).toBe('התפריט החדש')
    expect(parsed?.textMessage).toBeNull()
  })

  it('falls back to the contact name when the sender has no profile name', () => {
    const parsed = parseWebhook({
      ...GROUP_TEXT,
      senderData: { ...GROUP_TEXT.senderData, senderName: undefined },
    })
    expect(parsed?.senderName).toBe('John Doe')
  })

  // Ten of the eleven notification types carry nothing we store. They are parsed to null and
  // acknowledged, never refused: refusing would have the gateway resend the same body every 60
  // seconds for a day against a verdict that is not going to change.
  it('ignores the notification types that are not incoming messages', () => {
    for (const typeWebhook of [
      'outgoingMessageStatus',
      'stateInstanceChanged',
      'incomingCall',
      'quotaExceeded',
    ]) {
      expect(parseWebhook({ ...GROUP_TEXT, typeWebhook })).toBeNull()
    }
  })

  it('returns null rather than throwing on a body it cannot read', () => {
    expect(parseWebhook(null)).toBeNull()
    expect(parseWebhook('not an object')).toBeNull()
    expect(parseWebhook({ typeWebhook: 'incomingMessageReceived' })).toBeNull()
    // A timestamp that is not a number would otherwise become an Invalid Date and a broken row.
    expect(parseWebhook({ ...GROUP_TEXT, timestamp: 'yesterday' })).toBeNull()
  })
})
