# Enterprise operations: the layer around retrieval

How real companies run RAG in production: ingestion at scale, permissions, audit, cost
guards, observability, and the build-vs-managed question.
Research date: 2026-08-17. Sources linked inline.

## Headline answer

The 2026 consensus for a small team is: plain code over frameworks, metadata-filtered
permissions over separate indexes, managed retrieval services only when the corpus is a side
feature. What separates "enterprise" from "demo" contractually is three things: scoped
retrieval, predictable billing, and an audit trail. All three are cheap in our stack.

## 1. Reference architectures from real production stacks

**Notion AI** (best-documented public scaling story,
[ZenML case study](https://www.zenml.io/llmops-database/scaling-data-infrastructure-for-ai-features-and-rag)):
CDC → Kafka → data lake; dual-path embedding (batch bulk + streaming live edits); content
hashes to skip re-embedding when only metadata changed (70% reduction in processed volume,
the single most transferable idea); pre-computed denormalized ACLs filtered at query time so
restricted docs never enter the prompt; vector + keyword indexes fed from the same lake,
"lexical and semantic are complementary, not competitive". Net: 10x capacity, 90% cost cut
over two years. They ended on turbopuffer at 10B+ vectors, a scale 100,000x ours.

**Neum AI** ([billion-vector ingestion writeup](https://medium.com/@neum_ai/retrieval-augmented-generation-at-scale-building-a-distributed-system-for-synchronizing-and-eaa29162521)):
the canonical queue-stage pattern: three queues (request → parse+chunk → embed+store),
workers per stage, retries + dead-letter queues. Findings: over-parallelizing vector writes
causes connection errors; halving embedding dims saved money with no measurable loss.

**Consensus generic pipeline**
([Prem AI 2026 guide](https://www.premai.io/blog/building-production-rag-architecture-chunking-evaluation-monitoring-2026-guide/),
[BigDataBoutique](https://bigdataboutique.com/blog/rag-pipeline-end-to-end-architecture-guide)):
parse (layout-aware) → chunk (~512 tokens, boundary-aware) → embed (versioned, pinned) →
hybrid retrieval (BM25 + dense, RRF) → rerank ("single highest-ROI component") → context
assembly → generate → continuous eval with CI gates. Repeated claim: ~80% of RAG failures
trace to ingestion/chunking, not the LLM.

## 2. Managed alternatives (and why we skip them)

| Service | Solves | Cost floor | Catch |
|---|---|---|---|
| AWS Bedrock Managed KB | full pipeline, native Drive connector, incremental sync incl. deletes | ~$345/mo idle on OpenSearch; S3 Vectors ~90% cheaper | tight ingestion quotas; cannot reproduce our gist bridge; adds AWS to a Render/Supabase shop |
| Azure AI Search | hybrid + semantic reranker + the strongest managed ACL story; the ONLY managed option with real Hebrew analyzers (he.microsoft, he.lucene) | ~$74/mo/SU | opaque tuning; another cloud |
| Vertex AI Search | Google-grade search | $1.50-6.00 per 1k queries, 10k free/mo | most opaque to tune |
| OpenAI file_search | zero-infra RAG | $2.50/1k queries + $0.10/GB/day | no Drive connector, weak ACL story, Assistants API sunsets H1 2026 |

When a small team picks managed: the corpus is a side feature, connector maintenance costs
more than the subscription, or compliance needs vendor-attested controls. None apply to us,
and none of them would have produced the bilingual gist bridge, which is ahead of what the
managed tiers do for a two-language corpus. Azure's Hebrew analyzers are the one genuinely
enviable feature.

## 3. Ingestion at scale: what breaks first at 40 → 4,000 docs

1. Synchronous single-job ingestion: a full reload of minutes becomes hours, and a mid-run
   crash restarts from zero. Fix: per-doc status column (pending/embedded/failed), retry with
   backoff, bounded concurrency. Our gist queue is already half of this; generalize it.
2. Embedding API rate limits during full re-embeds. Fix: batching + concurrency caps.
3. Retrieval quality: one noisy giant table monopolizing top-k (we measured exactly this).
4. Eval blindness: without CI gates, regressions land silently.
5. Delete/rename reconciliation drift (our ghost-docs incident). Fix: every sync diffs the
   full Drive listing against the DB, retires absentees (soft-delete first, hard-delete after
   N days). Update = write new version → flip pointer → delete old; never null live vectors.

Vector search itself is NOT what breaks at 4k docs (~40k vectors, trivial for pgvector).

## 4. Access control, audit, PII

- Consensus mechanism: **filter at query time on ACL metadata stamped at ingestion, BEFORE
  similarity ranking**. "Retrieving unauthorized documents then filtering is a data leak."
  Separate per-department indexes only for hard regulatory isolation; within one org,
  metadata filters win. [Cerbos](https://www.cerbos.dev/blog/access-control-for-rag-llms),
  [FINOS](https://air-governance-framework.finos.org/mitigations/mi-16_preserving-source-data-access-controls-in-ai-systems.html)
- The hard part is syncing source ACLs into chunk metadata and keeping them fresh. For our
  department model the simple version is a Drive-folder → department mapping stamped at sync,
  then `AND department = ANY(user.departments)` in BOTH retrieval arms.
- **Audit log**: "an architectural requirement, not an optional layer" in enterprise deals.
  Shape: one append-only row per assistant query: user, timestamp, query, retrieved chunk IDs
  + scores, answer, model, token cost. Doubles as the eval-harvesting dataset.
- **PII**: embeddings themselves leak PII, so redact before embedding where it matters. For
  our corpus the exposure is HR/lease docs, and the department filter is the real mitigation
  (the open rental-exposure question becomes "scope leases to management" instead of "delete
  them").

## 5. Reliability and cost

- **Semantic answer cache**: internal knowledge bases hit 30-60% cache rates; restaurant SOP
  questions are exactly that workload. Gate with a high similarity threshold + TTL tied to
  corpus version. Embedding cache (content hash → vector) is free insurance.
  [arXiv 2411.05276](https://arxiv.org/pdf/2411.05276)
- **The 402 problem** (our 2026-08-17 outage): OpenRouter's failover layers (provider
  failover, model fallbacks) do NOT help an empty wallet; a 402 fails everything. Production
  pattern: (1) poll `GET /api/v1/credits` on a schedule, alert below ~2 weeks of runway;
  (2) auto-top-up or calendar top-ups; (3) keep ONE direct-provider key as a code-path
  fallback for chat + a compatible embedding model, because an OpenRouter-only stack is a
  single financial point of failure; (4) degrade gracefully: on 402 the assistant says
  "temporarily unavailable", never a stack trace; (5) alert 402 and 429 as distinct classes.
  [OpenRouter failover blog](https://openrouter.ai/blog/insights/reliability-failover/)
- **Observability**: Langfuse (MIT, self-hostable, OTel-native) is the best fit for a
  budget stack; Arize Phoenix free self-host; OpenLLMetry as the thinnest OTel layer.
  Minimum viable: trace every assistant call (query → chunks + scores → prompt → answer →
  tokens/cost/latency). [SigNoz comparison](https://signoz.io/comparisons/llm-observability-tools/)

## 6. Framework question: LangChain/LlamaIndex or plain code?

Clear 2026 consensus: plain code is a legitimate and increasingly common production choice
for stable single-corpus RAG. Senior engineers are ditching LangChain for vanilla calls;
frameworks earn their keep for tool-heavy multi-step agents, not for "one corpus, one
retrieval strategy you tune by measurement", where the abstraction obscures exactly the layer
you need to control. Our hand-rolled TypeScript pipeline IS the consensus-blessed shape.
Nobody credible recommends rewriting a working plain-code pipeline into a framework.
[Zen van Riel 2026](https://zenvanriel.com/ai-engineer-blog/langchain-vs-langchain-2026-update/),
[Enterprise DNA survey](https://enterprisedna.co/resources/blog/practitioner-langchain-2026/)

## The gap list for our team, ordered by importance (agent's ranking)

1. Department/role-scoped retrieval (the client's written acceptance test; filter before
   ranking in both arms).
2. Budget/402 guard on OpenRouter (credits polling + alert + graceful degradation + one
   direct-provider fallback key).
3. Retrieval audit log (append-only table; also the eval-harvesting substrate).
4. Delete/rename reconciliation as a structural property of every sync.
5. Eval battery wired into CI with pass/fail thresholds.
6. Ingestion checkpointing/resumability (per-doc status, retries, bounded concurrency).
7. Embedding cache + (later) semantic answer cache keyed to corpus version.
8. Tracing (self-hosted Langfuse or OpenLLMetry).
9. Skip, with reasons: managed retrieval services, frameworks, on-prem, per-department
   separate indexes.

Items 1-3 are what "enterprise-level" means contractually. 4-6 are the failure modes that
arrive with corpus growth. 7-8 are multipliers that can wait.
