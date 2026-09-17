# Assistant research: what exists, and what is built

Written 2026-09-17. This is the index to the research and the running answer to "what is done and
what is not". `03-roadmap.md` says what should be built and in what order; this file says what
actually is, checked against the code rather than from memory.

**Keeping it true:** when a PR merges, move its rows from "built, waiting" to "live" here and in
the roadmap. A row that says "done" and is not is worse than no row at all, so verify before
ticking: every claim below was confirmed with a search against the committed code on the date in
the heading, not from a commit message.

---

## 1. The research itself

Four files, all in `docs/assistant-research/`, committed 2026-09-17 (PR #390). Before that they
existed untracked on one laptop only.

| File | What it holds | How it was made |
|---|---|---|
| `01-best-practices.md` | The outside-in scorecard: 13 lenses over the assistant layer, about 269 sources, one merged top-gaps list. Includes a "Corrections after pass two" section. | Two research passes, 44 agents. Pass two ran a completeness critic against pass one. |
| `02-implementation-audit.md` | 17 confirmed findings against our real code, ranked by severity, each reproduced by executing the actual functions. Plus a "Refuted" section and a list of low-severity claims that were never verified. | 7 read-only audits in two passes, against the worktree at `dbf2f44`. |
| `03-roadmap.md` | The ordered work list, groups (a) to (e). Every item points back to a finding id or a scorecard row. | Derived from the two files above. |
| `04-status.md` | This file. | Verified against committed code. |

The older RAG research (`docs/rag-research/`, 8 files, 2026-08-17) is the audit that produced the
pgvector and Hebrew retrieval work. Same commit.

**How much to trust each claim.** The research does not present itself as uniformly solid, and
neither should anyone quoting it:

- **20 findings went to an adversarial skeptic** whose job was to refute them. None was refuted,
  but the skeptics corrected 7 claims inside them. Those corrections are recorded so nobody
  re-finds the wrong version.
- **A longer low-severity list never went to the skeptic at all.** Those are one auditor's word.
- **A large share of the roadmap is not a defect at all**, it is a scorecard row: something the
  2026 consensus does that we do not. Streaming, the feedback buttons and the company facts sheet
  are all of this kind. They are improvements, not bugs.

The most consequential correction pass two made: the two-search cap is **not** quality-neutral
(measured accuracy climbs from 35.8% to 89.0% between 1 and 25 search turns), and the routed model
`google/gemini-3-pro-preview` has a published shutdown date with no cutover plan.

---

## 2. Size of the job

| Group | What it is | Items |
|---|---|---|
| (a) | Website mirror: burgersbar.co.il into the knowledge base | 11 |
| (b) | Evaluation rewrite | 16 |
| (c) | Hardening, four batches | 43 |
| (d) | Later: streaming, resumable answers, claim-level checking | 9 |
| **Total engineering** | | **79** |
| (e) | Needs a person, not code | 15 |

Roughly **22 items are fully built and 10 are partly built.** The rest is open.

---

## 3. Live in production now

All of this is merged, deployed and serving real staff.

**The assistant itself** (PR #382, #383, 2026-09-15)
- The tool loop: the model asks for what it needs, round by round, under a cap on rounds, time and
  paid searches
- Six read-only tools: documents, my tasks, branches, projects, people, WhatsApp summaries
- Every source shown under an answer is built by the server from what actually ran, so the model
  cannot invent a source
- Each person's reach is decided inside the database query from their session, never by the prompt

**Web search** (PR #386, 2026-09-16)
- The broker's search offered beside the tools, capped at two per answer
- Web results come back as linked chips, typed differently from document chips

**Honesty hardening** (PR #387, 2026-09-16) — closed 12 of the 17 audit findings
- The prompt names where the model's own knowledge ends and orders it to search before answering
  anything that can have changed
- An answer drawn only from general knowledge is labelled as such
- Web citations are kept across every round, not just the last one, so a page found mid-search
  still reaches the reader
- A capped answer says so instead of reading as complete
- The web search is withheld once a tool has returned people or their words, so nothing personal
  can ride into a search query
- Hebrew text direction resolved per block
- People search now understands Hebrew prefixes and vowel marks
- Deactivated and invited accounts no longer read as current staff; work email only on request

---

## 4. Built, tested, waiting for approval

Nothing here is live. Both have green CI.

**PR #388, the evaluation rewrite** (closes 9 of group (b)'s 16 items)

Until this, the test harness drove the one-shot prompt the product retired on 2026-09-15. Every
number it produced described a system nobody was running. That is finding EO-2, and it is why a
stale VAT rate reached production with a green eval behind it.

- Stage two now drives the real assistant: real prompt, real tools, real web search, under each
  question's own role
- Three-way grading, right/wrong/declined, a wrong answer costing twice a decline
- Two new question sets: 38 routing questions graded on **where** the answer came from, and 30
  Israeli work facts where the pass condition is that it searched, not what number it said
- Free checks needing no paid grading: claimed a lookup it never made, cited a document that does
  not exist, Hebrew surface problems
- **A cross-role suite** asking the same question as five different people, proving a branch
  manager cannot reach another branch's rent or a colleague's email. This is the evidence the
  client CEO's written department-permission requirement has never had.
- **A real security hole closed:** a Drive document could write a fake end marker and make
  everything after it read as instructions rather than data.

**PR #389, reliability and cost** (closes 4 of batch 3's 12 items)
- One retry when the provider has a bad moment. Not hypothetical: a test run lost an answer to a
  504 with no second try.
- The 40-second budget is now a real bound on each call, not a guess checked beforehand. A stuck
  lookup fails after 15 seconds instead of holding the answer open.
- The same lookup asked twice is no longer paid for twice; a round asking for 20 lookups runs 8.
- Migration 0048 records cost, cached tokens, reasoning tokens, searches and a count of invented
  citations. All nullable on purpose: a provider reporting nothing is not a free answer.
- The log records the model the provider actually served, not the id we asked for.

---

## 5. Not built, in the order I would do it

**Known problems in the live bot**

| What | Why it matters | Size |
|---|---|---|
| Web links point at a Google redirect address, not the real site | A reader cannot tell where an answer came from. **Confirmed 2026-09-16**, previously unverified (F5) | M |
| No date or host on a web chip | A rate with no date reads as timeless, and none of them are | M |
| No backup model | If Google has a bad hour every question fails, with no fallback and no alert | S, needs a decision |
| No spend alert | Nothing notices an expensive hour. Needs PR #389's columns first | S |
| Documents carry no date, owner or verified state | A 2024 price list answers as confidently as this year's, and in fact ranks above it | M |
| Nothing enforces per-role tool access | A driver is offered the WhatsApp summaries in the prompt | M |
| Zero-data-retention flags not sent to the provider | Plus one paid check that the model still routes with them on | S |

**Robustness at the edge** (batch 3 remainder)
- Rate limit per person, so one account cannot send 500 questions
- Retry safety, so a dropped phone does not pay for the same answer twice
- Finish running answers on deploy instead of killing them mid-sentence
- An assistant health check that does not restart the API because Google is slow
- Model parameters and cache-friendly prompt order. **Both need a measured run before changing
  anything**, which is what PR #388 exists to provide.

**Quality and language** (batch 4 remainder)
- Thumbs up and down under each answer, stored, so we learn from the people using it
- A persist-time check that flags a table or a raw link, which the prompt asks for but nothing
  enforces
- Model-written thread titles instead of the first 80 characters
- A company facts sheet, about 25 lines owned by head office
- Sensitive-topics rules: never rate a colleague; route pay, health and discipline to HR
- The persona pass: no emoji, no flattery, correct Hebrew gender for the assistant and the reader
- Accept the Hebrew word for "sources" in the trailer, and tolerate decoration around it
- Screen-reader labels on source chips
- The Hebrew store-listing text, which still does not match the English

**The website mirror** (group (a), 11 items, none started)
burgersbar.co.il into the knowledge base: branch hours, menu and kashrut served from typed tables
rather than prose, a crawler that only refetches changed pages, duplicate linking, and a conflicts
table so a contradiction becomes a data fix instead of a recurring hedge.

**Later** (group (d), 9 items, none started)
Streaming the answer as it is written, resumable answers when the phone locks, inline numbered
citations, a claim-level fact check, rolling thread summaries, single-page fetch, and an ops
dashboard over the answer log.

---

## 6. Needs a person, not code

These block engineering items and none of them can be decided by writing code.

1. **May a branch admin read chain-wide lease and franchise terms?** About 46 accounts. Set
   deliberately in the 18-role commit, so this is a policy question, not a bug. The test suite in
   PR #388 pins today's answer with the question written beside it.
2. **Which backup model** when Google has a bad hour. Flash tiers were rejected as a downgrade.
3. **Approval of the WhatsApp purpose statement**, the in-group notice and the opt-out.
4. **Two small paid checks:** do the zero-data-retention flags still route, and do the search caps
   bind on Google's engine.
5. **From head office:** a document owner per knowledge folder, plus the registered business name
   and contact email. The last two are placeholders on the privacy page and **block both app store
   listings today.**

Also outstanding: eleven test conversations left on the live system from the 2026-09-16 battery,
awaiting the word to delete.

---

## 7. What has actually been tested

Stated plainly, because "tested" has meant three different things this week.

| When | What ran | Cost | Result |
|---|---|---|---|
| 2026-09-16 | 10 questions against live production | ~$0.18 | App questions good, trick question correctly refused. **VAT answered stale from memory with no search**, which is what forced the honesty work. |
| 2026-09-16 | Localhost after the honesty fixes | a few cents | VAT correct at 18% with web sources |
| 2026-09-16 | 2 questions through the rewritten harness | ~$0.04 | Correct, searched the web, cited two pages, no invented citation. The English twin died on a provider 504. |

**Not yet run:** the full 38-question routing set and the 30-question freshness set. They are
built but have never been executed at scale. A full pass costs roughly a dollar or two and is the
first thing worth doing once PR #388 merges.

**Two quality problems seen in production that no test yet covers at scale:** an answer that said
18% and then did the arithmetic at 17%, and prose that named one website while the chip cited
another. Both are the model being sloppy rather than bugs in our code, and both are what the new
evaluation exists to catch.
