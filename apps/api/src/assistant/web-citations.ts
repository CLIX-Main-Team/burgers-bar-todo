// Turning a web citation into something a reader can check.
//
// Google's own search engine sits behind the routed model, and it never hands back the address of
// the page it read. Every citation arrives as a grounding redirect:
//
//   https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQEdM_F4XXvF6lGbca6v3a8
//
// So the chip under an answer names Google's redirector instead of the site, and a reader cannot
// tell a tax authority from a forum. That is audit finding F5, confirmed against production on
// 2026-09-16 and probed again on 2026-09-17: the redirect answers 302 with the real address in
// Location, in a single hop, and the annotation's title already carries the host.
//
// Resolving it costs one HEAD-shaped request per cited page, off the back of an answer that
// already paid for a model call and a search. The answer is written by this point and the reader
// is waiting, so every failure here is silent: an unresolved redirect gives a worse chip, never a
// lost or delayed answer.

export const GROUNDING_REDIRECT_HOST = 'vertexaisearch.cloud.google.com'

export interface RawCitation {
  url: string
  title: string
}

export interface ResolvedCitation {
  url: string
  title: string
  // The site the answer actually read, for display. Null when it could not be established, which
  // is the honest outcome: naming the wrong site is worse than naming none.
  host: string | null
}

export function hostOf(url: string): string | null {
  try {
    const { hostname } = new URL(url)
    return hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function isGroundingRedirect(url: string): boolean {
  return hostOf(url) === GROUNDING_REDIRECT_HOST
}

// A title that is already a bare host, which is what the engine usually sends. Used only when the
// redirect itself could not be followed: it is evidence, not a guess, but it is weaker than the
// Location header so it never overrides one.
const TITLE_AS_HOST = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/i

const hostFromTitle = (title: string): string | null =>
  TITLE_AS_HOST.test(title.trim()) ? title.trim().replace(/^www\./, '') : null

interface ResolveDeps {
  fetchImpl: typeof fetch
  timeoutMs: number
}

async function resolveOne(citation: RawCitation, deps: ResolveDeps): Promise<ResolvedCitation> {
  const fallback: ResolvedCitation = {
    url: citation.url,
    title: citation.title,
    host: hostFromTitle(citation.title),
  }
  if (!isGroundingRedirect(citation.url)) {
    return { ...fallback, host: hostOf(citation.url) ?? fallback.host }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
  try {
    const response = await deps.fetchImpl(citation.url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    })
    const location = response.headers.get('location')
    if (!location) return fallback
    const host = hostOf(location)
    if (host === null) return fallback
    return { url: location, title: citation.title, host }
  } catch {
    // Aborted, refused, offline. The citation stands as it arrived.
    return fallback
  } finally {
    clearTimeout(timer)
  }
}

export async function resolveCitations(
  citations: RawCitation[],
  deps: ResolveDeps,
): Promise<ResolvedCitation[]> {
  // Together rather than one after another: three cited pages should cost one round trip's wait,
  // not three, on a path the reader is already waiting on.
  return Promise.all(citations.map((citation) => resolveOne(citation, deps)))
}
