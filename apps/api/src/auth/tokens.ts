import { createHash, randomBytes } from 'node:crypto'
import type { Clock } from './clock.js'
import type { AuthRepository } from './repository.js'

// The one shared token primitive behind both invite and reset (ADR-0006, ADR-0010):
// generate an opaque random value, store only its hash, carry the raw value in the link
// once and never persist it, and issue/consume it single-use with a purpose and an
// expiry against the single auth_tokens table. Invite and reset differ only in purpose
// and lifetime, so this is one module, not two — #31 uses the invite purpose; reset
// (#34) reuses it unchanged.

export type TokenPurpose = 'invite' | 'reset'

// Like the session credential, a token is 256 bits of randomness — not a low-entropy
// password — so it is hashed with a fast one-way SHA-256, not argon2: stretching earns
// nothing against an input that cannot be brute-forced. The raw value is the sole lookup
// key and exists outside the DB exactly once, in the one-time link.
function generateRawToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

export interface TokenService {
  // Mint a token for a user and a purpose, store only its hash with an expiry `ttlMs`
  // out from now, and return the raw value — the one time it exists outside the client.
  issue(userId: string, purpose: TokenPurpose, ttlMs: number): Promise<string>
  // Validate and atomically spend a presented token: it must match a stored hash for
  // this purpose, be unused, and be unexpired. On success it is marked used and the
  // owning user id is returned; every failure mode (unknown, wrong purpose, already
  // used, expired) returns undefined, so a caller cannot tell them apart. Single-use and
  // expiry are enforced in one conditional write, so a double-consume cannot race.
  consume(rawToken: string, purpose: TokenPurpose): Promise<string | undefined>
}

export function createTokenService(repo: AuthRepository, clock: Clock): TokenService {
  return {
    issue: async (userId, purpose, ttlMs) => {
      const now = clock.now()
      const rawToken = generateRawToken()
      await repo.insertAuthToken({
        userId,
        purpose,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(now.getTime() + ttlMs),
        now,
      })
      return rawToken
    },

    consume: async (rawToken, purpose) => {
      const result = await repo.consumeAuthToken(hashToken(rawToken), purpose, clock.now())
      return result?.userId
    },
  }
}
