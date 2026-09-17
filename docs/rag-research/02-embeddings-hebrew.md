# Embedding models and rerankers for a Hebrew/English corpus

What production RAG systems embed with in 2025-2026, with a Hebrew focus.
Research date: 2026-08-17. Sources linked inline.

## Headline answer

Qwen3-Embedding-8B, the model we already use, is the #1 model on the multilingual MTEB
leaderboard (70.58) and costs $0.01 per million tokens, 6-15x cheaper than every closed API
below it. Keeping it is not settling, it is the leaderboard-optimal choice. The real gap in
our stack is the missing reranker, and the real caution is that Hebrew is a benchmark blind
spot everywhere, so our own bilingual battery outranks any published number.

## 1. Current standings (MTEB Multilingual / MMTEB)

| Model | Score | Dims | Price /1M tokens | Notes |
|---|---|---|---|---|
| Qwen3-Embedding-8B | 70.58 (#1) | 4096, MRL 32-4096 | ~$0.01 hosted | Apache 2.0, 100+ langs, 32k ctx |
| gemini-embedding-001 | 68.32 (#1 API) | 3072, MRL | $0.15 | only 2,048-token input window |
| voyage-3-large / voyage-4 | ~67+ | 2048/1024/512/256 | $0.18 / $0.06 | voyage-4 Jan 2026, first 200M tokens free |
| Cohere embed-v4 | 65.2 | 256-1536 MRL | $0.12 | multimodal, 128k context |
| OpenAI text-embedding-3-large | 64.6 | 3072, MRL | $0.13 | MIRACL 54.9 |
| BGE-M3 | 63.0 | 1024 | free | dense+sparse+multi-vector, self-host default |
| jina-embeddings-v4 | 66.49 MMTEB | 2048 | $0.018 | Hebrew NOT in its strong-30 languages |

Sources: [Qwen3-Embedding blog](https://qwenlm.github.io/blog/qwen3-embedding/),
[PremAI ranked list, 2026-03-17](https://www.premai.io/blog/best-embedding-models-for-rag-2026-ranked-by-mteb-score-cost-and-self-hosting/),
[Google gemini-embedding GA](https://developers.googleblog.com/gemini-embedding-available-gemini-api/),
[Voyage pricing](https://docs.voyageai.com/docs/pricing),
[Cohere Embed v4](https://docs.cohere.com/changelog/embed-multimodal-v4).
Context: MongoDB bought Voyage AI for $220M (2025-02); the API survived. The 2026 headline
shift: open weights (Qwen3) now beat every closed API on multilingual MTEB.

**What MTEB does not predict:** models train on its public datasets; BEIR is "no longer
zero-shot"; 400+ models sit within noise of each other. RTEB (private held-out sets) exists
precisely to catch this. Every migration guide says the same thing: flip models only when the
new one wins on YOUR OWN held-out query set, never on a leaderboard.
[The New Stack on RTEB](https://thenewstack.io/exploring-rteb-a-new-benchmark-to-evaluate-embedding-models/)

## 2. Hebrew is a benchmark blind spot

- MIRACL, the standard multilingual retrieval benchmark, does NOT include Hebrew. Every
  vendor "MIRACL score" says nothing direct about Hebrew.
- MMTEB covers 250+ languages but Hebrew-specific eval tasks are scarce.
- Hebrew-specific research (NeoDictaBERT 2025-10, [arXiv 2510.20386](https://arxiv.org/pdf/2510.20386))
  exists but offers no head-to-head production embedding comparison.
- For cross-lingual alignment (HE query → EN doc): Gemini Embedding is SOTA on XOR-Retrieve,
  the standard cross-lingual benchmark ([arXiv 2503.07891](https://arxiv.org/pdf/2503.07891)),
  but XOR-Retrieve does not test Hebrew either. Qwen3's #1 MMTEB includes bitext-mining
  (explicit cross-language alignment) across 100+ languages including Hebrew.

Implication: no public benchmark settles "Qwen3 vs Gemini for Hebrew". Our 55-question
flipped-language battery is genuinely better evidence than anything published, and the
doc-side gist bridge stays as belt-and-suspenders regardless of embedder.

## 3. Dimensions and quantization

- Production clusters at 768-1536 dims. Every 2025+ flagship is Matryoshka-trained, so 1024
  is a supported truncation everywhere, not a compromise.
- Striking datapoint: voyage-3-large at int8 + 512 dims beats OpenAI full-float 3072 by 1.16%
  at ~200x lower storage cost.
- pgvector-relevant: halfvec (fp16) is the recommended default, 50% storage for <1% recall
  loss; int8 = 4x for 1.5-3.5% drop; binary = 32x but needs a rescore pass.
- At our scale none of this matters yet. 1024 float dims is fine indefinitely.

## 4. Rerankers: "cheap embed + strong reranker" IS the standard 2026 pattern

- Lift: cross-encoder reranking adds 15-30% precision/recall; 5-15 nDCG@10 points on
  long-tail phrasing, abbreviations, multi-hop. 2026 roundups call it "essential".
  [ZeroEntropy guide](https://zeroentropy.dev/articles/ultimate-guide-to-choosing-the-best-reranking-model-in-2025/),
  [Agentset leaderboard, 2026-02-15](https://agentset.ai/rerankers)
- Options: Zerank 2 tops ELO but is non-commercial licensed; Cohere Rerank 4 Pro (614ms,
  $0.05/1M); Voyage rerank-2.5 (613ms, $0.05/1M, lite at $0.02); Cohere Rerank 3.5 (fastest
  strong option, 392ms, ~$1 per 1k queries, explicit 100+ language training); Qwen3-Reranker-8B
  accurate but ~4.7s hosted, impractical without our own GPU.
- Voyage gives the first 200M tokens FREE on rerank-2.5/lite, which at our query volume means
  $0 for years.
- Latency: an API reranker adds ~250-620ms. Invisible next to an LLM answer taking seconds.

## 5. Serving: aggregator vs first-party

- Qwen3-Embedding-8B is $0.01/1M on both OpenRouter and DeepInfra directly (same listed
  price; OpenRouter mostly routes to DeepInfra-class hosts anyway).
- Tradeoffs of the aggregator path: no SLA, possible numerical variance if OpenRouter
  reroutes between providers (worth PINNING a provider for embedding consistency so vectors
  stay comparable), no contractual data handling.
- At our scale embedding cost is noise on any vendor: re-embedding 10M tokens is $0.10 on
  Qwen3, ~$1.50 on Gemini.

## 6. Migration and versioning discipline

Consensus pattern ([Qdrant tutorial](https://qdrant.tech/documentation/tutorials-operations/embedding-model-migration/),
[Mixpeek](https://mixpeek.com/guides/embedding-portability-versioning)):
1. Vectors from different models/dims are never interoperable; store model name + dimension
   as first-class columns. Worth adopting BEFORE scale arrives.
2. Blue-green: new column sized for the new model, dual-write new ingests, background
   re-embed while the old index serves.
3. Validate on held-out real queries against both indexes; flip reads only when the new one
   wins on our data; drop the old column.

Our reconcile-queue pattern already is the dual-write mechanism; at 90 chunks a migration is
minutes and cents. The discipline (model+dim columns) is what to build in now.

## Ranked shortlist for this corpus

Embeddings:
1. **Keep Qwen3-Embedding-8B @1024** via OpenRouter/DeepInfra: #1 multilingual score,
   $0.01/1M, already validated by our own bilingual battery. No published evidence any paid
   API beats it on Hebrew specifically.
2. **Gemini Embedding at 1536** as the upgrade path if HE↔EN cross-lingual misses persist
   despite the gist bridge: the only model with benchmark-proven SOTA cross-lingual
   alignment. Mind the 2,048-token input cap per chunk.
3. **voyage-4 @1024** as the first-party-API hedge if aggregator reliability becomes a
   concern: $0.06/1M and effectively free for years at our size.

Rerankers:
1. **Voyage rerank-2.5-lite**: $0 at our scale (200M free tokens), near-top quality,
   token-based pricing suits low query volume.
2. **Cohere Rerank 3.5**: fastest strong option, explicit multilingual training including
   Hebrew, the fallback if Voyage disappoints on Hebrew in our battery.

Standing rule: any embedder or reranker change gates on re-running the 55-question
flipped-language battery. Our harness outranks the leaderboards for this corpus.
