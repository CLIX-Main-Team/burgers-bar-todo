// The digest's LLM port (ADR-0026): the single outbound call the daily job makes to a language
// model, behind one transport-agnostic interface so the whole pipeline — collect, summarize, send —
// runs against an injected fake in tests and never against real provider traffic. It mirrors how
// the job injects the Green API client and the clock: one port, one real fetch-backed
// implementation, one scriptable fake below as the test double.
//
// This file is a COPY of apps/api/src/assistant/llm-client.ts, deliberately not an import. The
// digest deploys as its own container whose image installs only this workspace, so importing the
// API's source would drag the server's env schema and its credentials into an image that needs none
// of them, and would couple a standalone job to a product it shares nothing with but the repo. The
// duplication is the price of that independence, and it is the price already paid for the clock and
// load-env.
//
// The provider is a boot-time switch, not a runtime fallback (ADR-0018): OpenRouter (default),
// native Gemini, or Groq, all reached through the same OpenAI-compatible chat-completions shape.
// The switch is a preset of {base URL, default model, key env} chosen once at process start — not a
// second code path and not a vendor SDK. Exactly one provider is live per process, and the selected
// provider's key is validated at boot (missing → fail fast, see resolveLlmConfig), so a
// misconfigured container dies on its first line rather than at the hour the digest was due.
//
// Trimmed relative to the API's copy: OpenRouter's optional attribution headers are not sent. Their
// only input was APP_BASE_URL, a public URL this job has no other use for, and dropping them keeps
// one more variable out of a schema whose whole point is being narrow.

// A chat message in the OpenAI-compatible shape all three providers accept. The digest assembles a
// system turn (the summarising brief and the rule that the transcript is data, not instructions)
// followed by one user turn carrying the day's transcript; there is no history to replay.
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// One completion request: the assembled messages and the summary's max_tokens budget.
export interface LlmCompletionRequest {
  messages: LlmMessage[]
  maxTokens: number
}

// The outcome of a completion, folded to a result rather than a throw: a model failure (timeout,
// non-2xx, malformed, empty, or truncated body) is an expected control-flow outcome the job retries
// once inline and then reports as a failed run, not an exception. On success the Hebrew summary is
// carried; on failure a short, non-content reason — the error CLASS only, never the prompt, the
// completion, or a response body that might echo either. The prompt here is a whole day of real
// staff and customer chat, so that rule bites harder in this app than anywhere else in the repo.
export type LlmCompletionResult = { ok: true; content: string } | { ok: false; error: string }

export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>
}

// --- Provider presets and boot-time configuration (ADR-0018) ---

export type LlmProvider = 'openrouter' | 'gemini' | 'groq'

// The per-provider preset: the OpenAI-compatible base URL, the default routed model, and the env
// var carrying the key. ASSISTANT_MODEL overrides defaultModel when set. reasoningMaxTokens caps a
// thinking model's internal reasoning via OpenRouter's `reasoning` request field; null sends
// nothing, because the field is OpenRouter-shaped and the direct gemini/groq endpoints may reject
// it.
export interface LlmProviderPreset {
  baseUrl: string
  defaultModel: string
  // The model stage 1 uses, one call per branch. Separate from defaultModel because the two stages
  // are not the same job: stage 1 restates one group's messages, stage 2 decides what the day meant
  // across sixty of them. The judgement is worth paying for; the restating is not.
  defaultGroupModel: string
  apiKeyEnv: 'OPENROUTER_API_KEY' | 'GEMINI_API_KEY' | 'GROQ_API_KEY'
  reasoningMaxTokens: number | null
}

