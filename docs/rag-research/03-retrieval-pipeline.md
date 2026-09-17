# Retrieval pipeline: chunking, hybrid search, reranking, evaluation

How production RAG pipelines are built in 2025-2026, with measured numbers.
Research date: 2026-08-17. Sources linked inline.

## Headline answer

The canonical production funnel is: retrieve wide (50-150 candidates from hybrid dense +
keyword arms), fuse with RRF, rerank with a cross-encoder down to top-10-20, generate with
enforced citations, and gate every change behind a gold-question regression suite. The single
highest-leverage stage we do not have today is the reranker. Several of our past fixes
(gists, soft gates, multi-query, per-document interleaving) turn out to be the
field-standard answers to the same problems.

## 1. Chunking

- Production convergence: recursive, structure-aware splitting at 400-512 tokens with 10-20%
  overlap; 400-800 is the broad band. A Jan-2026 analysis found a "context cliff" around
  2,500 tokens where answer quality drops.
  [Firecrawl chunking guide 2026](https://www.firecrawl.dev/blog/best-chunking-strategies-rag),
  [Weaviate](https://weaviate.io/blog/chunking-strategies-for-rag)
- Semantic chunking lifts retrieval 15-25% but costs 3-5x compute; adopt only when metrics
  demand it. [Agenta guide](https://agenta.ai/blog/the-ultimate-guide-for-chunking-strategies)
- **Contextual retrieval (Anthropic), the exact numbers**
  [anthropic.com/engineering/contextual-retrieval](https://www.anthropic.com/engineering/contextual-retrieval):
  baseline top-20 retrieval failure 5.7% → contextual embeddings 3.7% (-35%) → + contextual
  BM25 2.9% (-49%) → + reranking 150→20 gives 1.9% (-67%). The LLM writes 50-100 tokens of
  context per chunk, prepended before embedding AND keyword indexing. One-time cost with
  prompt caching: ~$1.02 per million document tokens. Also: under ~200k corpus tokens
  (~500 pages), skip RAG and put everything in a cached prompt. Our current 90-chunk corpus
  is in that regime today; the pipeline is justified by the scale target, not the present.
- **Late chunking (Jina)**: embed the whole doc, pool per-chunk. Cheaper than contextual
  retrieval but needs a long-context embedding model that exposes token embeddings, which a
  hosted API (our OpenRouter setup) does not. Contextual retrieval wins on quality, late
  chunking on cost. [Jina](https://jina.ai/news/late-chunking-in-long-context-embedding-models/),
  [arXiv 2409.04701](https://arxiv.org/abs/2409.04701)
- **Parent-document (small-to-big)**: index 200-400-token children, hand 800-1500-token
  parents (full section with heading) to the LLM. 15-25% answer-accuracy gains on
  hierarchical content. SOPs and procedures are exactly that shape.
  [Thread Transfer](https://thread-transfer.com/blog/2025-07-29-parent-document-retrieval/)
- **Tables**, the convergent recipe
  ([Ragie](https://www.ragie.ai/blog/our-approach-to-table-chunking),
  [arXiv 2605.00318](https://arxiv.org/html/2605.00318)): whole table as one chunk if it
  fits, otherwise split row-by-row, never mid-row, headers re-attached to every chunk; render
  as markdown, not JSON (repeated keys poison keyword search); row-level "header: value"
  chunks with the table title prepended fix point lookups. Our lease-table failure (14
  row-group clones monopolizing keyword seats) is a known pathology, and per-document
  interleaving (our PR #298) matches what the literature prescribes.

## 2. Hybrid retrieval and query-side tricks

- **RRF is still the standard fusion.** score = Σ 1/(k + rank), k=60 the universal default
  (Elasticsearch's default, needs no tuning).
  [Digital Applied hybrid reference 2026](https://www.digitalapplied.com/blog/hybrid-search-bm25-vector-reranking-reference-2026)
- Measured lifts: hybrid beats either single arm by ~7.4% NDCG on WANDS; 26-31% on mixed-query
  benchmarks. Division of labor: keyword arm wins on identifiers, acronyms, rare terms, exact
  strings; dense wins on paraphrase and cross-lingual. Our architecture (cross-lingual dense +
  lexical arm with cross-language gists) matches this exactly.
  [TianPan production writeup 2026](https://tianpan.co/blog/2026-04-12-hybrid-search-production-bm25-dense-embeddings)
- **Query-side tricks, survivors vs dead weight:**
  - Multi-query variants: SURVIVED, often the biggest single lift on conversational corpora.
    We already do this.
  - Conversational query rewriting with chat history: SURVIVED, table stakes for multi-turn.
  - HyDE: DEAD WEIGHT in production. Excluded from the SIGIR 2025 LiveRAG deployment because
    it decreased correctness and faithfulness while adding an LLM call of latency. Never add it.
  - Blind query expansion: marginal, superseded by the hybrid keyword arm.

## 3. Reranking: the canonical funnel

- Retrieve wide → fuse → rerank narrow → generate. First stage 50-150 candidates (returning
  only 10 to a reranker is the classic mistake); rerank 50-100 down to top-5-20. Anthropic's
  recipe: 150 → 20.
- Hosted rerankers: **Cohere Rerank 3.5** (100+ languages including Hebrew, table/JSON aware,
  ~$2 per 1,000 searches), **Voyage rerank-2.5** (claims +7.9% over Cohere, 32K context).
- This is the single highest-leverage stage missing from our pipeline, and the likely fix for
  our remaining cross-topic partial answers.

## 4. Grounding, citations, false declines, multilingual

- **Citations enforced in code, not prompt**: number every retrieved chunk, require the model
  to emit chunk IDs per claim, verify cited IDs exist in the retrieved set, fail closed.
  [regulated-rag](https://github.com/RZ-Logic/regulated-rag),
  [Openlayer groundedness guide 2026](https://www.openlayer.com/blog/rag-pipeline-evaluation-groundedness-faithfulness)
- **False declines are a calibration problem.** FinRAG-12B (banking,
  [arXiv 2605.05482](https://arxiv.org/html/2605.05482)) mixed 22% unanswerable examples into
  eval to calibrate abstention and measured BOTH failure directions (GPT-4.1 over-refused at
  20.2%). Transferable lessons: eval sets need trap questions AND borderline-answerable ones;
  "never assert nonexistence, offer partial answers" prompt rules (our PR #295) are the
  prompt-layer equivalent; hard score gates cause false declines, letting the model adjudicate
  borderline retrievals (our PR #294) matches the field's direction.
- **Multilingual**: cross-lingual embeddings as the dense arm is standard, but research on
  Arabic-English corpora documents a measurable cross-lingual retrieval penalty (same-language
  matches favored), which is exactly the bias our document-side gists neutralize for the
  lexical arm. Doc-side gists beat per-query translation (cheap at index time, zero query
  latency). Multilingual rerankers score Hebrew↔English pairs directly and close the gap
  further. [arXiv 2507.07543](https://arxiv.org/pdf/2507.07543)

## 5. Evaluation: the minimal-but-real harness

1. Gold question set with keyed answers, 50+, covering correct, trap, cross-topic, both
   languages. (Our 55-question flipped battery is precisely this.)
2. Retrieval metrics (recall@k) separate from answer metrics, so you know which stage
   regressed.
3. RAGAS core four: faithfulness, answer relevancy, context precision, context recall.
4. LLM-as-judge for what RAGAS misses (tone, partial-answer quality, language correctness),
   with human spot checks.
5. Regression gate in CI on every retrieval change; refresh 10-20% of the suite quarterly
   from real production queries. (Our client-trigger-question-to-probe workflow is textbook.)
6. Online loop: log query + retrieved chunk IDs + answer + feedback; mine failures into gold
   questions.

## 6. Ingestion and document quality

- Parsers: **LlamaParse** best for complex PDFs (~6s/doc), **Docling** best open-source
  (94%+ table accuracy), **unstructured.io has regressed** and is no longer recommended by
  2025-2026 benchmarks. Google Docs native exports mostly bypass this; it matters the day
  scanned PDFs land in Drive.
  [Procycons benchmark](https://procycons.com/en/blogs/pdf-data-extraction-benchmark/)
- Quality gates: attach parse/OCR confidence, quarantine low-confidence docs for human review
  instead of ingesting silently.
- Dedup and versioning: content-hash per doc to skip unchanged files; near-dup detection so
  stale versions don't create contradictory chunks.
- Sync and deletion: the standard is a full reconcile diffing source listing vs indexed doc
  IDs, update = delete-then-reinsert of all the file's chunks, absentees purged. Our
  ghost-docs incident was the canonical bug of this space; the reconcile-with-deletion fix is
  the industry-standard shape.
  [Ragie Drive integration](https://www.ragie.ai/blog/powering-your-rag-integrating-google-drive-for-seamless-knowledge-ingestion)

## Top-10 priorities for a small production team (agent's ranked list)

1. Add a reranking stage (hybrid 50-150 → Cohere Rerank 3.5 → top 10-20). Biggest measured
   single lift available to us.
2. Deletion reconciliation as a permanent structural property of sync.
3. Contextual chunk enrichment (50-100-token LLM-written context per chunk, embedded AND
   keyword-indexed). Natural extension of our gist machinery, -35 to -49% retrieval failures.
4. Table-aware chunking: markdown, headers on every row chunk, never split mid-row,
   per-document diversity caps in the keyword arm.
5. Regression gate in CI: the bilingual battery on every retrieval change, scoring correct /
   partial / false-decline / invented per language, blocking merges.
6. Keep multi-query variants; never add HyDE.
7. Enforce citations in code (cited IDs ⊆ retrieved IDs, deterministic check).
8. Calibrate abstention with trap AND borderline questions; soft gates over hard cutoffs.
9. Parent-document retrieval when the SOP corpus grows: small children indexed, full sections
   to the LLM.
10. Ingestion quality gates at scale: content-hash dedup, parse-confidence quarantine,
    version supersession.
