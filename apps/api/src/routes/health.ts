import { healthResponseSchema } from '@burgers/shared'
import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

// The boot/health route, grown real (2026-09-02 audit): the static body it served since the
// walking skeleton kept answering 'ok' with the database down — and the keep-alive self-ping
// turned an outage into healthy-looking traffic. With deps wired it pings the database (one
// SELECT 1, capped so a hung pool cannot hang the probe) and reports the age of the last
// knowledge sync; a failed ping answers 503, which is what Render's health check, the compose
// probe, and any uptime monitor actually react to. Without deps (unit harnesses, route-free
// boots) the original static shape stands.
export interface HealthRouteDeps {
  pingDb: () => Promise<void>
  lastSyncAt: () => Promise<Date | undefined>
  now: () => Date
}

// Under the compose probe's 5s timeout, and short enough that a wedged pool reads as down.
const DB_PING_TIMEOUT_MS = 1500

const within = (work: Promise<void>, ms: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('db ping timed out')), ms)
    work.then(
      () => {
        clearTimeout(timer)
        resolve()
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

export function registerHealthRoute(app: FastifyInstance, deps?: HealthRouteDeps): void {
  app
    .withTypeProvider<ZodTypeProvider>()
    .get(
      '/health',
      { schema: { response: { 200: healthResponseSchema, 503: healthResponseSchema } } },
      async (_request, reply) => {
        if (!deps) {
          return { status: 'ok', service: 'api' } as const
        }
        try {
          await within(deps.pingDb(), DB_PING_TIMEOUT_MS)
        } catch {
          return reply.code(503).send({ status: 'degraded', service: 'api', db: 'down' as const })
        }
        // Informational only — the db answered, so a failed cursor read never fails the probe.
        let syncAgeMinutes: number | null = null
        try {
          const last = await deps.lastSyncAt()
          if (last !== undefined) {
            syncAgeMinutes = Math.max(
              0,
              Math.round((deps.now().getTime() - last.getTime()) / 60000),
            )
          }
        } catch {}
        return { status: 'ok' as const, service: 'api' as const, db: 'up' as const, syncAgeMinutes }
      },
    )
}
