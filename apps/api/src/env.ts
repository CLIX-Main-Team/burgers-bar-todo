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
