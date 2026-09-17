# Vector storage and search at scale

How production RAG systems store and search vectors in 2025-2026, and what that means for us.
Research date: 2026-08-17. Sources linked inline.

## Headline answer

Supabase Postgres with pgvector covers our entire realistic corpus lifetime. Every source with
real numbers agrees: single-node pgvector with an HNSW index is comfortable to ~5M vectors and
workable to ~50M, and our honest ceiling is tens of thousands of chunks, two orders of
magnitude below where anyone reports strain. A dedicated vector database at our scale buys
nothing except a second system to operate and pay for.

## 1. Postgres + pgvector: the real production limits

- Brute force (no index) is fine to hundreds of rows and degrades in the low thousands.
  [Neon on HNSW with pgvector](https://neon.com/blog/understanding-vector-search-and-hnsw-index-with-pgvector)
- With HNSW, single-node pgvector holds p99 under 10 ms up to ~5M vectors on a standard
  Supabase Pro instance; real degradation starts above ~50M on one node.
  [Instaclustr benchmark](https://www.instaclustr.com/education/vector-database/pgvector-performance-benchmark-results-and-5-ways-to-boost-performance/),
  [ParadeDB: pgvector limitations, 2026-05-14](https://www.paradedb.com/learn/postgresql/pgvector-limitations)
- Supabase's own benchmark (pgvector 0.5.0, 2023-09-06): 1M OpenAI 1536-dim vectors on a 2XL
  (8 vCPU / 32 GB) at accuracy@10 = 0.99 beat Qdrant on equivalent compute; 224k vectors ran
  fine on 2 cores / 8 GB. [Supabase blog](https://supabase.com/blog/increase-performance-pgvector-hnsw)
- The real ceiling is RAM, not row count. A vector(1536) is ~6 KB; performance falls off a
  cliff when index + vectors spill out of memory. 5M x 1536-dim wants 8-16 GB working memory.
- `halfvec` halves storage and memory with minimal recall loss (pgvector 0.7.0+).
  [Supabase pgvector 0.7.0](https://supabase.com/blog/pgvector-0-7-0)
- Supabase's production guidance says outright: skip indexes for small, slow-growing datasets
  or when you need 100% accuracy. [Going to prod](https://supabase.com/docs/guides/ai/going-to-prod)
- Weakest spot: filtered search. HNSW walks the graph first, then applies WHERE, so a
  selective filter (one branch, one department) can starve results. pgvector 0.8.0 iterative
  scans (`hnsw.iterative_scan = relaxed_order`) fix the recall.
  [Supabase HNSW docs](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes),
  [pgvector issue #980](https://github.com/pgvector/pgvector/issues/980)
- pgvectorscale (Timescale) pushes Postgres to 50M vectors at 471 QPS / 99% recall, but it is
  NOT installed on Supabase. On Supabase you get stock pgvector, which is enough for us.

## 2. Dedicated vector DBs: when teams actually switch

Switch triggers named across 2025/2026 comparisons
([DEV](https://dev.to/polliog/postgresql-as-a-vector-database-when-to-use-pgvector-vs-pinecone-vs-weaviate-4kfi),
[kalviumlabs](https://www.kalviumlabs.ai/blog/vector-databases-compared-pgvector-pinecone-qdrant-weaviate/),
[Tiger Data](https://www.tigerdata.com/blog/pgvector-vs-qdrant),
[OpenHelm](https://openhelm.ai/blog/pinecone-vs-weaviate-vs-qdrant-vs-pgvector)):

| Engine | When it earns its keep | Cost |
|---|---|---|
| pgvector | Stack already Postgres, under ~2M vectors, vectors + relational data in one transaction | included in Supabase |
| Qdrant | Best filtered-search latency, self-hostable | free 1 GB tier, clusters from ~$96/mo |
| Pinecone | Sub-20 ms p95 at 5M+ vectors, zero ops, premium price | ~$0.33/GB storage |
| Weaviate | Built-in hybrid + vectorizers | ~$25/mo entry, ~$199/mo at low millions |
| Milvus/Zilliz | Billion scale | ~$80-500/mo; loses to Qdrant under 10M |
| Turbopuffer | Massive cold multi-tenant corpora on object storage | $16/mo minimum, 300-500 ms cold p50 |
| Vespa | Very high QPS + complex ranking | overkill below tens of millions |

The 2026 practitioner mood has shifted TOWARD Postgres: multiple writeups report teams
consolidating back onto pgvector because operating a second datastore (sync pipeline,
consistency, another bill) outweighed raw QPS wins at sub-10M scale.

## 3. Cosine in application code (our current design)

- In-memory brute force holds up longer than assumed: 73k chunks searched in under 0.1 s with
  plain NumPy; under ~100k vectors brute force is fast enough.
  [TDS: You probably don't need a vector database yet, 2026-01-20](https://towardsdatascience.com/you-probably-dont-need-a-vector-database-for-your-rag-yet/)
- What breaks first is not the math, it is the fetch: pulling every row's vector over the wire
  per query dominates long before the dot products do.
- The standard migration path is NOT an ANN library in Node. It is: push the cosine into
  Postgres (`ORDER BY embedding <=> $1 LIMIT k`, exact scan, no index, 100% recall), then add
  an HNSW index when latency shows up. IVFFlat is legacy; HNSW is the default choice and safe
  to build on a growing table. [Supabase vector indexes](https://supabase.com/docs/guides/ai/vector-indexes)

## 4. Hybrid search storage (keyword arm)

- Postgres `ts_rank` is not BM25 (no IDF), which is exactly the gap our app-side IDF-weighted
  keyword arm papers over. Real BM25 in Postgres exists (ParadeDB pg_search, TigerData
  pg_textsearch) but neither is available on Supabase.
  [Tiger Data pg_textsearch](https://www.tigerdata.com/blog/introducing-pg_textsearch-true-bm25-ranking-hybrid-retrieval-postgres)
- RRF over tsvector + pgvector in ~100 lines of SQL is a documented, common pattern.
  [ParadeDB: Hybrid Search in PostgreSQL, the Missing Manual](https://www.paradedb.com/blog/hybrid-search-in-postgresql-the-missing-manual)
- Hebrew caveat: Postgres ships no Hebrew text-search config, and Hebrew morphology makes
  tsvector recall poor. The community fix is pg_hspell (hspell lemmatizer), not available on
  Supabase. `to_tsvector('simple', ...)` plus our own prefix stripping is roughly the ceiling
  of Hebrew lexical search in stock Supabase. Our cross-language gists compensate from the
  semantic side. [pg_hspell](https://github.com/vbukstein/pg_hspell)

## 5. Multitenancy and department permissions at the storage layer

- Standard pattern: tenant/branch/role columns + Postgres RLS keyed off a session variable.
  Hard isolation at the DB layer, pgvector unchanged.
  [Multi-tenant RAG with pgvector RLS](https://kawshik.dev/blog/multi-tenant-rag-pgvector-postgres-rls.html),
  [thenile.dev](https://www.thenile.dev/blog/multi-tenant-rag)
- Watch the interaction: selective filters + HNSW = the filtered-recall problem above.
  Mitigations in order: 0.8.0 iterative scans, a b-tree index on the filter column BESIDE the
  HNSW index (pgvector recommends against multicolumn HNSW), partial per-tenant HNSW indexes
  if one tenant dominates.
- At our scale the client's department-permission requirement is a metadata-filter problem,
  not a storage-engine problem: a `department` / `branch_id` / `visible_to_roles` column in
  the WHERE clause (or RLS) is the whole implementation.

## The ladder: 100 / 1k / 10k / 100k chunks

- **~100 chunks (today):** Node-side cosine is nowhere near a bottleneck. Nothing about the
  current design is wrong at this size.
- **~1k chunks:** The full-table fetch becomes the dominant term (~4 MB per query at 1024
  dims). Cheap standard move: exact search in SQL (`<=>`, no index), transfer drops to k
  rows, recall stays 100%.
- **~10k chunks (our realistic ceiling):** Earliest point an HNSW index (halfvec, cosine) is
  worth building, for latency headroom, not because anything breaks. Turn on
  `hnsw.iterative_scan = relaxed_order` so branch/department filters do not starve recall.
- **~100k chunks:** Node-side full-fetch is definitively dead (~400 MB moved or held per
  process). HNSW mandatory and entirely comfortable, still 50x below pgvector's documented
  strain point. Hebrew lexical search is the weakest link at this size.

## Decision

Stay on Supabase Postgres. The only storage migration this system should ever need is:
Node-side cosine → in-SQL exact `<=>` → HNSW halfvec index. Each step is roughly a one-day
change, and RLS/WHERE filtering covers the department-permissions acceptance test throughout.
