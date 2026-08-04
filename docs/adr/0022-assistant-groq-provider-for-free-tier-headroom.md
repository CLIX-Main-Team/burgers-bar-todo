---
status: accepted — amends ADR-0018
---

# The Assistant gains a third provider preset — Groq — and staging moves Gemini → Groq for free-tier request headroom

ADR-0018 made the Assistant's LLM provider a boot-time switch — a preset of `{base URL, default
model, API-key env, attribution headers}` selected by `ASSISTANT_PROVIDER` — with `openrouter`
(default) and `gemini` as the two choices, and moved the Render staging deploy (ADR-0017) onto
`gemini` because its free tier answers at zero cost where OpenRouter needs paid credits. This ADR
adds a third preset, `groq`, and moves the staging default from `gemini` to `groq`.

The reason is request headroom, not cost — both free tiers are zero-cost. Google cut the Gemini
free tier (Dec 2025) to roughly **10-15 RPM and 250-1,000 requests/day per project**, and the
floor-shift Assistant — one short grounded call per user turn — began hitting those limits (429s)
under normal staging use. Groq's free tier gives **30 RPM** and far higher daily ceilings on its
free models (`llama-3.3-70b-versatile`: 30 RPM / 1,000 RPD / 12K TPM; `llama-3.1-8b-instant`:
30 RPM / 14,400 RPD), which clears the observed ceiling with margin. A survey of the 2026 free-tier
landscape (Groq, Mistral, Cerebras, NVIDIA NIM, SambaNova, OpenRouter `:free`, Cloudflare, GitHub
Models, Together, Cohere) put Groq first for this use case: the most request headroom among the
options that are a **pure OpenAI-compatible drop-in with no credit card**.

Because Groq exposes an OpenAI-compatible chat-completions endpoint (`https://api.groq.com/openai/v1`),
`groq` is a preset like the other two — not a second code path and not a vendor SDK. It keeps the one
`fetch` shape ADR-0013/0018 already established. The preset's default model is
`llama-3.3-70b-versatile`, the strongest free grounded-instruction-follower on Groq; a deploy that
needs raw daily volume over nuance can pin `llama-3.1-8b-instant` via `ASSISTANT_MODEL` (ADR-0013).
Groq sends no attribution headers (only the `openrouter` preset does). The default provider stays
`openrouter`; only the staging blueprint (render.yaml) moves to `groq`.

## Consequences

- The secret surface gains an optional `GROQ_API_KEY` alongside `OPENROUTER_API_KEY` and
  `GEMINI_API_KEY`. As with the others, the key for the *selected* provider is required and
  validated at boot (missing → fail fast); the unselected providers' keys may be left unset.
- `ASSISTANT_PROVIDER` widens to `openrouter | gemini | groq`. The switch remains a boot-time
  config decision, not a runtime fallback — ADR-0003/0013's failure contract (a failed call is a
  transient inline retry, never a persisted Message row) is unchanged.
- Staging (ADR-0017) now runs `groq`; `GROQ_API_KEY` must be supplied on the next Blueprint sync
  in the Render dashboard. `gemini` and `openrouter` remain one-env-value switches back.
- No vendor SDK is introduced — Groq is reached through the same OpenAI-compatible `fetch`, so
  ADR-0013's "no first-party SDK" property is preserved.
- ADR-0011's privacy constraint is unchanged and now spans three endpoints: Assistant prompt,
  response, and knowledge-doc content are never logged, whichever provider is live. Note that a
  provider's own free-tier data-use policy is separate from our logging: confirm Groq's terms
  before real customer context flows through the free tier.
- The test seam (the injected fake LLM port) is unchanged; the preset is covered by a unit test
  in `apps/api/test/llm-config.test.ts` alongside the existing `openrouter`/`gemini` cases.
