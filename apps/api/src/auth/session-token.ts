import { createHash, randomBytes } from 'node:crypto'

// The session credential (ADR-0006): an opaque, server-owned random string handed to
// the client as the bearer token, of which only a hash is ever stored. The raw token
// is the sole lookup key; losing the DB does not leak a usable token, and a stored
// row cannot be turned back into a credential.
//
// A session token is 256 bits of randomness, not a low-entropy password, so it is
// hashed with a fast one-way SHA-256 rather than argon2 — argon2's slow, salted
// stretching earns nothing against an input that cannot be brute-forced, and paying
// it on every authenticated request would tax the hot path for no gain.

// 32 bytes = 256 bits of entropy, url-safe so it rides in an Authorization header
// and a link without escaping.
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url')
}

// Deterministic: the same raw token always hashes to the same lookup key, so a
// presented bearer can be matched against the stored `token_hash`.
export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}