export const PROVIDER_PRESETS: Record<LlmProvider, LlmProviderPreset> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    // The owner's standing choice (2026-08). Gemini's PRO line stops at 3.1: the higher-numbered
    // 3.5/3.6/3.7 releases are all Flash tier, so a bigger version number here is a downgrade. Prod
    // may still pin ASSISTANT_MODEL, which wins over this.
    defaultModel: 'google/gemini-3.1-pro-preview',
    // Stage 1 on Flash Lite, measured against the Pro model on a real chain-wide day rather than
    // chosen on price. On the busiest group (183 messages) Pro FAILED at an 8,000-token budget after
    // 50 seconds, thinking the answer away, while Flash Lite finished in 12 seconds and produced the
    // best branch summary of the four models tried: stock-outs grouped by branch, every late order
    // with the compensation given. On small and mid branches the outputs are equivalent.
    //
    // So this is not a quality-for-cost trade. The cheap model is the one that WORKS on the branch
    // that matters most, because it does not spend the budget on reasoning. That it is also 8x
    // cheaper ($0.25/$1.50 per 1M against $2/$12) is the second reason, not the first.
    defaultGroupModel: 'google/gemini-3.1-flash-lite',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    // Thinking models count reasoning tokens against max_tokens, and on a data-dense prompt they
    // think the entire answer budget away before emitting a word — every completion then finishes
    // 'length' and folds to a failure (observed in prod on the API's answer path). A whole day of
    // group chat is exactly that kind of prompt, so the cap matters more here, not less. The model
    // treats it as a hint and may overrun somewhat: it is a floor-setter, not an exact spend.
    reasoningMaxTokens: 256,
  },
  gemini: {
    // Google's Gemini API through its OpenAI-compatible endpoint, so one `fetch` shape serves every
    // provider with no vendor SDK. The default is the floating `gemini-flash-latest` alias rather
    // than a pinned generation: Google retires dated Gemini ids for new API keys (the pinned
    // `gemini-2.5-flash` began 404-ing — "no longer available to new users"), and the alias always
    // resolves to a live flash model. Pin a generation via ASSISTANT_MODEL when a deploy needs one.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-flash-latest',
    // Already a flash model, so both stages share it: there is nothing cheaper to drop stage 1 onto.
    defaultGroupModel: 'gemini-flash-latest',
    apiKeyEnv: 'GEMINI_API_KEY',
    reasoningMaxTokens: null,
  },
  groq: {
    // Groq's OpenAI-compatible endpoint (ADR-0022), the same one `fetch` shape as the other two
    // presets. Kept for its free-tier headroom, though a job that spends exactly one completion a
    // day is the last thing in this repo that would ever meet a rate limit. The default is
    // `llama-3.3-70b-versatile`, the best free grounded-instruction-follower on Groq; for raw
    // volume over nuance, pin `llama-3.1-8b-instant` via ASSISTANT_MODEL.
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    // The smaller sibling for the per-branch pass, on the same reasoning as the openrouter preset:
    // restating one group's messages does not need the 70b.
    defaultGroupModel: 'llama-3.1-8b-instant',
    apiKeyEnv: 'GROQ_API_KEY',
    reasoningMaxTokens: null,
  },
}

// The resolved, ready-to-call configuration: the concrete endpoint, routed model, key, request
// timeout, and reasoning cap. Built once at boot from the env by resolveLlmConfig.
export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string
  timeoutMs: number
  reasoningMaxTokens: number | null
}

// The env fields resolveLlmConfig reads — the already-parsed values env.ts owns the schema for.
// Kept structural (not the whole DigestEnv type) so the resolver is unit-testable with a plain
// object.
export interface LlmConfigEnv {
  ASSISTANT_PROVIDER: LlmProvider
  ASSISTANT_MODEL?: string
  // Stage 1's model. See resolveGroupLlmConfig for why it does not inherit from ASSISTANT_MODEL.
  WHATSAPP_SUMMARY_MODEL?: string
  OPENROUTER_API_KEY?: string
  GEMINI_API_KEY?: string
  GROQ_API_KEY?: string
}

// The request timeout, 60s rather than the API answer path's 25s. A day of group chat is a long
// prompt and this is a once-a-day batch job with nobody waiting on it: a slow provider should cost
// the run a minute, not cost it the digest. It stays bounded all the same, because an open socket
// in a container that otherwise sleeps all day would never be noticed.
export const LLM_TIMEOUT_MS = 60_000

// A low, fixed sampling temperature. A digest is a report, not a creative task: pinning temperature
// low keeps the same day's transcript from producing a wildly different-length summary run to run,
// which is what made truncation against the max_tokens cap intermittent on the API's answer path.
export const SUMMARY_TEMPERATURE = 0.2

// Resolve the live provider configuration at boot (ADR-0018). Picks the preset for the selected
// provider, applies the ASSISTANT_MODEL override, and reads the selected provider's key — throwing
// when it is missing so a misconfigured deploy fails fast rather than at the first digest. The
// other providers' keys may be unset. The message names the ENV VAR, never the value.
export function resolveLlmConfig(env: LlmConfigEnv, timeoutMs: number = LLM_TIMEOUT_MS): LlmConfig {
  const preset = PROVIDER_PRESETS[env.ASSISTANT_PROVIDER]
  const apiKey = env[preset.apiKeyEnv]
  if (!apiKey) {
    throw new Error(
      `Assistant provider "${env.ASSISTANT_PROVIDER}" requires ${preset.apiKeyEnv} to be set`,
    )
  }
  const model = env.ASSISTANT_MODEL?.trim() || preset.defaultModel
  return {
    baseUrl: preset.baseUrl,
    model,
    apiKey,
    timeoutMs,
    reasoningMaxTokens: preset.reasoningMaxTokens,
  }
}

