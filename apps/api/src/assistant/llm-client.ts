// The Assistant's LLM port (ADR-0003, ADR-0013, ADR-0018): the single outbound call the answer
// path makes to a language model, behind one transport-agnostic interface so the answer path, its
// retry, budget, and guardrail wiring are all driven by an injected fake in tests and never by
// real provider traffic. It mirrors how the module injects the Drive client and the clock — one
// port, one real fetch-backed implementation, one scriptable fake below as the test double.
//
// The provider is a boot-time switch, not a runtime fallback (ADR-0018): OpenRouter (default) or
// native Gemini, both reached through the same OpenAI-compatible chat-completions shape lifted from
// the source Clix-CRM `callOpenRouter`. The switch is a preset of {base URL, default model, key
// env, attribution headers} selected once at process start — not a second code path and not a
// vendor SDK. Exactly one provider is live per process; the selected provider's key is validated at
// boot (missing → fail fast, see resolveLlmConfig), so a misconfigured deploy never limps to the
// first answer before failing.

// One call the model asked for (#381): the provider's call id (echoed back on the tool turn that
// answers it), the function name, and the arguments exactly as the model wrote them — a JSON
// string the loop parses, so a malformed one is the loop's failed call, never a throw here.
export interface LlmToolCall {
  id: string
  name: string
  arguments: string
}

// A chat message in the OpenAI-compatible shape both providers accept. The answer path builds a
// system turn followed by the replayed history and the new question; a thread's `agent` turn maps
// to the wire role `assistant`. Two more shapes carry a tool round (#381): an assistant turn that
// asked for tools — replayed with its calls AND the provider's opaque `reasoning_details`, which
// Gemini 3 demands back unmodified on the next request or answers 400 — and the `tool` turn that
// answers one call by id.
export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant'
      content: string
      toolCalls?: LlmToolCall[]
      // Opaque provider state (thought signatures etc.); passed through as received, never read.
      reasoningDetails?: unknown[]
    }
  | { role: 'tool'; toolCallId: string; content: string }

// A tool the model may call (#381). A `function` tool is ours: the loop runs it and feeds the
// result back. A `server` tool is one the broker runs on its own side (OpenRouter's web search,
// `openrouter:web_search`) and is sent verbatim — its results come back as citations on the
// completion, never as a call to us.
export type LlmTool =
  | {
      kind: 'function'
      name: string
      description: string
      // A JSON Schema object for the arguments, as the OpenAI shape wants it.
      parameters: Record<string, unknown>
    }
  | { kind: 'server'; type: string; parameters?: Record<string, unknown> }

// A web page a completion drew on, as the broker annotates it (#381): only the url and title
// reach the reader as a chip; the snippet the annotation also carries is not kept.
export interface LlmCitation {
  url: string
  title: string
}

// One completion request: the assembled messages and the answer's max_tokens budget (ADR-0013).
// `images` (data URLs) ride the FINAL message as OpenAI content parts — the visual-transcription
// path describes embedded screenshots this way; the answer path never sets it and its messages
// stay plain strings on the wire. `tools` (#381) offers the model what it may call this round;
// absent, the wire shape is exactly the tool-less one. `temperature` overrides the answer path's
// fixed low setting for a call that drafts rather than looks up.
export interface LlmCompletionRequest {
  messages: LlmMessage[]
  maxTokens: number
  images?: string[]
  tools?: LlmTool[]
  temperature?: number
  // Shorten this one call's timeout below the config default. The tool loop owns a single
  // wall-clock budget across all its rounds, and without this a final round could open a
  // 25-second call against three seconds of remaining budget and overrun it (LOOP-3).
  timeoutMs?: number
}

