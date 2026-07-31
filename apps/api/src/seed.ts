// Seed the first admin — idempotent, env-driven (ADR-0010, ADR-0005).
//
// Placeholder for the foundation slice (#28): this ticket is a walking skeleton
// and carries no auth behaviour, so there is no argon2id hashing or user upsert
// yet. The real idempotent seed (read SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD,
// hash through the same argon2id path sign-in uses, upsert one active admin)
// lands with #29. Keeping the `make seed` front door wired now means `make setup`
// is complete from the first slice; until #29 this is a no-op.
function main(): void {
  console.log('seed: no admin seed defined yet (foundation slice — see #29). Skipping.')
}

main()