// The same config with stage 1's model swapped in. Everything else is shared, because the provider,
// the key and the timeout are properties of the deployment rather than of the stage.
//
// WHATSAPP_SUMMARY_MODEL overrides it, and deliberately does NOT fall back to ASSISTANT_MODEL: a
// deployment that pins the merge to a particular model should not silently drag the sixty per-branch
// calls onto it too, which is exactly the configuration that failed on the busiest group.
export function resolveGroupLlmConfig(
  env: LlmConfigEnv,
  timeoutMs: number = LLM_TIMEOUT_MS,
): LlmConfig {
  const preset = PROVIDER_PRESETS[env.ASSISTANT_PROVIDER]
  return {
    ...resolveLlmConfig(env, timeoutMs),
    model: env.WHATSAPP_SUMMARY_MODEL?.trim() || preset.defaultGroupModel,
  }
}

// --- The real fetch-backed client (no vendor SDK) ---

// Build the fetch-backed LlmClient for a resolved config. One plain POST to the provider's
// OpenAI-compatible /chat/completions — the shape all three presets share (ADR-0018). Any failure —
// a missing 2xx, a malformed or empty body, an abort past the timeout, a network error — folds to
// { ok: false } so the job can retry inline and then report a failed run. Nothing here logs the
// request or the response: the prompt is a day of private group chat and the completion is the
// digest itself.
// How many times a transient refusal is retried before the branch is given up on. Three attempts
// total: the provider gets two more chances, and a group that still fails after ~30s of waiting is
// genuinely unavailable rather than momentarily busy.
const MAX_ATTEMPTS = 3

// The backoff floor, doubled per attempt (2s, then 4s). Deliberately longer than a typical retry
// loop: this is a scheduled batch with nothing waiting on it, so waiting is nearly free, while
// hammering a provider that just said "too many" is what turns one 429 into a whole failed run.
const RETRY_BASE_MS = 2_000

// A provider asking us to wait longer than this is really saying "not today" — past it the run
// should fail and report rather than sit for minutes holding the job open.
const RETRY_AFTER_CAP_MS = 30_000

// Only these come back. 429 is the rate limit that actually bit us on a real chain, and 5xx is the
// provider having a moment. A 400 or 401 is our bug or our key and would fail identically forever,
// so retrying it just spends three times as long arriving at the same error.
const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500

