# RAG research: enterprise-grade retrieval for Burger's Bar

Research pass run 2026-08-17 (four parallel web-research agents + the client checklist + two
practitioner writeups). The question: what does a scalable, enterprise-level RAG system look
like in 2026, and should ours be rebuilt from scratch to become one.

## The answer in five lines

1. **Do not start from scratch.** The 2026 consensus production shape (plain code, Postgres +
   pgvector, hybrid RRF, measured evals) is the skeleton we already have. The enterprise gap
   is additive layers, not a different system.
2. **Supabase is enough, permanently.** pgvector is comfortable to ~5M vectors; our lifetime
   ceiling is ~100k. Migration path: Node cosine → SQL exact search → HNSW index, each ~1 day.
3. **Keep Qwen3-Embedding-8B.** It is #1 on the multilingual leaderboard at $0.01/1M tokens.
   Hebrew is a blind spot in every public benchmark, so our own bilingual battery is the
   deciding evidence for any model change.
4. **The biggest missing piece is a reranker** (Voyage rerank-2.5-lite, free at our volume, or
   Cohere Rerank 3.5). With contextual chunk enrichment, the measured recipe cuts retrieval
   failures up to 67%.
5. **"Enterprise" contractually = three cheap things we lack:** department-scoped retrieval
   (the client's written acceptance test), an audit log, and a budget guard so an empty
   OpenRouter wallet can never silently kill production again.

## Files

- `01-vector-storage.md` — pgvector vs dedicated vector DBs, real limits with numbers, the
  100/1k/10k/100k ladder, Hebrew full-text caveats, multitenancy patterns.
- `02-embeddings-hebrew.md` — 2026 embedding leaderboard, the Hebrew benchmark blind spot,
  rerankers, dims/quantization, migration discipline, ranked shortlists.
- `03-retrieval-pipeline.md` — chunking (incl. Anthropic contextual retrieval numbers and
  table handling), hybrid RRF, query tricks that survived production (and HyDE, which died),
  the rerank funnel, grounding/citations, the minimal real eval harness, ingestion quality.
- `04-enterprise-operations.md` — reference architectures (Notion AI etc.), managed services
  and why we skip them, what breaks first at 100x docs, ACL/audit/PII, the 402 problem,
  observability, the framework question.
- `05-requirements.md` — the yardstick: hard requirements from the client checklist PDF plus
  the lessons from both practitioner writeups, and the scale target.
- `06-target-architecture.md` — the synthesis: end-to-end target design, decision table with
  evidence, scorecard against the checklist, and a 4-phase roadmap (contractual enterprise →
  retrieval quality → scale hardening → multipliers).
- `07-implementation-audit.md` — 15-agent verified audit of our actual code against files
  01-06: 3 high findings (poison-file sync freeze, ghost-docs purge still unfixed, silent
  vector poisoning via env swap), a reproduced Hebrew keyword bug, the keyword-arm gate
  amplifier, the 2x Hebrew token-budget error, and the full efficiency and hygiene lists.
