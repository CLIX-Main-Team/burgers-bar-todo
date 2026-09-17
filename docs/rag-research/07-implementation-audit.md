# Implementation audit: our code vs the research

Run 2026-08-17 by a 15-agent workflow: one mapping agent, seven dimension auditors
(ingestion/sync, chunking/tables, retrieval/fusion, embedding/storage, generation/grounding,
efficiency/cost, robustness/Hebrew), and an adversarial verifier per dimension that re-read
every cited line and executed the disputed functions. 52 raw findings; what follows is only
what survived verification, deduplicated. Every claim below carries file:line evidence in the
workflow transcript; severities are the verifier's, not the auditor's.

## The three answers

**Are we following best practices?** The core is genuinely conformant, and the verifier
confirmed it line by line: true sum-of-reciprocals RRF (no fusion bug), best-variant-wins
merge inside the vector arm, per-document interleaving, soft gates, exactly one embedding
call and one chat call per answer, no HyDE, plain code. The gaps are not in the algorithms.
They are concentrated in silent failure handling: the system has many ways to degrade or die
without logging anything.

**Are we doing something inefficient?** The per-question path is lean. The waste lives in
ingestion (re-buying gists and embeddings for unchanged content), in thread history, and in
one systematic accounting error: every token budget assumes 4 chars/token, which is English
math. Hebrew runs ~2-2.5, so our "450-token" chunks are really ~700-900 tokens and the
"4,000-token" grounding block is really ~7-8k. Nothing is broken by this, but every cost and
tuning number in the design is roughly 2x off for the primary language.

**Did we overlook something?** Yes. Three high-severity findings, none of which were in the
research roadmap, plus one reproduced-by-execution Hebrew retrieval bug.

## High severity (3)

1. **One unreadable file permanently freezes all knowledge sync.**
   `runIncremental` applies Drive changes with no per-change error containment
   (knowledge-sync.ts:163-181); extraction throws deterministically on encrypted PDFs,
   corrupt DOCX, non-workbook XLSX. The change replays and throws on every 20-minute pass
   forever, the cursor never advances, `/assistant/resync` 500s, and the only signal is a
   Render console line. One manager uploading one password-protected PDF silently freezes
   the corpus chain-wide. The full-load branch has the per-doc try/catch the incremental
   branch lacks, so this is an inconsistency, not a design position. Fix nuance from the
   verifier: route deterministic extraction failures into the existing skipped-row mechanism;
   do not blanket catch-and-continue, which would lose transiently-failed changes forever.

2. **Ghost docs are still possible: full load never purges absentees.**
   The 2026-08 incident (deleted SOPs kept answering) was fixed by manual DB deletes only.
   `runFullLoad` (knowledge-sync.ts:132-156) never diffs the Drive listing against
   `knowledge_docs`, and the repository has no bulk purge operation at all. This bites
   exactly on the recovery path: hand-clearing the cursor (the only recovery for finding 3
   below) resurrects every file deleted while no cursor existed. With lease and HR content
   in the corpus this is a data-exposure class, not staleness.

3. **A one-env-var change silently poisons every vector and blacks out grounding.**
   No column records which model produced a stored vector; the backfill queue only claims
   NULL embeddings; env.ts:98-102 advertises `ASSISTANT_EMBEDDING_MODEL` as a safe one-line
   swap, and flipping `ASSISTANT_PROVIDER` silently drags the embedding model with it. After
   a swap, queries embed in the new space, stored vectors stay in the old, both presets emit
   1024 dims so nothing detects it, and cross-space cosine is garbage. The amplifier: when
   the poisoned vector arm returns nothing, retrieval.ts:343-346 gates the keyword arm OFF,
   so the fallback meant to absorb embedding trouble is disabled in exactly this failure
   mode. Result: false "not in my documents" on every question, zero errors logged.
   Migration 0011 exists because this class of change already happened once.

## The recurring amplifier (one line of code)

`retrieval.ts:343-346`: in hybrid mode, an empty vector arm disables the keyword arm
entirely, on the assumption that empty = small talk. That assumption fails during partial
embed windows (new docs awaiting gists, a failed pass with 20 minutes to the retry, any
full re-embed: 0011 took ~8 minutes in prod), under vector poisoning (above), and for
covered questions whose best cosine lands under the 0.35 floor. The module's own comment
promises unembedded chunks "can still arrive through the keyword arm"; the gate contradicts
it precisely when it matters. This one line converts a half-dozen "degraded" states in this
audit into "total blackout with a confident decline". Cheapest single high-leverage fix in
the report.

## Verified retrieval-quality bugs (medium)

- **Hebrew prefix stripping is non-canonical; prefixed and bare forms never match.**
  Reproduced by executing the exact code: השכירות strips to שכירות but bare שכירות strips
  to כירות; במשמרת/משמרת and המטבח/מטבח likewise diverge, and מטבח collides with the
  unrelated טבח. Any word whose first root letter is ה/ו/ב/ל/מ/כ/ש (a huge share of
  everyday nouns) fails to match across prefixation. The keyword arm, which exists to rescue
  vector misses (the lease saga), silently fails for the most common vocabulary class. Tests
  never catch it because every test uses the same surface form on both sides. Fix: index
  both stripped and unstripped forms, match on either.
