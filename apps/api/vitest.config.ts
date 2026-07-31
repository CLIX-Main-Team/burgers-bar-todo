import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The harness spins a real Postgres via Testcontainers and migrates it fresh,
    // which is slow to pull/boot on a cold run. Give the suite room and run test
    // files serially so a single shared container starts once (see test/setup).
    testTimeout: 120_000,
    hookTimeout: 180_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
