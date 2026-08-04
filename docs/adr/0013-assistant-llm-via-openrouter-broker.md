# The Assistant calls its LLM through the OpenRouter broker, not a first-party SDK

> **Amended by [ADR-0018](./0018-assistant-provider-switch.md) (2026-08):** a boot-time
> `ASSISTANT_PROVIDER` switch adds native Gemini, via its OpenAI-compatible endpoint, as an
> alternative to the OpenRouter default. Still one provider per process, still no vendor SDK.

ADR-0003 fixed the Assistant's answer path as a single direct, synchronous in-app LLM call.
It did not fix which provider that call reaches or how. The engineering design, written
before the provider was studied, had assumed the first-party Anthropic Claude SDK
(`@anthropic-ai/sdk`) with `ANTHROPIC_API_KEY`. The assistant-slices grilling (#57), reading
the LLM research (#55), reverses that assumption: the call goes through OpenRouter, an
aggregator exposing an OpenAI-compatible chat-completions endpoint, reached by a plain `fetch`
POST with no vendor SDK — the same `callOpenRouter` shape the source Clix-CRM assistant already
uses. The default model is `google/gemini-2.5-flash`, held in an `ASSISTANT_MODEL` config value
so the routed model is a one-line string change. The single credential is `OPENROUTER_API_KEY`
(plus OpenRouter's optional `HTTP-Referer` / `X-Title` attribution headers); `ANTHROPIC_API_KEY`
is dropped from the secret surface.

We chose this because the broker's one value in the request path — a single key routing to
Claude, GPT, and Gemini models by string — makes the model a swappable configuration rather than
a code dependency, which is what matters when the deciding axis is answer quality on real
bilingual prompts and not the SDK. At this scale (order of hundreds of short grounded Q&A calls a
day) per-answer cost and latency are a fraction of a cent and a second or two on every candidate,
so provider lock-in buys nothing that offsets losing the free model swap. The source CRM already
runs Hebrew and English through `gemini-2.5-flash` at this exact grounded-Q&A shape, so the
default is proven rather than guessed, and lifting the CRM's `fetch` shape is less code than
adopting a first-party SDK. Accuracy comes from grounding (ADR-0004) and the anti-fabrication
system prompt, not from the model tier, so a small fast model behind the broker is sufficient.

The answer budget rides along with this shape: `max_tokens` ~1800, a low fixed `temperature` (~0.2),
~10 prior turns replayed to the model, a ~25s request timeout, and a failure surfaced as a transient
inline retry — never a persisted Message row, honouring ADR-0003. The budget was originally ~800,
but a real multi-step procedure runs longer than that, so answers were cut mid-sentence at the
ceiling; the model returns that cut with `finish_reason: "length"`, which the client now folds to the
same retryable failure rather than persisting half an answer as if it were complete. The low
temperature keeps the same question from varying enough in length to clear the cap on one run and be
truncated on the next — the intermittency that made the truncation read as flaky "inconsistent"
answers. Real token streaming stays out of v1 (ADR-0003); the UI's cosmetic word-by-word reveal is a
client effect over the whole returned answer.

## Consequences

- A third-party aggregator now sits in the Assistant's request path — an extra hop and an extra
  vendor's routing and uptime between the API and the model. This is accepted for the model-swap
  freedom; if the broker's reliability ever bites, the same `messages`-shaped call can move to a
  first-party SDK without touching the grounding or the guardrail.
- The secret surface changes: `OPENROUTER_API_KEY` replaces `ANTHROPIC_API_KEY` in Render env and
  `.env.example`. The engineering design's assistant and secrets sections are updated to match.
- Swapping the routed model (to `anthropic/claude-haiku-4.5`, a quality tier, or another vendor)
  is a one-line `ASSISTANT_MODEL` change, so a bilingual spot-check can settle the model at build
  time without a code change.
- Sending scoped task snippets and procedure-doc text to a third-party LLM endpoint is a
  data-handling decision that rides on ADR-0003's retrieval-scoping boundary; the implementing
  code carries rule-5 review. Assistant prompt, response, and knowledge-doc content are never
  logged (ADR-0011).
