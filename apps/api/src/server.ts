import { buildApp } from './app.js'
import { systemClock } from './auth/clock.js'
import { createSmtpMailer } from './auth/smtp-mailer.js'
import { createAuthComponents } from './auth/wire.js'
import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { loadRootEnv } from './load-env.js'

const MS_PER_HOUR = 60 * 60 * 1000

// Process entry point: build the app and listen. The factory (buildApp) is kept
// separate so tests drive the app in-process without a socket.
async function main(): Promise<void> {
  loadRootEnv()
  const env = loadEnv()

  // Real dependencies for the running server: a Postgres pool, the system clock, the
  // argon2id defaults, and the SMTP mailer. Tests substitute the clock and mailer (see
  // the integration harness).
  const { db, pool } = createDb(env.DATABASE_URL)
  const mailer = createSmtpMailer({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER || undefined,
    password: env.SMTP_PASSWORD || undefined,
    from: env.MAIL_FROM,
  })
  const { sessionService, authService, inviteService, repo } = createAuthComponents(
    db,
    systemClock,
    mailer,
    {
      sessionTtlDays: env.SESSION_TTL_DAYS,
      inviteTtlMs: env.INVITE_TTL_HOURS * MS_PER_HOUR,
      appBaseUrl: env.APP_BASE_URL,
    },
  )

  const app = buildApp({
    corsOrigin: env.CORS_ORIGIN,
    auth: {
      sessionService,
      authService,
      inviteService,
      listUsers: (scope) => repo.listUsers(scope),
    },
  })
  app.addHook('onClose', () => pool.end())

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' })
  console.log(`API listening on http://localhost:${env.API_PORT}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
