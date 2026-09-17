# Target architecture and roadmap

The synthesis: what to build, in what order, scored against `05-requirements.md`.
Written 2026-08-17 from the four research files in this folder.

## The verdict on "start from scratch"

No. This is the research talking, not attachment to the current code: the 2026 consensus
production shape for a single-corpus, measurement-tuned RAG is a plain-code pipeline over
Postgres+pgvector with hybrid RRF retrieval, exactly the skeleton we have. A greenfield
rebuild by 2026 best practice would reproduce this same skeleton, minus two years of
battle-tested fixes (the gist bridge, the interleaving fix, the abstention calibration) that
the research validated as field-standard answers. What we have is not a vibe-coded toy that
scaling will kill; it is the consensus architecture with specific layers missing. The
enterprise gap is real but it is ADDITIVE: permissions, reranking, audit, cost guards,
CI-gated evals, ingestion hardening. So the plan below is a rebuild of layers, not of the
system.

What DOES get replaced eventually: Node-side cosine (becomes in-SQL `<=>`, later HNSW), the
flat chunk schema (becomes doc/section/chunk hierarchy with metadata), and the Drive-shaped
loader (becomes a source-agnostic ingestion pipeline).

## Target architecture, end to end

```
SOURCES                 INGESTION                      STORE (Supabase Postgres)
Google Drive ──┐        per-source connector           documents (id, source, version,
Claude Team ───┤        → reconcile (diff listing,       content_hash, department[],
WhatsApp form ─┤          purge absentees)               branch, audience, lang, dates,
Outlook ───────┘        → quality gate (parse            derived_from -> procedure id)
                          confidence; quarantine)      sections (parent chunks, 800-1500 tok)
                        → parse (Docling/LlamaParse   chunks (200-400 tok children,
                          for PDFs; native for Docs)     ctx-enriched text, gist, model+dim,
                        → hierarchical chunking          halfvec embedding, department[])
                          (tables: row-atomic,         audit_log (append-only: user, query,
                          headers attached, markdown)    chunk ids, scores, answer, cost)
                        → contextual enrichment
                          (50-100 tok LLM context
                          + cross-language gist)
                        → embed (Qwen3-8B @1024,
                          pinned provider, hash cache)
                        → checkpointed queue (per-doc
                          status, retry, bounded conc.)

QUERY PATH
user query (+ role, departments, branch)
  → conversational rewrite + multi-query variants        [keep, no HyDE ever]
  → hybrid retrieval, BOTH arms filtered by
    department/branch BEFORE ranking:
      dense: cosine over chunks (SQL <=>, HNSW later)
      keyword: IDF arm over title+content+gist,
               per-document interleaving
  → RRF fusion (k=60), 50-150 candidates
  → rerank: Voyage rerank-2.5-lite or Cohere 3.5 → top 10-20
  → parent expansion (feed full sections, not fragments)
  → generate with numbered chunks; citations verified in
    code (cited ids ⊆ retrieved ids), fail closed
  → audit_log row
  → answer

GUARDRAILS AROUND IT
credits poll + 2-week-runway alert · graceful 402 degradation · one direct-provider
fallback key · CI regression gate (bilingual battery, per-language scoring, blocks merges)
· tracing (Langfuse/OTel) · staging environment
```

Choices already settled by the research, with the deciding evidence:

| Choice | Decision | Why |
|---|---|---|
| Vector store | Supabase Postgres, pgvector | comfortable to ~5M vectors; our ceiling is ~100k; second datastore = pure ops cost (01) |
| Vector search path | Node cosine → SQL exact `<=>` → HNSW halfvec | each step ~1 day, triggered by scale not calendar (01) |
| Embeddings | keep Qwen3-Embedding-8B @1024, pin the provider | #1 MTEB multilingual, $0.01/1M; no published evidence anything beats it on Hebrew (02) |
| Reranker | add Voyage rerank-2.5-lite (Cohere 3.5 fallback) | biggest measured lift available (up to -67% retrieval failures with the full recipe); free at our volume (02, 03) |
| Fusion | RRF, k=60 | still the standard; universal default (03) |
| Chunking | hierarchical parent/child + row-atomic tables + contextual enrichment | Anthropic's measured -49% before reranking; tables are our proven failure class (03) |
| Permissions | metadata filter (department[]/branch) before ranking, RLS optional hardening | industry consensus; separate indexes only for regulatory isolation (04) |
| Framework | none, plain TypeScript | 2026 consensus for single-corpus RAG (04) |
| Managed service | no | cost floors $74-345/mo, none reproduce the gist bridge; Azure's Hebrew analyzers are the only envy (04) |

## Scorecard against the client checklist (05-requirements.md)

- Department permissions + acceptance test → Phase 1. Metadata filter in both arms, filter
  before ranking, test asserts cross-department leakage = 0.
- Two repositories (HQ/branch) + franchisee layer → same mechanism: audience/branch columns.
- Procedure versioning + derived checklists → documents table gets version, content_hash,
  derived_from; supersession = new version in, old chunks retired atomically.
- Multi-source ingestion → connector-per-source in front of one shared pipeline. Claude Team
  has no export API (raise with client); WhatsApp via form/Business API only.
- Staging → Phase 3; Render + Supabase free tiers make this cheap.
- Audit trail → Phase 1, one append-only table.
- Bilingual → already our strongest suit; reranker closes the remaining cross-lingual gap.

## Roadmap

**Phase 1: contractual enterprise (about a week).** What "enterprise-level" means on paper.
1. Department/branch/audience metadata + filtered retrieval in both arms + the acceptance
   test. Also properly resolves the lease-exposure question (scope to management, not delete).
2. 402/budget guard: credits polling, runway alert, graceful degradation, direct-provider
   fallback key. A day of work that prevents the exact outage the client just lived through.
3. Retrieval audit log.
4. CI regression gate: the 55-question bilingual battery, scored per language, blocking.

**Phase 2: retrieval quality (about a week).**
5. Reranker stage (50-150 candidates → top 10-20), gated on the battery.
6. Contextual chunk enrichment (extends the existing gist machinery; one re-ingest).
7. Hierarchical parent/child chunking + row-atomic tables (closes the fourth upheld grader
   failure structurally).
8. Citations verified in code.

**Phase 3: scale hardening (before the corpus grows, not after).**
9. Cosine into SQL (`<=>` exact), HNSW halfvec index when chunks pass ~10k.
10. Ingestion checkpointing (per-doc status, retries, bounded concurrency), content-hash
    embedding cache, quality-gate quarantine for scanned PDFs.
11. Versioning discipline: model+dim columns, blue-green re-embed path.
12. Staging environment.

**Phase 4: multipliers (when usage justifies).**
13. Semantic answer cache (SOP questions are a 30-60% hit-rate workload).
14. Tracing (Langfuse self-hosted or OpenLLMetry).
15. New source connectors (Claude Team export when Anthropic ships one, WhatsApp form,
    Outlook emission).

## What carries over from the current system unchanged

The eval assets are the crown jewels and survive any engine change: the 55-question
flipped-language battery, the trap questions, the graded-exam gold keys, the
client-question-to-probe workflow. Second: the measured-decision discipline itself. Every
phase above gates on the battery, because for a Hebrew corpus our harness is stronger
evidence than any public leaderboard (02).
