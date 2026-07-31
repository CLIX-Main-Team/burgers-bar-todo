import { hash, verify } from '@node-rs/argon2'

// The password hasher seam (ADR-0006): argon2id, hidden behind a two-method port so
// callers never touch the algorithm. Verification is behavioural — a credential is
// confirmed by a successful sign-in, never by inspecting a hash — so this interface
// deliberately exposes no way to read the parameters back out.
export interface PasswordHasher {
  hash(plain: string): Promise<string>
  verify(storedHash: string, plain: string): Promise<boolean>
}

// argon2id cost parameters. Omitted values fall back to @node-rs/argon2's argon2id
// defaults (ADR-0006). The test harness lowers these for speed — a timing change,
// not a behaviour change: `verify` reads the parameters from the encoded hash, so a
// hash written at low cost still verifies (auth plan, testing approach).
export interface Argon2Cost {
  memoryCost?: number
  timeCost?: number
  parallelism?: number
}

export function createPasswordHasher(cost: Argon2Cost = {}): PasswordHasher {
  return {
    // @node-rs/argon2 defaults to the argon2id variant, which is the ADR-0006 choice.
    hash: (plain) => hash(plain, cost),
    // A wrong hash-and-password pair returns false; a malformed stored hash throws,
    // which we treat as a failed verification rather than letting it escape to the
    // caller as a 500 — a corrupt hash must not authenticate anyone.
    verify: async (storedHash, plain) => {
      try {
        return await verify(storedHash, plain)
      } catch {
        return false
      }
    },
  }
}