// The outcome of a completion, folded to a result rather than a throw: a model failure (timeout,
// non-2xx, malformed or empty body) is an expected, retryable control-flow outcome the answer path
// turns into an inline retry with no persisted row (ADR-0003), not an exception. On success the
// answer text is carried; on failure a short, non-content reason — the error CLASS only, never the
// prompt, the response, or a body that might echo them (ADR-0011).
// What one completion cost, as the provider reported it in the OpenAI-shape `usage` block. Counts
// only, never payload (ADR-0011). Optional on the result so the scriptable fake and bespoke
// responders keep compiling — absent reads as "provider reported nothing".
export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  // How many web searches the broker ran for this completion (#385), from its
  // `usage.server_tool_use` block. Absent when the block is: the native engine has been seen to
  // report nothing, so the answer path falls back to the citations to tell whether one ran.
  webSearches?: number
  // What the broker billed for this completion, in dollars. Every field below is absent rather
  // than zero when the provider reports nothing, because "not reported" and "free" are different
  // facts and a log that conflates them cannot answer what an answer costs.
  costUsd?: number
  // How much of the prompt the provider served from its own cache. The loop re-sends a growing
  // prefix every round, so this is the difference between a four-round answer costing four full
  // prompts and costing one.
  cachedTokens?: number
  // Output tokens spent on reasoning the reader never sees. They bill at the full output rate, so
  // an unwatched thinking budget is a bill nobody can explain.
  reasoningTokens?: number
}

// The broker's web search (#385, ADR-0028), offered beside our function tools on every answer
// when the provider is OpenRouter. Three results per search, and at most two searches per request;
// the loop caps the total across rounds on top of that. Only a model-written query ever reaches
// the engine.
//
// Which engine is a deploy-time choice (2026-09-18). `native` is Google's own search behind the
// routed Gemini model: the model decides for itself whether to search, ignores the result cap, and
// can cite a page it was never given. `exa` is a plain search the broker runs and injects as text,
// so what the model received is exactly the pages that come back as citations, on any provider.
export type WebSearchEngine = 'native' | 'exa'

export const webSearchTool = (engine: WebSearchEngine): LlmTool => ({
  kind: 'server',
  type: 'openrouter:web_search',
  parameters: { engine, max_results: 3, max_uses: 2 },
})

export const WEB_SEARCH_TOOL: LlmTool = webSearchTool('native')

// OpenRouter routes this model to two provider families, and only one of them will accept the
// built-in web search in the same request as our function tools. Google AI Studio refuses the
// pair with "Please enable tool_config.include_server_side_tool_invocations to use Built-in tools
// with Function calling" — a 400, so no retry helps and the answer is simply lost.
//
// Production survived on luck: routing usually lands on Vertex, and falls through to AI Studio
// exactly when Vertex wobbles, so a transient 504 became a permanent 400. The first full routing
// run (2026-09-17) lost 4 of 38 answers this way. Verified against the live API: unpinned 200,
// google-ai-studio 400, google-vertex 200.
//
// Pinned only when a server tool actually rides along. Every other call keeps both providers and
// the redundancy that comes with them, and a Vertex fault on a pinned call is a 5xx, which the
// caller already treats as worth one retry.
const SERVER_TOOL_PROVIDERS = ['google-vertex']

// ...and only for the model family those providers actually serve. Pinning an Anthropic or OpenAI
// model to google-vertex leaves OpenRouter with no provider at all, which would make a non-Google
// model impossible to run - the opposite of what a fallback is for.
// ...and only when the search runs inside Google's own provider. Exa runs on the broker's side and
// reaches the model as plain text, so any provider may serve it and the pin would only throw away
// the redundancy.
const needsServerToolProviderPin = (model: string, tools: LlmTool[] | undefined): boolean =>
  model.startsWith('google/') &&
  (tools?.some((tool) => tool.kind === 'server' && tool.parameters?.engine === 'native') ?? false)

// A success carries the answer text, or — when the model asked for tools instead of answering —
// an empty content with the calls (#381). The optional fields ride only when the provider sent
// them, so a plain completion's result is exactly the shape it always was.
export type LlmCompletionResult =
  | {
      ok: true
      content: string
      toolCalls?: LlmToolCall[]
      reasoningDetails?: unknown[]
      citations?: LlmCitation[]
      model?: string
      usage?: LlmUsage | null
    }
  | {
      ok: false
      error: string
      // Would the same call plausibly succeed on a second try? A 429 or a 5xx is the provider
      // having a bad moment; a 400 comes back identically every time and retrying it spends money
      // to be refused twice. Absent reads as false, so a bespoke fake that predates this stays
      // non-retrying (LOOP-4).
      retryable?: boolean
      // The model hit the token cap mid-sentence. Re-sending it unchanged truncates again; what
      // helps is one more call with the tools withheld, so the budget goes on the answer rather
      // than another lookup.
      truncated?: boolean
    }

