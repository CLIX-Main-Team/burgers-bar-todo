import { z } from 'zod'

// The API's view of the shared env surface (ADR-0010). Only the values this
// foundation slice needs are required here; the auth lifetimes, SMTP, and seed
// credentials are part of the surface but are consumed by later slices, so they
// are not validated at boot yet.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
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
