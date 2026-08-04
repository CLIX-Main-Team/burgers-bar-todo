import { z } from 'zod'

// The parsed service-account credential the Drive adapter authenticates with (ADR-0021). The env
// carries it base64-encoded; this schema decodes it, JSON-parses it, and pins the two fields the
// JWT client needs — so any of "not base64", "not JSON", or "missing client_email/private_key"
// surfaces as a boot-time configuration error with a clear message rather than a runtime failure on
// the first sync. The shape it produces (clientEmail/privateKey) is what createGoogleDriveClient takes.
export interface ServiceAccountKey {
  clientEmail: string
  privateKey: string
}

const serviceAccountJsonSchema = z.object({
  client_email: z.string().min(1),
  private_key: z.string().min(1),
})

const serviceAccountKeySchema = z
  .string()
  .min(1, { message: 'must be set (base64-encoded service-account JSON)' })
  .transform((raw, ctx): ServiceAccountKey => {
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'))
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be base64-encoded JSON' })
      return z.NEVER
    }
    const key = serviceAccountJsonSchema.safeParse(parsed)
    if (!key.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'decoded JSON must include client_email and private_key',
      })
      return z.NEVER
    }
    return { clientEmail: key.data.client_email, privateKey: key.data.private_key }
  })

// The API's view of the shared env surface (ADR-0010). Values are added here as the
// slice that needs them at boot lands; the SMTP settings and seed credentials are
// part of the surface but are consumed by later slices or the seed CLI, so they are
// not validated at API boot yet.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  // The local/dev port (ADR-0010). In prod the platform assigns the port and injects
  // it as PORT (see below), so the server prefers PORT and falls back to API_PORT.
  API_PORT: z.coerce.number().int().positive().default(3000),
  // Render (and most PaaS hosts) inject the listen port as PORT and route public
  // traffic to it (ADR-0017). Optional: unset locally, where API_PORT governs.
  PORT: z.coerce.number().int().positive().optional(),
  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),
  // The sliding session idle window (ADR-0006, value in ADR-0010). Read at boot to
  // configure the session service.
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  // Public base URL the app is reached at; used to build the one-time invite/reset
  // links that go out by email (ADR-0008).
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  // The invite token lifetime, ~1 week (INVITE_TTL_HOURS; ADR-0006, value in ADR-0010).
  INVITE_TTL_HOURS: z.coerce.number().int().positive().default(168),
  // The reset token lifetime, ~1 hour (RESET_TTL_HOURS; ADR-0006, value in ADR-0010).
  // Short by design: a reset link is low-risk if it leaks (story 28).
  RESET_TTL_HOURS: z.coerce.number().int().positive().default(1),
  // Reset-request rate limits (story 30): the endpoint is throttled per email and per IP
  // over a fixed window, and a throttled request returns the same generic confirmation as
  // any other, so throttling leaks no signal. Sized generously for real staff and small
  // enough to blunt inbox spam and probing; tunable per deploy without a code change.
  RESET_RATE_LIMIT_PER_EMAIL: z.coerce.number().int().positive().default(5),
  RESET_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(20),
  RESET_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(60),
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
  // --- Assistant LLM provider (ADR-0013, ADR-0018) ---
  // The provider is a boot-time switch: openrouter (default) reaches the broker, gemini reaches
  // Google's OpenAI-compatible endpoint directly. Exactly one is live per process. The selected
  // provider's key is required and validated at boot by resolveLlmConfig (missing → fail fast, see
  // assistant/llm-client.ts); the other provider's key may be left unset.
  ASSISTANT_PROVIDER: z.enum(['openrouter', 'gemini']).default('openrouter'),
  // Overrides the selected preset's default routed model when set (openrouter →
  // google/gemini-2.5-flash, gemini → gemini-flash-latest). A one-line model swap (ADR-0013).
  ASSISTANT_MODEL: z.string().optional(),
  // The OpenRouter broker key — required when ASSISTANT_PROVIDER=openrouter.
  OPENROUTER_API_KEY: z.string().optional(),
  // The native Gemini key — required when ASSISTANT_PROVIDER=gemini (ADR-0018).
  GEMINI_API_KEY: z.string().optional(),
  // --- Assistant Google Drive knowledge corpus (ADR-0004, ADR-0014, ADR-0021) ---
  // The two credentials the real Drive adapter needs, both REQUIRED so a misconfigured deploy
  // fails loudly at boot rather than silently running a permanently empty knowledge base. Only the
  // running server's boot reads these (server.ts calls loadEnv); the integration harness builds
  // buildApp directly with a fake Drive and never calls loadEnv, so tests are unaffected.
  //
  // The service account's JSON key, base64-encoded (base64 sidesteps the newline/quoting hazards of
  // the raw JSON's private_key). Decoded, JSON-parsed, and checked for client_email / private_key
  // here, so a malformed key is a boot failure, not a first-sync surprise.
  GOOGLE_SERVICE_ACCOUNT_JSON: serviceAccountKeySchema,
  // The Drive file id of the shared corpus folder — the trailing path segment of the folder URL.
  // Scopes every Drive read server-side to this one folder (ADR-0021).
  DRIVE_FOLDER_ID: z.string().min(1),
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