export interface LlmClient {
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>
}

// --- Provider presets and boot-time configuration (ADR-0018) ---

export type AssistantProvider = 'openrouter' | 'gemini' | 'groq'

// The per-provider preset: the OpenAI-compatible base URL, the default routed model, the env var
// carrying the key, and whether OpenRouter's optional attribution headers are sent. ASSISTANT_MODEL
// overrides defaultModel when set (ADR-0013). reasoningMaxTokens caps a thinking model's internal
// reasoning via OpenRouter's `reasoning` request field; null sends nothing (the field is
// OpenRouter-shaped, and the direct gemini/groq endpoints may reject it).
interface ProviderPreset {
  baseUrl: string
  defaultModel: string
  apiKeyEnv: 'OPENROUTER_API_KEY' | 'GEMINI_API_KEY' | 'GROQ_API_KEY'
  sendsAttribution: boolean
  reasoningMaxTokens: number | null
  // Whether the endpoint runs a web search on its own side (#385): only the broker does; the
  // direct Gemini and Groq endpoints would reject the server tool, so nothing is offered there.
  webSearch: boolean
}

export const PROVIDER_PRESETS: Record<AssistantProvider, ProviderPreset> = {
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    // The owner's standing choice (2026-08). Gemini's PRO line stops at 3.1: the higher-numbered
    // 3.5/3.6/3.7 releases are all Flash tier, so a bigger version number here is a downgrade, and
    // the 2.5-flash this used to default to was two generations of stale. Prod may still pin
    // ASSISTANT_MODEL, which wins over this.
    defaultModel: 'google/gemini-3.1-pro-preview',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    sendsAttribution: true,
    // Thinking models (gemini-3.x-flash) count reasoning tokens against max_tokens, and on a
    // data-dense grounding block they think the entire answer budget away before emitting a word —
    // every completion then finishes 'length' and folds to a permanent 503, not a retryable blip
    // (observed in prod: any question ranking the dashboard docs into grounding failed 100% of the
    // time). Capping reasoning leaves the budget to the answer; the model treats it as a hint and
    // may overrun somewhat, so the cap is a floor-setter, not an exact spend.
    reasoningMaxTokens: 256,
    webSearch: true,
  },
  gemini: {
    // Google's Gemini API reached through its OpenAI-compatible endpoint (ADR-0018), so the one
    // `fetch` shape serves both providers with no vendor SDK. The default is the floating
    // `gemini-flash-latest` alias rather than a pinned generation: Google retires dated Gemini
    // ids for new API keys (the pinned `gemini-2.5-flash` began 404-ing — "no longer available to
    // new users" — and took every answer down with it), and the alias always resolves to a live
    // flash model. Pin a specific generation via ASSISTANT_MODEL when a deploy needs one.
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-flash-latest',
    apiKeyEnv: 'GEMINI_API_KEY',
    sendsAttribution: false,
    reasoningMaxTokens: null,
    webSearch: false,
  },
  groq: {
    // Groq's OpenAI-compatible endpoint (ADR-0022), the same one `fetch` shape as the other two
    // presets — no vendor SDK. Added for its free-tier request headroom: where Gemini's free tier
    // caps at ~10-15 RPM / 250-1,000 RPD (and folds a floor-shift assistant into constant 429s),
    // Groq's free tier gives 30 RPM and far higher daily ceilings. The default is
    // `llama-3.3-70b-versatile` — the best free grounded-instruction-follower on Groq (30 RPM /
    // 1,000 RPD / 12K TPM). For raw daily volume over nuance, pin `llama-3.1-8b-instant`
    // (30 RPM / 14,400 RPD) via ASSISTANT_MODEL. Groq sends no attribution headers.
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    apiKeyEnv: 'GROQ_API_KEY',
    sendsAttribution: false,
    reasoningMaxTokens: null,
    webSearch: false,
  },
}

// OpenRouter's optional attribution headers (ADR-0013): a referer and a product title for the
// broker's usage rankings. Only the openrouter preset sends them; gemini sends none (ADR-0018).
export interface LlmAttribution {
  referer: string
  title: string
}

