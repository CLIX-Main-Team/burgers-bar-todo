// The bearer session token lives in persistent client-side storage (ADR-0006,
// ui-flow: session persistence). Persistent — not session — storage is what makes
// "stay signed in across restarts" the default and only mode: closing and reopening
// the app keeps the token, and only an explicit logout or genuine idle expiry clears
// it. There is no "remember me" toggle; this is the whole of that behaviour.
//
// This module is the single owner of that storage key. The API client reads the token
// here on every call, and the session provider writes it on sign-in and clears it on
// logout, so nothing else touches localStorage for the session.
const TOKEN_KEY = 'burgers.session.token'

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    // A storage exception (private-mode quotas, disabled storage) is treated as "no
    // session" rather than crashing the app; the user simply lands on login.
    return null
  }
}

export function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // If persistence fails the token is still held in memory for this run by the
    // session provider; the user stays signed in until the tab closes.
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to do — a storage that cannot be read cannot hold a stale token.
  }
}