// Honour Retry-After when the provider sends one, because it knows when it will be ready and we do
// not. Seconds form only: the HTTP-date form would need a wall-clock read, and falling back to our
// own backoff is both simpler and safe.
const retryDelayMs = (res: Response, attempt: number): number => {
  const header = res.headers.get('retry-after')
  const seconds = header === null ? Number.NaN : Number.parseInt(header, 10)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, RETRY_AFTER_CAP_MS)
  }
  // Exponential, with jitter so that a pool of workers refused at the same instant does not come
  // back in lockstep and refuse each other all over again.
  const backoff = RETRY_BASE_MS * 2 ** attempt
  return Math.min(backoff + Math.random() * RETRY_BASE_MS, RETRY_AFTER_CAP_MS)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function createHttpLlmClient(config: LlmConfig): LlmClient {
  const endpoint = `${config.baseUrl}/chat/completions`
  // One HTTP attempt. Returns the retry delay alongside the failure so the caller decides whether to
  // spend it — keeping "was this transient" next to the response that knows, and "how many chances
  // are left" in the loop that counts them.
  const attempt = async (
    { messages, maxTokens }: LlmCompletionRequest,
    attemptIndex: number,
  ): Promise<{ result: LlmCompletionResult; retryInMs: number | null }> => {
    // Abort past the timeout so a slow provider becomes a retry, not an open socket.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: config.model,
          max_tokens: maxTokens,
          temperature: SUMMARY_TEMPERATURE,
          ...(config.reasoningMaxTokens === null
            ? {}
            : { reasoning: { max_tokens: config.reasoningMaxTokens } }),
          messages,
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        // Carry only the status class — never the response body, which can echo the transcript.
        return {
          result: { ok: false, error: `provider responded ${res.status}` },
          retryInMs: isRetryableStatus(res.status) ? retryDelayMs(res, attemptIndex) : null,
        }
      }
      const data = (await res.json()) as {
        choices?: Array<{ finish_reason?: string; message?: { content?: string } }>
      }
      const choice = data.choices?.[0]
      const content = choice?.message?.content?.trim() ?? ''
      if (content.length === 0) {
        return {
          result: { ok: false, error: 'provider returned an empty completion' },
          retryInMs: null,
        }
      }
      // A "length" finish_reason means the model hit the max_tokens cap and the summary is cut
      // mid-sentence. Folding it to a failure is what stops half a Hebrew digest reaching a
      // person's phone as if it were the whole day — a truncated report reads as a complete one,
      // which is worse than no report at all. Carry only the reason class, never the cut body.
      if (choice?.finish_reason === 'length') {
        return {
          result: { ok: false, error: 'provider truncated the completion at the token cap' },
          retryInMs: null,
        }
      }
      return { result: { ok: true, content }, retryInMs: null }
    } catch (error) {
      // Timeout (abort) and network errors land here; report the class, not the payload.
      const reason = error instanceof Error ? error.name : 'unknown error'
      // A timeout or a dropped socket is transient in the same way a 429 is, and unlike a 4xx it
      // says nothing about the request being wrong. No Response to read, so our own backoff.
      return {
        result: { ok: false, error: `provider request failed: ${reason}` },
        retryInMs: Math.min(RETRY_BASE_MS * 2 ** attemptIndex, RETRY_AFTER_CAP_MS),
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  return {
    complete: async (request) => {
      let last: LlmCompletionResult = { ok: false, error: 'provider was never reached' }
      for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
        const { result, retryInMs } = await attempt(request, index)
        if (result.ok) {
          return result
        }
        last = result
        // Out of chances, or a failure that would repeat identically: stop and report it.
        if (retryInMs === null || index === MAX_ATTEMPTS - 1) {
          return last
        }
        await sleep(retryInMs)
      }
      return last
    },
  }
}

// --- The scriptable fake, the test double the digest's tests name ---

// A scriptable in-memory LlmClient, living in src beside the port as the Green API and clock fakes
// do, so the job and its tests share one definition. By default it returns a canned answer; a test
// scripts a responder to reflect the transcript it was handed — the way "the day's messages reached
// the prompt" and "the cap notice was carried" are proved without real traffic and without
// asserting the brief's wording — or forces the next call to fail to drive the retry path. It
// captures each request, which is how the blank-recipient case proves the summary was still written
// (one recorded request) while the Green API fake proves nothing was sent (an empty sent array).
export interface FakeLlmClient extends LlmClient {
  // The answer returned when no responder is set and no failure is queued.
  setDefaultAnswer(content: string): void
  // Compute the answer from the request — used to reflect the transcript (an obedient-model
  // simulation).
  respondWith(responder: (request: LlmCompletionRequest) => LlmCompletionResult): void
  // Force the next complete() to fail (timeout/non-2xx/malformed/truncated all fold to this),
  // one-shot: the following call behaves normally, so a test can prove the retry succeeds after a
  // hiccup.
  failNext(error?: string): void
  // Every request complete() was called with, in order — for the budget and prompt-shape checks.
  readonly requests: LlmCompletionRequest[]
  reset(): void
}

const DEFAULT_FAKE_ANSWER = 'This is a fake digest summary.'

export function createFakeLlmClient(): FakeLlmClient {
  let defaultAnswer = DEFAULT_FAKE_ANSWER
  let responder: ((request: LlmCompletionRequest) => LlmCompletionResult) | null = null
  let nextError: string | null = null
  const requests: LlmCompletionRequest[] = []

  return {
    setDefaultAnswer: (content) => {
      defaultAnswer = content
    },
    respondWith: (fn) => {
      responder = fn
    },
    failNext: (error = 'fake llm: forced failure') => {
      nextError = error
    },
    get requests() {
      return requests
    },
    reset: () => {
      defaultAnswer = DEFAULT_FAKE_ANSWER
      responder = null
      nextError = null
      requests.length = 0
    },
    complete: async (request) => {
      // Capture a copy so a later mutation of the caller's array cannot rewrite recorded history.
      requests.push({ messages: [...request.messages], maxTokens: request.maxTokens })
      if (nextError) {
        const error = nextError
        nextError = null
        return { ok: false, error }
      }
      if (responder) {
        return responder(request)
      }
      return { ok: true, content: defaultAnswer }
    },
  }
}
