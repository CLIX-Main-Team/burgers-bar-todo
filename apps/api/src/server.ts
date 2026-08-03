import { buildApp } from './app.js'
import { systemClock } from './auth/clock.js'
import { createSmtpMailer } from './auth/smtp-mailer.js'
import { createAuthComponents } from './auth/wire.js'
import { createDb } from './db/client.js'
import { loadEnv } from './env.js'
import { loadRootEnv } from './load-env.js'

const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_MINUTE = 60 * 1000

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
  const { sessionService, authService, inviteService, accountService, resetService, repo } =
    createAuthComponents(db, systemClock, mailer, {
      sessionTtlDays: env.SESSION_TTL_DAYS,
      inviteTtlMs: env.INVITE_TTL_HOURS * MS_PER_HOUR,
      resetTtlMs: env.RESET_TTL_HOURS * MS_PER_HOUR,
      appBaseUrl: env.APP_BASE_URL,
      resetRateLimit: {
        perEmail: env.RESET_RATE_LIMIT_PER_EMAIL,
        perIp: env.RESET_RATE_LIMIT_PER_IP,
        windowMs: env.RESET_RATE_LIMIT_WINDOW_MINUTES * MS_PER_MINUTE,
      },
    })

  const app = buildApp({
    corsOrigin: env.CORS_ORIGIN,
    auth: {
      sessionService,
      authService,
      inviteService,
      accountService,
      resetService,
      listUsers: (scope) => repo.listUsers(scope),
    },
  })
  app.addHook('onClose', () => pool.end())

  // Prefer the platform-injected PORT (Render, ADR-0017); fall back to API_PORT for
  // local dev. Host 0.0.0.0 so the container's published port is reachable.
  const port = env.PORT ?? env.API_PORT
  await app.listen({ port, host: '0.0.0.0' })
  console.log(`API listening on http://localhost:${port}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
