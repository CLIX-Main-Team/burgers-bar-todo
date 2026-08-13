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
anchored to its topic while a topic switch still wins through the bare variant. Selection carries
**no absolute gate** (see the addendum: the measured landscape overlaps, so the model's grounded
honesty decides borderline cases); a junk floor cuts outright noise, survivors are trimmed to a
top-relative band and capped by count and budget, and the result is rendered grouped per doc under
the exact `## title` heading the SOURCES trailer (#227) resolves citations against.

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
- Revisit (the 10× corpus): move ranking to pgvector on the existing Supabase. It slots behind
  `retrieval.ts` without moving the seams — as the hybrid keyword+vector fusion this line also
  anticipated did, in the third addendum below.

## Addendum (2026-08-13): no gate, the language bridge, and the absence rules

Two rounds of field measurement against the client's real production questions revised the
selection rules; the seams above are unmoved.

**The gate is gone.** The original top-score gate (< 0.5 → ground nothing) hard-declined the
client's terse "מהו נוהל הפתיחה?", which tops at **0.414** with the right doc at 0.409, while an
English greeting's best *noise* chunk reaches **0.451** — the measured landscape overlaps, so no
absolute threshold admits the covered-but-terse question and blocks the greeting. Retrieval now
always hands the model the best few candidates (junk floor 0.35, top-band 0.12) and the guardrail's
answer-only-from-the-material honesty decides — live-verified: greetings recite nothing, off-topic
still declines, the terse question answers.

**The language bridge** (`chunk-index.ts`). A 44-answer faithfulness audit of the deployed bot
found every unfaithful answer was a *false absence claim*, and the worst pair traced to a retrieval
dead zone: the corpus's few **English** SOPs score 0.19–0.28 against **Hebrew** questions — beneath
any workable floor — so no tuning could ever surface them (the sister Clix RAG measured the same
~0.29 cross-lingual wall). Borrowing its document-side fix: a Latin-dominant chunk gets a short
**Hebrew gist**, generated once at index time by the same LLM port the categorizer uses, and is
embedded as title + gist **only** — a mixed-language embed text dilutes both directions, while a
Hebrew embed text matches Hebrew questions natively and English questions through the strong EN→HE
direction (measured 0.55–0.70). The stored content the model reads and cites stays the original
English. Gist generation is best-effort exactly like embedding (a failure stops the pass; the next
one retries), is wired only when embeddings are live, and its token budget must clear a thinking
model's reasoning overrun (#263 — 400 and 1,000 both starved it; it ships at 3,000). Migration
0011 nulls every stored embedding so the backfill regenerates the index under the bridge scheme.

**Wider selection, measured.** The audit's English case ranked the substantive SOP chunk 11th —
outside the 8-chunk cap — so the model declared absent what retrieval had merely cropped. The cap
is now **12** and the budget **~4k tokens**, the smallest widening that admits the measured miss.

**The absence rules** (grounding.ts). The model sees a retrieved slice yet phrased misses as
corpus-wide facts ("a daily opening procedure is not in my materials"). The guardrail now forbids
asserting that something *does not exist* or *is not written* — it may only say it did not find it
in the material it has right now, phrased for the question — and counter-pressures the opposite
failure: a question the excerpts do answer gets answered, never deflected.

## Addendum (2026-08-13): hybrid retrieval — a keyword arm fused with the vector ranking

A 21-question graded exam against the deployed bot — gold keys drawn from the corpus, plus eight
questions the corpus deliberately cannot answer — returned zero invented facts and eight honest
declines out of eight traps, and exactly one **false decline**: *"מתי מכניסים תזכורות ליומן על סיום
חוזה שכירות?"*. The rule is written down (`צק ליסט פתיחת סניף.docx`: "הכנסת תזכורות ליומן לתאריכי
סיום הסכם- 3 חודשים לפני סיום, חודשיים לפני וחודש לפני"), but it lives in the branch-**opening**
checklist while every word of the question points at the lease dashboards. Cosine ranked twelve
rentals chunks above it and the model honestly reported not finding the rule. Embeddings retrieve
by topic; this question needed retrieval by *wording*, which no similarity threshold recovers.

So the ranking is now two arms fused by **Reciprocal Rank Fusion**, the shape the sister Clix RAG
uses (`hybrid_search`: `Σ 1/(k + rank)`, `k = 50`, per-arm caps, full outer join):

- **rank, never score, crosses between arms.** Cosine similarity and word overlap are not on a
  comparable scale, and every scheme for making them comparable needs a per-corpus constant that
  drifts. `k = 50` damps the head, so a chunk *both* arms rank beats a chunk either arm ranks first.
- **the keyword arm ranks by rare-word overlap, not by match count.** Counting ties the lease
  dashboards (שכירות + סיום + חוזה) with the checklist that holds the answer (תזכורות + ליומן +
  סיום). Weighting each matched word by its inverse document frequency across the index breaks the
  tie on evidence: in the 2026-08 corpus ליומן appears in one document of 37 and שכירות in nine.
- **Hebrew prefixes are stripped from long tokens** (ה/ו/ב/ל/מ/כ/ש) on both sides. Left alone,
  השכירות reads as a one-in-a-corpus rare term while the word itself sits in a third of the index,
  and chunks match on an accident of grammar — measured: dropping the prefix removed the
  flight-booking and car-insurance checklists from a lease question's grounding.
- **the keyword arm may claim at most half the grounding** (`KEYWORD_ARM_LIMIT` = 6 of 12). It is
  the lower-precision signal, so fusion may broaden a vector result by up to half, never displace
  it — the six best cosine hits keep their seats whatever the words say.
- **it never *creates* a result.** When nothing clears the relevance floor the question is small
  talk or off-topic, and a stray word match must not manufacture grounding the semantic signal
  refused; the keyword arm runs only when the vector arm returned something. Keyword mode (no
  embeddings at all) is unchanged: that same ranking, standing alone, with the full cap.

Measured on the 21-probe battery over the live index: the failing question now retrieves the
checklist (keyword rank 2, invisible to cosine) and answers the 3/2/1-month rule with a citation;
greetings and off-topic still retrieve nothing or decline; every covered probe keeps its top-ranked
source document. The probe report prints each chunk's provenance (`cos 0.548 + kw #2`), so the next
tuning pass reads which arm earned a seat rather than guessing.

## Addendum (2026-08-13): the bridge runs both ways — a keyword arm that survives translation

A flip test measured the cost of the arm above being monolingual. All 55 graded questions were
re-asked in the opposite language against the same deployed build — same gold keys, so language was
the only variable — and 51 of 55 answered identically, 16 of 16 traps stayed honest declines, and
every answer came back in the language it was asked in. The exception was one question, in both of
its phrasings: **the lease-reminder rule, which the keyword arm had just fixed in Hebrew, failed
again in English.** The cause is structural rather than a tuning miss — the keyword arm matches
word forms, an English question shares no characters with a Hebrew document, so for a cross-language
question the lexical half of the ranking silently switches off and only cosine runs. Cosine is the
arm that missed this question in the first place.

So the bridge, which until now ran one way for one purpose, runs **both ways for two**:

- every chunk is restated once at index time in the OTHER language — Hebrew for a Latin-dominant
  chunk, English for a Hebrew one — and stored on the chunk as `gist`;
- **embedding** is unchanged: only a Latin-dominant chunk embeds through its gist, because a Hebrew
  chunk already embeds well in both directions and a mixed-language embed text dilutes both;
- **the keyword arm** now matches against title + content + gist, in both directions, which is what
  gives it any cross-language reach at all. The English gist also spells names as an English speaker
  would type them, so "Ahmad Dirbat" can reach אחמד דירבת lexically.

The cost is one completion per chunk at index time (previously only for the few Latin chunks) and
one nullable text column. It is paid once per chunk and again only when a doc changes, since
`upsertDoc` clears a doc's chunks on every write and the pass rebuilds gist and vector together —
so every future document is bridged automatically by the same seam, with no backfill step.

**The queue claims gist-less chunks rather than nulling vectors to schedule them.** Migration 0011
scheduled its re-embed by setting every embedding to NULL, which blinds the vector arm until the
pass finishes. Here the work queue is "no embedding **or** no gist", so an already-indexed corpus
keeps its vectors and answers at full strength while the gists fill in behind it. The widened queue
is conditional on an LLM being wired — without one, gist-less chunks would re-queue forever.
