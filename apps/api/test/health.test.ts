import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The health-path test that proves the walking skeleton end to end: an ephemeral
// Postgres 17 is spun and migrated fresh, the app is built, and the boot route is
// driven in-process via app.inject(). This establishes the API integration-test
// pattern later features reuse.
describe('health', () => {
  let harness: TestHarness

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  it('serves a boot/health route', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', service: 'api' })
  })
})
