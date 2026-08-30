// The `connect-src` source for the build's Content-Security-Policy, derived from
// VITE_API_BASE_URL. Read by vite.config.ts at build time; nothing at runtime imports it.
//
// It exists because a CSP source is NOT a URL. A source expression carrying a path is
// matched **exactly** unless the path ends in a slash, so `https://host/api` refuses
// `https://host/api/auth/sign-in` — which is to say every request the app makes. The
// browser reports it as "Connecting to … violates the following Content Security Policy
// directive", and nothing else looks wrong: the API is up, CORS is fine, the URL is right.
//
// That stayed academic while the base was a bare origin. It stopped being academic when the
// mobile build moved to the Hostinger VPS, where one origin serves both halves and Traefik
// routes `/api` to the API, so the base URL grew a path for the first time.
//
// An origin is the correct granularity anyway: CSP is deciding which *server* the page may
// talk to, and the path it uses there is the app's own business.
export function connectSrcFor(apiBaseUrl: string): string {
  // A relative base (`/api`, or empty) is same-origin, which `'self'` already covers — and
  // a bare path is not a valid source expression, so emitting it would only add a parse
  // error to the policy. The browser SPA is built exactly this way.
  if (!/^https?:\/\//i.test(apiBaseUrl)) return ''
  return new URL(apiBaseUrl).origin
}