- **Niqqud destroys words entirely.** keywordsOf('מְנַהֵל') returns [] (executed): niqqud
  marks are category Mn, the tokenizer splits on them, fragments fail the length filter. RLM
  marks make words vanish too. Latent (typed Google Docs rarely carry niqqud), silent when it
  fires. One normalize step (NFC + strip U+0591-U+05C7 + bidi chars) fixes it.
- **isLatinDominant misclassifies data chunks, dropping the body from the vector.**
  Executed: a lease-dashboard row of Hebrew values under English keys counts Latin-dominant,
  so the Hebrew gist REPLACES the body in the embedded text; sibling chunks of one dashboard
  embed as near-identical title+gist vectors, and per-row lookups ride the keyword arm alone.
  Plausible contributor to the remaining cross-topic partials.
- **Table continuation chunks lose headers, and the gist bridge amplifies it.** Chunks 2..N
  of a sheet are bare CSV rows with no header and no sheet marker (the known Phase 2 item),
  but three consequences were new: gists for headerless chunks summarize UNLABELED values,
  so the cross-language index entry is built on guessed column semantics; selection can skip
  header-carrying chunk 0 while admitting continuations; HTML tables lose column boundaries
  entirely (</td> becomes a space). The 14 lease row-group clones were this fingerprint.
- **Follow-up decay at hop 3.** The variant carries exactly one previous user turn, so two
  content-free follow-ups in a row ("ומה אחרי זה?" then "ואז?") leave no topic words, the
  vector arm empties, the gate kills the keyword arm, grounding is empty. Hop 2 is
  field-validated; the battery's follow-ups are all single-hop so this was never exercised.
  (The keyword arm also never sees the conversational variant at all, in any mode.)
- **Token budgets are English-calibrated** (see "three answers" above): chunks ~2x the
  cited consensus band, grounding block ~2x its budget, the #263 starvation margin ~2x
  closer than the comments claim. Budgets should mean what their names say.

## Verified silent-failure traps (medium)

- **20,000-char ingest cap truncates silently**, mid-word, XLSX sheets joined BEFORE the
  cap so trailing sheets vanish whole (append-style sheets lose the NEWEST rows). No marker,
  no flag, no log; admin sees "ingested". The verifier found the cap's justifying comment is
  stale: since chunked grounding (ADR-0025) the cap protects nothing; it is pure data loss.
  The corpus plausibly already has a doc near the cap (the 14-chunk table doc implies ~25k).
- **Expired Drive cursor has no recovery path.** driveFetch throws generically; a 410
  pageTokenExpired (weeks of downtime, exactly what a billing suspension causes) makes every
  reconcile throw forever; only recovery is hand-deleting drive_sync_state, which triggers
  the purge-less full load of high-finding 2.
- **Doc edits are destructive-first.** upsertDoc deletes live chunks at reconcile time;
  replacements arrive later (afterReconcile), vectors and gists later still. Every edit
  passes through a zero-chunk window, unbounded under provider failure (during the 402
  outage an edited doc would have stayed invisible until credits returned). The gist
  backfill explicitly refused to null live vectors for exactly this reason; the edit path
  does the opposite. Plus a non-transactional tail: a chunk-delete failure after a doc write
  leaves OLD chunks permanently serving under NEW content.
- **Query-time embedding failure is invisible.** answer-service.ts:105-106 discards the
  error string; no log, no retry (one un-retried HTTP attempt), and the returned mode is
  destructured away. A sustained embedding outage runs the whole assistant in its
  measured-weaker keyword mode indefinitely while looking healthy. Every other failure
  surface in the system logs; this one is actively swallowed.
- **finish_reason=length is a permanent, billed 503 loop.** A question whose faithful answer
  exceeds 4,000 tokens truncates deterministically (temp 0.2), folds to 503, invites an
  identical retry, bills full input each time; the error class is computed and then dropped
  (logger:false). This exact shape hit prod once before the reasoning cap. Also: sending
  max_tokens=4000 maximizes OpenRouter's upfront reservation, so a low wallet 402s earlier
  than usage warrants, the amplifier we measured live during the outage.
- **SOURCES trailer parsing is one brittle startsWith.** '**SOURCES:**' (bold, the one
  field-observed leak), any text after the trailer, or a bolded cited title all fail
  silently: raw trailer shown to the user, chips lost. Aggravator: persisted answers are
  trailer-stripped and replayed as in-context examples that contradict the trailer
  instruction. Related (low): citations resolve against the whole corpus, not the retrieved
  set: the `selected` provenance is discarded one line before it would be needed.
- **PDF ingestion**: text items joined with spaces, pages with single newlines, pdf.js's
  hasEOL discarded, so every PDF is one paragraph and dense pages hit fixed-offset mid-word
  hardSplit; reversed-order (visual) Hebrew PDFs pass the 16-char gate and ingest as
  character-reversed garbage with no flag. Latent (corpus is currently Google Docs); PDF is
  an accepted format and the client authors Hebrew PDFs.