// The resolved, ready-to-call configuration: the concrete endpoint, routed model, key, optional
// attribution, and the request timeout. Built once at boot from the env by resolveLlmConfig.
export interface LlmConfig {
  baseUrl: string
  model: string
  apiKey: string
  attribution: LlmAttribution | null
  timeoutMs: number
  reasoningMaxTokens: number | null
  // Where the routed model's trained knowledge ends, in words, or null when it is not known
  // (#387). The prompt states it so the model can tell that a rate or a price is outside what it
  // knows and must be looked up, rather than reciting the figure it was trained on.
  knowledgeCutoff: string | null
  // The broker's web search to offer beside the function tools, or null where the endpoint has
  // none (#385) — then the prompt says the web could not be checked rather than pretending.
  webSearchTool: LlmTool | null
}

// The env fields resolveLlmConfig reads — the already-parsed values env.ts owns the schema for.
// Kept structural (not the whole Env type) so the resolver is unit-testable with a plain object.
export interface LlmConfigEnv {
  ASSISTANT_PROVIDER: AssistantProvider
  ASSISTANT_MODEL?: string
  ASSISTANT_REASONING_MAX_TOKENS?: number
  ASSISTANT_WEB_SEARCH_ENGINE?: WebSearchEngine
  OPENROUTER_API_KEY?: string
  GEMINI_API_KEY?: string
  GROQ_API_KEY?: string
  APP_BASE_URL: string
}

// The trained-knowledge cutoff of the models this app routes to, by id prefix. Google publishes
// January 2025 for the Gemini 3 family. A model that is not listed resolves to null, and the
// prompt then says only that a cutoff exists, which is still truer than silence.
const MODEL_KNOWLEDGE_CUTOFFS: { prefix: string; cutoff: string }[] = [
  { prefix: 'google/gemini-3', cutoff: 'January 2025' },
  { prefix: 'gemini-3', cutoff: 'January 2025' },
]

// The product title sent as OpenRouter's X-Title attribution header.
const ATTRIBUTION_TITLE = 'Burgers Bar'

// The answer-path request timeout (~25s, ADR-0013): a slow provider becomes an inline retry rather
// than an indefinite hang on a floor shift.
export const LLM_TIMEOUT_MS = 25_000

// A low, fixed sampling temperature for the answer path. A floor-shift answer is a lookup, not a
// creative task: pinning temperature low keeps the SAME question from producing wildly
// different-length completions run-to-run — the run-to-run length variance that made truncation
// against the max_tokens cap intermittent (some runs cleared the cap, some were cut mid-sentence).
export const ANSWER_TEMPERATURE = 0.2

// Resolve the live provider configuration at boot (ADR-0018). Picks the preset for the selected
// provider, applies the ASSISTANT_MODEL override, and reads the selected provider's key — throwing
// when it is missing so a misconfigured deploy fails fast rather than at the first answer. The
// other provider's key may be unset. Attribution is sent only for the openrouter preset.
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
    attribution: preset.sendsAttribution
      ? { referer: env.APP_BASE_URL, title: ATTRIBUTION_TITLE }
      : null,
    timeoutMs,
    // An env override applies only where the preset already sends the field: the direct gemini and
    // groq endpoints reject OpenRouter's `reasoning` shape, so null stays null.
    reasoningMaxTokens:
      preset.reasoningMaxTokens === null
        ? null
        : (env.ASSISTANT_REASONING_MAX_TOKENS ?? preset.reasoningMaxTokens),
    webSearchTool: preset.webSearch
      ? webSearchTool(env.ASSISTANT_WEB_SEARCH_ENGINE ?? 'native')
      : null,
    knowledgeCutoff:
      MODEL_KNOWLEDGE_CUTOFFS.find((entry) => model.startsWith(entry.prefix))?.cutoff ?? null,
  }
}

// --- The real fetch-backed client (no vendor SDK) ---

// One message in the OpenAI wire shape. An assistant turn that called tools carries `tool_calls`
// and, when the provider gave any, `reasoning_details` verbatim (#381); a tool turn carries the
// id of the call it answers. System and user turns are the plain pair they always were.
const toWireMessage = (message: LlmMessage): Record<string, unknown> => {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.role === 'assistant') {
    return {
      role: 'assistant',
      content: message.content,
      ...(message.toolCalls && message.toolCalls.length > 0
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
      ...(message.reasoningDetails ? { reasoning_details: message.reasoningDetails } : {}),
    }
  }
  return { role: message.role, content: message.content }
}

