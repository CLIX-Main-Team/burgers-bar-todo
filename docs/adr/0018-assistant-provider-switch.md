---
status: accepted — amends ADR-0013
---

# The Assistant's LLM provider is a boot-time switch: OpenRouter (default) or native Gemini

ADR-0013 fixed the Assistant's answer path on a single provider — the OpenRouter broker,
reached by a plain OpenAI-compatible `fetch` — and dropped first-party provider paths from the
secret surface. This ADR keeps OpenRouter as the default but adds a second selectable provider:
Google's Gemini API reached through its **OpenAI-compatible endpoint**
(`https://generativelanguage.googleapis.com/v1beta/openai`), chosen at process start by an
`ASSISTANT_PROVIDER` config value (`openrouter` | `gemini`, default `openrouter`). It is a
switch, not a fallback: exactly one provider is live per process, and there is no runtime
failover between them — so ADR-0003/0013's failure contract (a failed call is a transient
inline retry, never a persisted Message row) is unchanged.

Because Gemini exposes an OpenAI-compatible chat-completions endpoint, both providers share the
one `fetch` shape already lifted from the source Clix-CRM assistant — the switch is a preset of
`{base URL, default model, API-key env, attribution headers}`, not a second code path and not a
vendor SDK. The `openrouter` preset keeps `google/gemini-2.5-flash` and OpenRouter's optional
`HTTP-Referer` / `X-Title` attribution headers; the `gemini` preset uses `gemini-2.5-flash`,
`GEMINI_API_KEY`, and sends no attribution headers. `ASSISTANT_MODEL` still overrides the routed
model when set, otherwise the selected preset's default applies (ADR-0013).

We added this because the deploy moved to Render's free tier (ADR-0017) and Google's Gemini API
has a genuine free tier where OpenRouter requires paid credits; the switch lets an operator run
the Assistant at zero cost by pointing directly at Gemini, while OpenRouter stays the default for
its multi-vendor model-swap freedom. Keeping both behind the same OpenAI-compatible seam means the
choice is one env value with no new adapter to maintain and no change to the injected LLM port.

## Consequences

- The secret surface gains an optional `GEMINI_API_KEY` alongside `OPENROUTER_API_KEY`. The key
  for the *selected* provider is required and validated at boot — a missing key fails fast — while
  the other provider's key may be left unset.
- ADR-0013's "single broker" premise relaxes to "default broker, with a direct-Gemini
  alternative." The broker's model-swap value still holds for the `openrouter` preset; the
  `gemini` preset trades that breadth for the free tier.
- No vendor SDK is introduced — the direct-Gemini path is still the same OpenAI-compatible
  `fetch`, so ADR-0013's "no first-party SDK" property is preserved even though a first-party
  *endpoint* is now reachable.
- Provider selection is a deploy-time config decision; switching providers is a restart, not a
  hot swap. This matches the boot-time construction of the injected LLM port and leaves the test
  seam (the fake port that drives the answer path, retry, budget, and guardrail wiring) unchanged.
- ADR-0011's privacy constraint is unchanged and now spans both endpoints: Assistant prompt,
  response, and knowledge-doc content are never logged, whichever provider is live.
