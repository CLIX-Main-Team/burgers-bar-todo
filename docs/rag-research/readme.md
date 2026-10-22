# rag-research: retrieval for a Hebrew and English corpus

Research pass run 2026-08-17 on what enterprise-grade retrieval looks like in 2026 and what that
meant for the assistant's knowledge base. The conclusions shipped in ADR-0025 (chunked embedding
retrieval with hybrid search); the assistant layer above retrieval has its own folder,
`docs/assistant-research/`.

- 00-overview.md: the question asked and the summary of the answer. Start here.
- 01-vector-storage.md: vector storage and search at scale.
- 02-embeddings-hebrew.md: embedding models and rerankers for Hebrew and English.
- 03-retrieval-pipeline.md: chunking, hybrid search, reranking, evaluation.
- 04-enterprise-operations.md: ingestion, permissions, audit, cost guards, observability.
- 05-requirements.md: what the system must satisfy, from the client's own checklist.
- 06-target-architecture.md: the synthesis and the build order.
- 07-implementation-audit.md: the code against the research, finding by finding.