// A tool in the OpenAI wire shape: ours as a `function` entry, a broker-run one verbatim (#381).
const toWireTool = (tool: LlmTool): Record<string, unknown> =>
  tool.kind === 'function'
    ? {
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      }
    : { type: tool.type, ...(tool.parameters ? { parameters: tool.parameters } : {}) }

// The completion body as the OpenAI shape reports it — only the fields read here.
interface WireCompletion {
  choices?: Array<{
    finish_reason?: string
    message?: {
      content?: string | null
      tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
      reasoning_details?: unknown[]
      annotations?: Array<{ type?: string; url_citation?: { url?: string; title?: string } }>
    }
  }>
  model?: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    cost?: number
    prompt_tokens_details?: { cached_tokens?: number }
    completion_tokens_details?: { reasoning_tokens?: number }
    server_tool_use?: { web_search_requests?: number }
  }
}

// Build the fetch-backed LlmClient for a resolved config. One plain POST to the provider's
// OpenAI-compatible /chat/completions — the shape both presets share (ADR-0018). Any failure — a
// missing 2xx, a malformed or empty body, an abort past the timeout, a network error — folds to
// { ok: false } so the answer path can retry inline (ADR-0003). Nothing here logs the request or
// the response: prompt, answer, and grounding are never logged (ADR-0011).
export function createHttpLlmClient(config: LlmConfig): LlmClient {
  const endpoint = `${config.baseUrl}/chat/completions`
  return {
    complete: async ({ messages, maxTokens, images, tools, temperature, timeoutMs }) => {
      // Attached images become OpenAI content parts on the final message; without them the wire
      // shape is exactly the plain-string one it has always been.
      const wireMessages =
        images === undefined || images.length === 0
          ? messages.map(toWireMessage)
          : messages.map((message, index) =>
              index === messages.length - 1
                ? {
                    role: message.role,
                    content: [
                      { type: 'text', text: message.content },
                      ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
                    ],
                  }
                : toWireMessage(message),
            )
      // Abort past the timeout so a slow provider becomes a retry, not an open socket.
      const controller = new AbortController()
      const timeout = setTimeout(
        () => controller.abort(),
        Math.max(1, Math.min(config.timeoutMs, timeoutMs ?? config.timeoutMs)),
      )
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        }
        if (config.attribution) {
          headers['HTTP-Referer'] = config.attribution.referer
          headers['X-Title'] = config.attribution.title
        }
        const res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: config.model,
            max_tokens: maxTokens,
            temperature: temperature ?? ANSWER_TEMPERATURE,
            ...(config.reasoningMaxTokens === null
              ? {}
              : { reasoning: { max_tokens: config.reasoningMaxTokens } }),
            // The tools ride only when offered, and the model chooses freely among them — a forced
            // call would take the "does this need a lookup at all?" decision away from it.
            ...(tools && tools.length > 0
              ? { tools: tools.map(toWireTool), tool_choice: 'auto' }
              : {}),
            ...(needsServerToolProviderPin(config.model, tools)
              ? { provider: { only: SERVER_TOOL_PROVIDERS } }
              : {}),
            messages: wireMessages,
          }),
          signal: controller.signal,
        })
        if (!res.ok) {
          // Carry only the status class — never the response body, which can echo prompt content.
          // A rate limit or a provider-side fault is worth one more try; anything else is a
          // refusal that will be repeated verbatim.
          return {
            ok: false,
            error: `provider responded ${res.status}`,
            retryable: res.status === 429 || res.status >= 500,
          }
        }
        const data = (await res.json()) as WireCompletion
        const choice = data.choices?.[0]
        const message = choice?.message
        const content = message?.content?.trim() ?? ''
        // A call with no id or name cannot be answered or run; it is dropped rather than crashed on.
        const toolCalls: LlmToolCall[] = (message?.tool_calls ?? []).flatMap((call) =>
          call.id && call.function?.name
            ? [{ id: call.id, name: call.function.name, arguments: call.function.arguments ?? '' }]
            : [],
        )
        // A tool-calling turn legitimately has no text (#381); a turn with neither is the empty
        // completion it always was — a retryable failure.
        if (content.length === 0 && toolCalls.length === 0) {
          return { ok: false, error: 'provider returned an empty completion', retryable: true }
        }
        // A "length" finish_reason means the model hit the max_tokens cap and the content is cut
        // mid-sentence (ADR-0013). That is not a good answer — folding it to a retryable failure
        // keeps a truncated turn from being persisted and shown as if it were complete, and lets the
        // answer path retry inline (ADR-0003) rather than storing half a procedure. Carry only the
        // reason class, never the truncated body (ADR-0011).
        if (choice?.finish_reason === 'length') {
          return {
            ok: false,
            error: 'provider truncated the completion at the token cap',
            retryable: false,
            truncated: true,
          }
        }
        const webSearches = data.usage?.server_tool_use?.web_search_requests
        const costUsd = data.usage?.cost
        const cachedTokens = data.usage?.prompt_tokens_details?.cached_tokens
        const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens
        const usage: LlmUsage | null =
          typeof data.usage?.prompt_tokens === 'number' &&
          typeof data.usage?.completion_tokens === 'number'
            ? {
                inputTokens: data.usage.prompt_tokens,
                outputTokens: data.usage.completion_tokens,
                ...(typeof webSearches === 'number' ? { webSearches } : {}),
                ...(typeof costUsd === 'number' ? { costUsd } : {}),
                ...(typeof cachedTokens === 'number' ? { cachedTokens } : {}),
                ...(typeof reasoningTokens === 'number' ? { reasoningTokens } : {}),
              }
            : null
        const citations: LlmCitation[] = (message?.annotations ?? []).flatMap((annotation) =>
          annotation.type === 'url_citation' && annotation.url_citation?.url
            ? [
                {
                  url: annotation.url_citation.url,
                  title: annotation.url_citation.title ?? annotation.url_citation.url,
                },
              ]
            : [],
        )
        return {
          ok: true,
          content,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
          ...(message?.reasoning_details ? { reasoningDetails: message.reasoning_details } : {}),
          ...(citations.length > 0 ? { citations } : {}),
          // What the provider actually served, which a fallback list or a provider-side alias
          // can make differ from the id we asked for.
          model: data.model ?? config.model,
          usage,
        }
      } catch (error) {
        // Timeout (abort) and network errors land here; report the class, not the payload.
        const reason = error instanceof Error ? error.name : 'unknown error'
        return { ok: false, error: `provider request failed: ${reason}`, retryable: true }
      } finally {
        clearTimeout(timeout)
      }
    },
  }
}