- **Question length is unbounded** (min(1), no max, 1MB body default): one employee can post
  a ~1MB question that is embedded, sent to a pro-tier model, persisted, and replayed. No
  write path in the app bounds length; this one is uniquely cost-exposed.
- **Unpinned embedding provider + unvalidated response dims** (both medium): OpenRouter may
  reroute qwen3 to a different host with different quantization than the one the 0.35/0.12
  thresholds were calibrated on; and nothing checks vector.length === 1024 (cosine returns
  -1 on mismatch, hiding it). Two one-line asserts plus a provider pin.

## Verified efficiency waste

- **No change detection anywhere.** driveModifiedTime is stored and displayed, never
  compared; no content hash. Every Drive event (rename, move, sharing touch) re-downloads,
  re-extracts, wipes chunks, re-buys one gist LLM call per chunk plus embeddings for
  byte-identical content. A folder drag fans out to every doc under it (~70 gist completions
  for a 30-doc folder), and pushes them all through the zero-chunk window. The justifying
  comment predates the gist bridge, when re-chunking was free. Notion's hash-skip measured
  a 70% volume cut; ours is one `IS DISTINCT FROM` away.
- **Paid gists discarded on embed failure.** Up to 32 premium-model completions per batch
  are generated BEFORE the embed call and persisted only together with vectors; an embed
  failure throws them away and the 20-minute backstop re-buys them, ~2,300 completions/day
  during a sustained embed outage. Also head-of-line: one deterministically-failing gist
  chunk (title-ordered queue, no attempt column) stalls all indexing behind it forever. The
  verifier adds: a model REFUSAL with finish_reason=stop would be stored as a garbage gist,
  silently.
- **Index work rides the premium answer model** (gists, categorizer on the pro model;
  ~5-25x flash pricing). Verifier sized it honestly: single-digit dollars/month today, and a
  swap needs a measured battery run since gist quality drives cross-lingual retrieval. Low
  now, grows with corpus and edit rate.
- **Thread history: no LIMIT, fetched twice per answer, replayed with no token budget** (the
  only unbudgeted prompt block; grounding and tasks are budgeted). With auto-reopen (#300)
  one thread grows indefinitely; realistic overhead ~1.5x per answer today, quadratic
  cumulative response traffic. Cap the read, budget the replay.
- **Per-question corpus fetch is ~3x the research's math** because jsonb text-serializes
  floats (~10-12KB/vector vs 4KB binary): ~1MB per message today (fine), but the research
  ladder's "wall at ~1k chunks" actually arrives at ~300-400. An in-process cache
  invalidated in afterReconcile removes the term for an hour's work.
- Smaller confirmed: three independent awaits run sequentially (~50-200ms free via
  Promise.all); Knowledge tab fetches full 20k-char contents it deliberately discards;
  setChunkEmbeddings is 90 sequential UPDATEs; task read selects unrendered columns and
  done tasks eat the 2k budget.

## Verified hygiene (low)

Zero chunk overlap vs the 10-20% consensus (mitigated by paragraph edges + adjacent-chunk
splicing; superseded when parent-child lands). Heading paragraphs orphan into runt chunks
before oversized sections. Gists stored unvalidated (for Latin chunks the gist IS the
vector; a bad one is never revisited). IDF counts chunks not documents, so title words of
multi-chunk docs are undervalued (same family as the rank-17 lease incident). Cross-arm RRF
ties resolve by doc-title alphabet (deterministic but arbitrary; fix with the reranker).
RRF k=50 vs the k=60 standard (immaterial); the real first-stage limiter is the 0.12 band,
which must widen when the reranker lands. Sync single-flight is per-process only (deploy
overlap can interleave; verifier found a stale-chunk interleaving, still low at one
instance). Full-load per-doc failures leave NO row and never retry (invisible even in the
Knowledge tab). No content-hash dedup (subfolder-copies incident was this). pgvector is not
even enabled as an extension and vectors are untyped jsonb, so the research's "one-day SQL
flip" understates the Phase 3 step (extension + column conversion + Drizzle type). Web
assistant catch-all treats 401 as retryable (retry can never succeed; no re-login hint).
Language-of-answer is prompt-only (currently holding 55/55; add a script-ratio assert to the
probe battery). Keyword mode (embedding outage / groq) never sees the conversational
variant, so follow-ups break in degraded mode.

## What this does to the roadmap

Phase 1 of 06-target-architecture.md stands, but this audit reorders the quality work: the
three highs plus the keyword-arm gate and the Hebrew prefix fix are cheaper than the
reranker and should land before it (most are hours each; the reranker assumes the arms
beneath it are sound). The efficiency items (change detection, gist persistence, history
budget) are each about a day and pay for themselves in provider spend and outage behavior.
Nothing found contradicts the no-rebuild verdict; everything found is additive hardening of
the consensus-shaped skeleton, which is exactly what the research predicted the gap would
look like.
