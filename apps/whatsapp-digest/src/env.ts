import { z } from 'zod'

// The digest's own env edge (ADR-0026), the satellite-entrypoint pattern assistant-probe.ts sets:
// only what this job needs, so it boots without the database URL, the SMTP settings and the Drive
// credentials a full API boot demands. It deliberately does not import apps/api's env — this app
// deploys as its own container and must not couple to the API's configuration surface.
//
// Parsed once, at boot, by main(). Boot-time misconfiguration is the only thing in this workspace
// that throws: everything downstream — a gateway that is not authorized, a model timeout, a send
// the gateway refuses — folds to a result instead, so the one loud failure is the one an operator
// can actually fix.
const digestEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // --- Green API gateway (ADR-0026) ---
  // All three REQUIRED: without them the job cannot reach WhatsApp at all, so it fails fast at boot
  // rather than limping to a permanently silent no-op that reads exactly like a quiet day.
  //
  // The per-instance API host, copied from the Green API console. Older instances answer on
  // https://api.green-api.com; newer ones get a sharded host like https://7103.api.greenapi.com.
  // Hardcoding either one 403s or 404s on the other, so it is configuration, never a constant.
  GREEN_API_URL: z.string().url(),
  // The instance id. It rides in the URL PATH, glued straight onto the literal prefix `waInstance`
  // with no separator; a wrong value comes back as HTTP 403 Forbidden, not 401.
  GREEN_API_ID_INSTANCE: z.string().min(1),
  // A standing secret, and an unusual one: Green API accepts no Authorization header — this token
  // is the LAST PATH SEGMENT of every request URL. That is what makes a logged URL a credential
  // leak, and why the client builds its URLs inside a private closure and never puts one, or a
  // response body, into an error (green-api-client.ts). A wrong value comes back as HTTP 401.
  GREEN_API_TOKEN_INSTANCE: z.string().min(1),
  // --- The digest itself (ADR-0026) ---
  // The one number the daily digest is sent to, and it is LEFT BLANK ON PURPOSE, exactly as the
  // API's Firebase pair is: with it blank the job still checks the gateway, scans every group chat,
  // builds the transcript, writes the Hebrew summary and reports it — and sends nothing. So
  // switching sending on is this one value, not a release, and every other step is exercised in
  // production long before a message can reach a real phone. Blank is a NORMAL, SUCCESSFUL run and
  // not a configuration error, which is the whole point of the refine: it accepts the empty string
  // and rejects a malformed number.
  //
  // A non-blank value is digits only, full international format — +972-50-123-4567 is 972501234567.
  // No plus, no national leading zero, no spaces or dashes: the app builds the chatId as
  // `<digits>@c.us`, and a malformed number would be a silent misdelivery, not a boot failure.
  WHATSAPP_DIGEST_RECIPIENT: z
    .string()
    .trim()
    .default('')
    // The leading digit may not be 0, and that exclusion is the point rather than a detail: 0501234567
    // is how an Israeli number is written everywhere else, it is a plausible thing to paste in here,
    // and WhatsApp would read it as a different number entirely. Rejecting it at boot turns a silent
    // misdelivery into a startup error naming the variable.
    .refine((value) => value.length === 0 || /^[1-9]\d{6,14}$/.test(value), {
      message:
        'must be digits only in full international format (no +, no leading 0, no separators), or blank',
    }),
  // Which group chats the digest may read, as a comma-separated list of Green API chat ids
  // (`120363422645974630@g.us`). BLANK MEANS EVERY GROUP the linked account belongs to.
  //
  // Blank is right for the production number, a dedicated line that sits in branch groups and
  // nothing else. It is wrong, and quietly harmful, for any account belonging to a person: the
  // journals return every group that account is in, so a personal phone linked for testing feeds
  // its owner's work team, communities and news groups through a model and into a digest. Setting
  // this restricts the run to the branches and is the only thing that does.
  //
  // Ids, not names: a group's name is editable by its members, so a rename would silently widen or
  // empty the allowlist. Read the ids off a `getChats` response.
  WHATSAPP_DIGEST_GROUPS: z
    .string()
    .trim()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0),
    ),
  // The webhook URL this deployment expects the gateway to be posting to, used only to compare
  // against what the instance actually reports at digest time. Blank disables the comparison, which
  // is right for a local run that is not the configured consumer. It never CONFIGURES anything: the
  // gateway is pointed at us from the Green API console, and this is how the job notices if someone
  // later points it somewhere else.
  WHATSAPP_WEBHOOK_URL: z.string().trim().default(''),
  // Where the run remembers itself (migration 0036). OPTIONAL, and that is deliberate: the job ran
  // statelessly for its whole first life and must still be runnable that way. Absent, a no-op store
  // is wired and nothing is persisted; present, the same database the API uses gains the day's
  // messages, the per-branch summaries and the digest itself. It is the API's connection string,
  // reached over plain SQL — this app shares the database, never the code.
  DATABASE_URL: z.string().url().optional(),
  // How long the raw messages are kept, in days. Summaries and digests are never purged: they are
  // small, and they are the memory that has to outlive the messages behind them.
  // Three days, not thirty. The digest reads a 24-hour window, so everything past the first day is
  // headroom for a failed run, and this table holds the client's real group conversations rather
  // than anything of ours — the value is how long a copy of them lives on our database, which makes
  // a longer default a decision about their data taken by whoever forgot to set this.
  WHATSAPP_MESSAGE_RETENTION_DAYS: z.coerce.number().int().positive().default(3),
  // The Asia/Jerusalem LOCAL hour the scheduled container sends at. Local, and compared as a
  // wall-clock hour rather than by offset arithmetic, so Israel's DST changeovers — one 23-hour day
  // and one 25-hour day a year — each still fire exactly once. Ignored by --once, which runs now.
  DIGEST_FIRE_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  // Where the "already fired today" marker is kept (fired-state.ts). It has to outlive the process:
  // an in-memory marker resets on every restart, and `restart: unless-stopped` plus a crash at 09:00
  // would resend a digest that already went out at 08:00. In the container this points at a mounted
  // volume, so a deploy or a reboot does not resend the day; the default suits a local --once pass,
  // which never reads it.
  DIGEST_STATE_FILE: z.string().min(1).default('.digest-state.json'),
  // --- The summarizing model (ADR-0018, ADR-0022) ---
  // The same boot-time provider switch the API uses, read through this app's own schema rather than
  // imported from it. Exactly one provider is live per process, and the SELECTED provider's key is
  // required and validated at boot by resolveLlmConfig (llm-client.ts) — a missing key fails fast
  // there, for the same reason the credentials above fail fast here. The other two may be blank.
  ASSISTANT_PROVIDER: z.enum(['openrouter', 'gemini', 'groq']).default('openrouter'),
  // Overrides the selected preset's default model: a one-line model swap, no code change.
  ASSISTANT_MODEL: z.string().optional(),
  // Stage 1's model, one call per branch. Left unset it takes the provider preset's group default,
  // which for openrouter is Flash Lite: measured on a real chain-wide day, it is the model that
  // SUCCEEDS on the busiest branch where the Pro model truncates, as well as the cheaper one.
  WHATSAPP_SUMMARY_MODEL: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
})

export type DigestEnv = z.infer<typeof digestEnvSchema>

// The source is a parameter with a default rather than a read of process.env inside, so the whole
// contract above is unit-testable over a plain object with no process env and no I/O. Every bad
// field is reported in ONE aggregated error: an operator setting up a fresh deploy sees the full
// list at once instead of discovering the next missing key on the next restart.
export function loadEnv(source: NodeJS.ProcessEnv = process.env): DigestEnv {
  const parsed = digestEnvSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}
