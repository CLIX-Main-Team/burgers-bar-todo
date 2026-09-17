# Requirements for the RAG rebuild

What the system must satisfy, gathered from three sources: the client's own checklist PDF
(`checklist_maarechet_nihul_AI.pdf`, their CEO-level control document, Hebrew, v1.0), and two
practitioner writeups on enterprise RAG (Reddit, builders with 10K-50K doc deployments).
Everything else in this folder is research; this file is the yardstick the final architecture
gets scored against.

## Hard requirements from the client checklist

1. **Department-scoped permissions, tested.** HQ (Liat + Israel) sees everything. Each of the
   six departments (מנהלה, שיווק, תפעול, רכש, מוקד, שירות לקוחות, later כספים) sees only its
   own content. Franchisees are separate legal entities with their own layer. Phase 2.10 makes
   "verify one department cannot see another" a written acceptance test.
   Consequence: every chunk carries department / branch / audience metadata and retrieval
   filters on it at query time. A storage engine that cannot filter cheaply is disqualified.

2. **Two parallel repositories.** HQ management and branch management, each holding a
   procedures repository plus checklists derived from those procedures. Shared projects
   (branch opening, upgrades, menu) live under מנהלה, personal ones (food safety) under their
   own department.

3. **Procedure versioning with derivation links.** When a procedure changes, its derived
   checklists must follow. The corpus is not a flat pile of chunks: documents have identity,
   versions, and cross-references. They ask about this directly.

4. **Multiple ingestion sources.** Named in their spec: Claude Team content (no official
   export API exists, this is a real bottleneck to raise with them), Outlook reminders to a
   calendar and dedicated mailbox, and a WhatsApp-groups agent with a human approval step
   (official Business API / bot / form, never group scraping, which violates WhatsApp ToS).
   Google Drive stays as the current source. Consequence: the ingestion pipeline is
   source-agnostic, not Drive-shaped.

5. **Staging environment separate from live.** Written into their build phase. We currently
   have none.

6. **Audit trail.** Their compliance posture (and the franchise structure) implies logging who
   retrieved what. The law-firm anecdote in the practitioner posts (every retrieval logged
   immutably) is the same requirement at higher intensity.

7. **Bilingual, Hebrew-first.** Queries arrive in Hebrew and English, documents exist in both,
   answers must come back in the language asked. Cross-language retrieval (Hebrew question,
   English document) is a proven failure mode we already had to fix once.

## Scale target

- Today: ~40 documents, ~90 chunks. Toy scale, any design works.
- Design target: low thousands of documents, tens of thousands of chunks. This is the honest
  ceiling for a restaurant chain's procedures, checklists, and project docs. We are NOT
  designing for 100K+ chunks, and should not pay the complexity tax for it, but nothing we
  choose should hit a wall before ~100K chunks.

## Lessons to design in, from the practitioner posts

1. **Document quality scoring before processing.** Enterprise documents are garbage at scale:
   scans, OCR artifacts, duplicates with format drift. Score each document at ingestion and
   route it (clean → full pipeline, decent → chunk with cleanup, garbage → fixed chunks +
   manual-review flag). At 40 clean Google Docs this is irrelevant; the day someone bulk-loads
   twenty years of scanned PDFs it is the whole game.

2. **Metadata beats embeddings.** The highest-ROI layer is a domain metadata schema: document
   type (procedure / checklist / project / contract), department, branch, effective dates,
   language, source system, cross-references. Prefer deterministic extraction (rules, keyword
   lists, source-folder mapping) over LLM extraction where possible; LLM tagging is
   inconsistent. Our knowledge-tab shelf classifier is LLM-based and has already needed a fix.

3. **Hybrid retrieval is mandatory.** Pure semantic search fails 15-20% in specialized
   domains: acronyms, exact-value questions ("the dosage in Table 3"), cross-reference chains.
   Dense + keyword with fusion, plus rule-triggered precision handling for exact-value
   queries. Our RRF + IDF keyword arm already embodies this; keep the pattern whatever the
   engine.

4. **Tables are first-class.** Both posts flag tabular content as the hidden nightmare and our
   own graded exams agree (the lease-reminders table generated three PRs). Tables get their
   own processing: row-atomic or cell-aware chunking, headers kept attached, and a dual
   representation (structured + prose description) where warranted.

5. **Hierarchical chunking, not fixed-size.** Preserve document structure: document → section
   → paragraph, with paragraph-level (~200-400 tokens) as the default retrieval unit and
   drill-down for precision queries.

6. **Reliability over features.** Queues and backpressure on ingestion, concurrency limits,
   monitoring, and cost guards on the LLM spend. The OpenRouter wallet outage of 2026-08-17
   (account overdrawn, every production-sized request 402ing while small probes passed) is our
   own proof: a RAG system's availability is gated by its weakest external dependency, and we
   had no balance alert.

7. **Evaluation as a standing harness, not a demo.** Gold question sets, regression runs on
   every retrieval change, trap questions for hallucination, faithfulness grading. This is the
   one part of the current system that is genuinely enterprise-grade already (55-question
   bilingual battery, 8 trap questions, graded exams) and it carries over to any rebuild
   unchanged.

## What explicitly does NOT constrain us

- The current implementation. Justin's call, 2026-08-17: the existing system can be changed
  or replaced entirely, from scratch if needed. It competes on equal terms with a rebuild.
- On-prem / air-gapped deployment. The client runs on our hosted stack; data sovereignty
  demands from the pharma/banking world do not bind here (data ownership on contract end is
  an appendix question to answer, not an architecture driver).
- GPU self-hosting and fine-tuning. One small client, API-based inference, no GPU fleet. The
  practitioner posts' Qwen-on-prem economics apply at thousands of daily queries, not ours.
