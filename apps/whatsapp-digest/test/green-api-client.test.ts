import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  REDACTED_TOKEN,
  createHttpGreenApiClient,
  createTokenRedactor,
  resolveGreenApiConfig,
} from '../src/green-api-client.js'

// A token with regex metacharacters in it, because the redactor must not be built by interpolating a
// secret into a pattern — the classic way that escaping bug leaks the very thing it hides.
const TOKEN = 'a1b2$c3.d4*e5(f6)'

const client = (fetchImpl: typeof fetch) => {
  vi.stubGlobal('fetch', fetchImpl)
  return createHttpGreenApiClient(
    resolveGreenApiConfig(
      {
        GREEN_API_URL: 'https://7107.api.greenapi.com',
        GREEN_API_ID_INSTANCE: '710722719110',
        GREEN_API_TOKEN_INSTANCE: TOKEN,
      },
      // Zero delay: the retry path is exercised without the suite sleeping through it.
      { retryDelayMs: 0 },
    ),
  )
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createTokenRedactor', () => {
  it('scrubs a token containing regex metacharacters', () => {
    const redact = createTokenRedactor(TOKEN)
    expect(redact(`https://host/waInstance1/getChats/${TOKEN}`)).not.toContain(TOKEN)
    expect(redact(`https://host/waInstance1/getChats/${TOKEN}`)).toContain(REDACTED_TOKEN)
  })

  it('leaves text alone when there is no token to hide', () => {
    expect(createTokenRedactor('')('anything at all')).toBe('anything at all')
  })
})

// The token is the LAST PATH SEGMENT of every request URL, so anything that echoes a URL — a status
// message, a thrown fetch error, a stack — is a credential leak. These are the tests that prove it
// cannot happen, and they assert on the absence of the secret rather than on any wording.
describe('the credential boundary', () => {
  it('keeps the token out of a non-2xx failure', async () => {
    const api = client(async () => jsonResponse({ message: 'nope' }, 401))
    const result = await api.getStateInstance()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).not.toContain(TOKEN)
  })

  it('keeps the token out of a thrown network error that quotes the URL', async () => {
    // undici puts the full request URL into an error's message, stack and cause. The client reads
    // the error CLASS only, which is what this proves.
    const api = client(async (input) => {
      throw new Error(`connect ECONNREFUSED ${String(input)}`)
    })
    const result = await api.getChats()
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).not.toContain(TOKEN)
  })

  it('keeps the token out of an unexpected-body failure', async () => {
    const api = client(async () => jsonResponse({ unexpected: true }))
    const result = await api.lastIncomingMessages(1440)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).not.toContain(TOKEN)
  })
})

describe('retrying', () => {
  it('retries a read through the transient class', async () => {
    let calls = 0
    const api = client(async () => {
      calls += 1
      return jsonResponse({ message: 'busy' }, 500)
    })
    const result = await api.getChats()
    expect(result.ok).toBe(false)
    expect(calls).toBe(3)
  })

  it('does not retry a read that failed for a semantic reason', async () => {
    let calls = 0
    const api = client(async () => {
      calls += 1
      return jsonResponse({ message: 'unauthorized' }, 400)
    })
    await api.getChats()
    expect(calls).toBe(1)
  })

  it('never retries a send, because a retried send is a second message on someone phone', async () => {
    let calls = 0
    const api = client(async () => {
      calls += 1
      return jsonResponse({ message: 'busy' }, 500)
    })
    const result = await api.sendMessage({ chatId: '972501234567@c.us', message: 'שלום' })
    expect(result.ok).toBe(false)
    expect(calls).toBe(1)
  })
})

describe('response narrowing', () => {
  it('reads the instance state', async () => {
    const api = client(async () => jsonResponse({ stateInstance: 'notAuthorized' }))
    const result = await api.getStateInstance()
    expect(result).toEqual({ ok: true, state: 'notAuthorized' })
  })

  it('treats a state string it does not recognise as a failure', async () => {
    const api = client(async () => jsonResponse({ stateInstance: 'somethingNew' }))
    const result = await api.getStateInstance()
    expect(result.ok).toBe(false)
  })

  it('drops a journal row with no id, chat or timestamp rather than half-carrying it', async () => {
    const api = client(async () =>
      jsonResponse([
        { idMessage: 'a', chatId: 'g@g.us', timestamp: 100, typeMessage: 'textMessage' },
        { idMessage: 'b', typeMessage: 'textMessage' },
      ]),
    )
    const result = await api.lastIncomingMessages(1440)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]?.direction).toBe('incoming')
  })

  it('reports a send that came back without an idMessage', async () => {
    const api = client(async () => jsonResponse({}))
    const result = await api.sendMessage({ chatId: '972501234567@c.us', message: 'שלום' })
    expect(result.ok).toBe(false)
  })
})
