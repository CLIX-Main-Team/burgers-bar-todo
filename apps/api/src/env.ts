import { z } from 'zod'

// The API's view of the shared env surface (ADR-0010). Values are added here as the
// slice that needs them at boot lands; the SMTP settings and seed credentials are
// part of the surface but are consumed by later slices or the seed CLI, so they are
// not validated at API boot yet.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  // The sliding session idle window (ADR-0006, value in ADR-0010). Read at boot to
  // configure the session service.
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  // Public base URL the app is reached at; used to build the one-time invite/reset
  // links that go out by email (ADR-0008).
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  // The invite token lifetime, ~1 week (INVITE_TTL_HOURS; ADR-0006, value in ADR-0010).
  INVITE_TTL_HOURS: z.coerce.number().int().positive().default(168),
  // SMTP transport for the mailer port (ADR-0008): mailpit locally, Gmail in prod, same
  // code path. The defaults point at the local mailpit so `make dev` sends mail with no
  // extra configuration; prod overrides host/port/secure/credentials via the env.
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  // A plain env string is either "true" or "false"; z.coerce.boolean would read any
  // non-empty string (including "false") as true, so parse it explicitly.
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Empty by default (mailpit needs no auth); when set, the two travel together (Gmail).
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('Burgers Bar <no-reply@burgers.local>'),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}
