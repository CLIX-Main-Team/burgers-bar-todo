import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { type TestHarness, createTestHarness } from './helpers/test-app.js'

// The health route, grown real (2026-09-02 audit): the static body it served since the walking
// skeleton kept answering 'ok' with the database down, and the keep-alive self-ping made an
// outage look like healthy traffic. Wired with deps it pings the database and reports the age of
// the last knowledge sync; a failed ping is a 503, which is what Render's health check, the
// compose probe, and any uptime monitor actually react to.
describe('health', () => {
  let harness: TestHarness

  beforeAll(async () => {
    harness = await createTestHarness()
  })

  afterAll(async () => {
    await harness?.close()
  })

  it('serves the health route with a live db ping and the sync age', async () => {
    const response = await harness.app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    // No sync has ever run in this harness, so the age is null, honestly.
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'api',
      db: 'up',
      syncAgeMinutes: null,
    })
  })

  it('answers 503 degraded when the database ping fails', async () => {
    const app = buildApp({
      health: {
        pingDb: () => Promise.reject(new Error('connection refused')),
        lastSyncAt: async () => undefined,
        now: () => new Date(),
      },
    })
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ status: 'degraded', db: 'down' })
    await app.close()
  })

  it('reports how many minutes ago the last sync pass finished', async () => {
    const now = new Date('2026-09-02T12:00:00.000Z')
    const app = buildApp({
      health: {
        pingDb: async () => {},
        lastSyncAt: async () => new Date('2026-09-02T11:18:00.000Z'),
        now: () => now,
      },
    })
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ db: 'up', syncAgeMinutes: 42 })
    await app.close()
  })

  it('keeps the static shape when no deps are wired (route-free boots, unit harnesses)', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', service: 'api' })
    await app.close()
  })
})