// --- The scriptable fake, the test double the answer-path plan names ---

// A scriptable in-memory LlmClient (living in src beside the port, as the Drive and clock fakes do)
// so the answer path and its tests share one definition. By default it returns a canned answer; a
// test scripts a responder to reflect the assembled grounding — the way the "answers from a
// procedure" and "no procedure for that outside the grounding" cases are proved without real
// traffic and without asserting the prompt string — or forces the next call to fail to drive the
// retry path. It captures each request so a test can assert the budget (max_tokens) and the
// replayed-turn count as external, structural facts, never the guardrail wording.
export interface FakeLlmClient extends LlmClient {
  // The answer returned when no responder is set and no failure is queued.
  setDefaultAnswer(content: string): void
  // Compute the answer from the request — used to reflect grounding (an obedient-model simulation).
  respondWith(responder: (request: LlmCompletionRequest) => LlmCompletionResult): void
  // Force the next complete() to fail (timeout/non-2xx/malformed all fold to this), one-shot: the
  // following call behaves normally, so a test can prove the retry succeeds after a hiccup.
  failNext(error?: string): void
  // Every request complete() was called with, in order — for the budget/history assertions.
  readonly requests: LlmCompletionRequest[]
  reset(): void
}

const DEFAULT_FAKE_ANSWER = 'This is a fake assistant answer.'

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
      requests.push({
        messages: [...request.messages],
        maxTokens: request.maxTokens,
        ...(request.images === undefined ? {} : { images: [...request.images] }),
        ...(request.tools === undefined ? {} : { tools: [...request.tools] }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      })
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
