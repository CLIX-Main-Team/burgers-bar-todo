---
status: accepted — supersedes ADR-0004's retrieval mechanism; amends ADR-0013's prompt shape
---

# Assistant grounding moves to chunked embedding retrieval, ranked in-process

ADR-0004 grounded the Assistant by injecting **whole cached documents** into the prompt "up to a
token budget", with a **keyword/title overlap fallback** when the corpus outgrew it, and explicitly
deferred embeddings: *"no vector search — the corpus is small"*. That premise expired. The corpus
grew to ~37 ingested docs ≈ **29.5k tokens against a 6k grounding budget (4.9×)**, so the fallback
ranked **every** question, and a committed probe battery (apps/api/src/assistant-probe.ts, 2026-08)
measured what that did to answer quality:

- **Length bias**: bag-of-words overlap scores a document by how many distinct question words it
  contains anywhere, so the longest data dumps won almost every question — the bread-orders
  spreadsheet was injected for 9 of 14 probes, including greetings. The 376-token branch-opening
  checklist competed against 4–5k-token spreadsheets for the same budget.
- **Wrong-doc follow-ups**: retrieval re-ran on the follow-up text alone ("ומה אחרי זה?" carries no
  content words), the topic's doc dropped out, and the live model **confidently continued from an
  unrelated document** — worse than declining.
- **No cross-language reach**: an English question could not match a Hebrew doc except by luck, and
  Hebrew morphology (prefixes: מזמינים vs הזמנות) broke even same-language matching.
- **Budget-filler noise**: after ranking, greedy packing filled leftover budget with zero-overlap
  docs, so a bare greeting shipped ~6k tokens of fuel reports to the model on every turn.

## Decision

Ground on **chunks, ranked by embeddings, in-process** — three coupled choices:

1. **Chunk at ingestion** (`chunking.ts`, `knowledge_chunks` table): every ingested doc is split
   into ~450-token structural chunks (paragraph → line → hard-cut, small tails merged). Uniform
   candidates are what remove the length bias: a 20k-char spreadsheet now competes one row-group at
   a time. Chunk rows are replaced whenever the parent doc re-syncs and cascade on its delete.

2. **Embed with the provider key we already hold** (`embedding-client.ts`): chunks (title-prefixed)
   and the query are embedded via the provider's OpenAI-compatible `/embeddings` endpoint — the same
   OpenRouter key as the answers, no new credential. The model is **`qwen/qwen3-embedding-8b` at
   `dimensions: 1024`**, chosen by a measured bake-off on the real corpus: it separated
   relevant-from-irrelevant with 2–4× the margin of gemini-embedding-001 / text-embedding-3-large /
   mistral-embed in BOTH directions we need — Hebrew question → Hebrew doc, and English question →
   Hebrew doc — and was stable across repeated calls where gemini-embedding's cross-lingual margin
   flipped sign between identical requests (OpenRouter multi-provider routing variance). Embedding
   the whole corpus costs well under a cent; a query costs micro-cents.

3. **Rank in-process, not in a vector database** (`retrieval.ts`): ~90 chunks × 1024 floats load in
   one query and rank by cosine in microseconds. pgvector (available on the prod Supabase) is the
   deliberate upgrade path when the corpus grows ~10×, not this slice — no new infrastructure, no
   local-dev image change, testcontainers untouched.

Retrieval scores every embedded chunk against **two query variants** — the bare question, and the
previous-user-turn-prefixed variant — best-variant-wins, which keeps a content-free follow-up
anchored to its topic while a topic switch still wins through the bare variant. Selection is gated
by measured thresholds (top chunk < 0.5 → ground **nothing**, so small talk and off-topic questions
carry no noise; survivors trimmed to a top-relative band, ≤ 8 chunks, ~3k tokens) and rendered
grouped per doc under the exact `## title` heading the SOURCES trailer (#227) resolves citations
against.

**Embeddings are an enhancement, never a dependency.** Chunking is pure and runs regardless; every
embedding failure — provider outage, an embedding-less provider (groq), an unfilled index — folds to
`{ ok: false }` and retrieval falls back to the same keyword overlap as before, now over uniform
chunks. The index maintains itself on the sync's `afterReconcile` seam (chunk pending docs → backfill
missing vectors, batched; a failed batch retries next pass), so the first deploy backfills the
existing corpus automatically and an edited doc re-indexes without ceremony.

The guardrail prompt (ADR-0013) was rewritten in the same change — the policy #267 settled
(grounded-or-greeting, decline by naming scope) is unmoved, but the prompt now carries a persona,
**today's date and the asker's role** (due-date questions were structurally unanswerable), an
answer-the-covered-part rule, follow-up awareness, Markdown shape guidance, and an instruction to
phrase declines naturally rather than parroting one template sentence. The excerpts are introduced
as *pieces* of documents so the model does not present one as a whole.

## Consequences

- Grounding drops from ~6k mostly-noise tokens to ≤ ~3k relevant tokens per question — cheaper,
  faster, and the measured probe battery shows the right doc ranked first in both languages,
  follow-ups keeping their doc, and zero chunks injected for small talk.
- Tests stay provider-free: the scriptable fake embedding client **fails by default**, landing
  integration tests on the deterministic keyword path; retrieval's vector mechanics are unit-tested
  with hand-built geometry; the probe battery remains the manual, live-model instrument.
- The answer's citation contract (#227) and every security boundary (ADR-0007 scoped tasks,
  author-scoped threads, ADR-0011 no-content logging) are unchanged.
- New env surface: optional `ASSISTANT_EMBEDDING_MODEL` override only; no new key, no required
  config. `knowledge_chunks` migrates via the standard drizzle path.
- Revisit (the 10× corpus): move ranking to pgvector on the existing Supabase, and consider
  hybrid keyword+vector fusion; both slot behind `retrieval.ts` without moving the seams.
