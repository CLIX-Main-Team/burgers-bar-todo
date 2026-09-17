import { describe, expect, it, vi } from 'vitest'
import {
  GROUNDING_REDIRECT_HOST,
  hostOf,
  isGroundingRedirect,
  resolveCitations,
} from '../src/assistant/web-citations.js'

// Where a web answer actually came from.
//
// Google's own search engine, which is what sits behind the routed model, never hands back the
// page's address. Every citation arrives as a grounding redirect:
//
//   https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEdM_F4XXvF6lGbca6v3a8
//
// So the chip under an answer names Google's redirector rather than the site that was read, and a
// reader cannot tell whether a rate came from a tax authority or from a forum. That was finding F5
// in the audit, unverified until 2026-09-16 and confirmed against production the same day.
//
// Probed live on 2026-09-17: the redirect answers 302 with the real address in Location, in one
// hop, and the annotation's title already carries the host. So this is resolvable without guessing.

const redirect = (n: number): string =>
  `https://${GROUNDING_REDIRECT_HOST}/grounding-api-redirect/AUZIYQ${n}`

describe('reading a host out of a url', () => {
  it('takes the host', () => {
    expect(hostOf('https://lappa.org/guides/vat/israel-guide/')).toBe('lappa.org')
  })

  it('drops a leading www, which is noise on a chip', () => {
    expect(hostOf('https://www.gov.il/en/service/vat')).toBe('gov.il')
  })

  it('returns null rather than throwing on something that is not a url', () => {
    expect(hostOf('not a url')).toBeNull()
  })
})

describe('spotting the redirect', () => {
  it('knows one when it sees it', () => {
    expect(isGroundingRedirect(redirect(1))).toBe(true)
  })

  it('leaves an ordinary address alone', () => {
    expect(isGroundingRedirect('https://kolzchut.org.il/he/notice')).toBe(false)
  })
})

describe('resolveCitations', () => {
  const okFetch = (location: string) =>
    vi.fn(async () => new Response(null, { status: 302, headers: { location } }))

  it('follows the redirect to the real page and names the real host', async () => {
    const fetchImpl = okFetch('https://lappa.org/guides/vat/israel-guide/')
    const [resolved] = await resolveCitations([{ url: redirect(1), title: 'lappa.org' }], {
      fetchImpl,
      timeoutMs: 2_000,
    })
    expect(resolved).toEqual({
      url: 'https://lappa.org/guides/vat/israel-guide/',
      title: 'lappa.org',
      host: 'lappa.org',
    })
  })

  it('never calls the network for an address that is already real', async () => {
    const fetchImpl = vi.fn()
    const [resolved] = await resolveCitations(
      [{ url: 'https://kolzchut.org.il/he/notice', title: 'kolzchut.org.il' }],
      { fetchImpl, timeoutMs: 2_000 },
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(resolved?.host).toBe('kolzchut.org.il')
  })

  // The answer is already written and the reader is waiting. A redirect that will not resolve is
  // worth a worse chip, never a lost answer.
  it('keeps the citation when the redirect cannot be resolved', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    })
    const [resolved] = await resolveCitations([{ url: redirect(2), title: 'calcalist.co.il' }], {
      fetchImpl,
      timeoutMs: 2_000,
    })
    expect(resolved?.url).toBe(redirect(2))
    // The title is the only honest thing left to name the source with.
    expect(resolved?.host).toBe('calcalist.co.il')
  })

  it('falls back to no host rather than inventing one', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 500 }))
    const [resolved] = await resolveCitations([{ url: redirect(3), title: 'Some page title' }], {
      fetchImpl,
      timeoutMs: 2_000,
    })
    expect(resolved?.host).toBeNull()
  })

  it('resolves several citations without waiting for them one at a time', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: 'https://gov.il/a/b' } }),
    )
    const resolved = await resolveCitations(
      [
        { url: redirect(4), title: 'a' },
        { url: redirect(5), title: 'b' },
        { url: redirect(6), title: 'c' },
      ],
      { fetchImpl, timeoutMs: 2_000 },
    )
    expect(resolved).toHaveLength(3)
    expect(resolved.every((citation) => citation.host === 'gov.il')).toBe(true)
  })

  it('does not hang the answer on a redirect that never replies', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const [resolved] = await resolveCitations([{ url: redirect(7), title: 'slow.example' }], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    })
    expect(resolved?.url).toBe(redirect(7))
  })
})
