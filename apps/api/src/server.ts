import { buildApp } from './app.js'
import { systemClock } from './auth/clock.js'
import { createAuthComponents } from './auth/wire.js'
import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { loadRootEnv } from './load-env.js'

// Process entry point: build the app and listen. The factory (buildApp) is kept
// separate so tests drive the app in-process without a socket.
async function main(): Promise<void> {
  loadRootEnv()
  const env = loadEnv()

  // Real dependencies for the running server: a Postgres pool, the system clock, and
  // the argon2id defaults. Tests substitute all three (see the integration harness).
  const { db, pool } = createDb(env.DATABASE_URL)
  const { sessionService, authService } = createAuthComponents(db, systemClock, {
    sessionTtlDays: env.SESSION_TTL_DAYS,
  })

  const app = buildApp({
    corsOrigin: env.CORS_ORIGIN,
    auth: { sessionService, authService },
  })
  app.addHook('onClose', () => pool.end())

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' })
  console.log(`API listening on http://localhost:${env.API_PORT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
