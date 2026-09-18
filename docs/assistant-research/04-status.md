# Assistant research: what exists, and what is built

Rewritten 2026-09-17 after eight PRs shipped and the two new question sets ran for the first time,
and brought up to date later that day when the second batch of five PRs (#396 to #400) merged.
`03-roadmap.md` says what should be built and in what order; this file says what actually is,
checked against the code rather than from memory.

**Keeping it true:** when a PR merges, move its rows from "built, waiting" to "live" here and in
the roadmap. A row that says "done" and is not is worse than no row at all, so verify before
ticking. Every claim below was confirmed with a search against `origin/main` on the date in this
heading, not from a commit message.

That rule has now caught four false positives on two separate days. Today a search for the spend
alert matched a code comment about the spend alert, a search for a rate limit matched the password
reset limiter, and a search for feedback buttons matched UI toast roles. All three would have been
ticked as done. Search for the implementation, then read what matched.

---

## 1. The research itself

Four files in `docs/assistant-research/`, committed 2026-09-17 (PR #390). Before that they existed
untracked on one laptop only.

| File | What it holds | How it was made |
|---|---|---|
| `01-best-practices.md` | The outside-in scorecard: 13 lenses over the assistant layer, about 269 sources, one merged top-gaps list | Two research passes, 44 agents, pass two ran a completeness critic against pass one |
| `02-implementation-audit.md` | 17 confirmed findings against our real code, each reproduced by executing the actual functions, plus a "Refuted" section | 7 read-only audits in two passes |
| `03-roadmap.md` | The ordered work list, groups (a) to (e), every item pointing back to a finding id | Derived from the two above |
| `04-status.md` | This file | Verified against committed code |

The older RAG research (`docs/rag-research/`, 8 files, 2026-08-17) is the audit that produced the
pgvector and Hebrew retrieval work.

**How much to trust each claim.** 20 findings went to an adversarial skeptic whose job was to
refute them; none was refuted, but 7 were corrected. A longer low-severity list never went to the
skeptic at all and is one auditor's word. A large share of the roadmap is not a defect but a
scorecard row: something the 2026 consensus does that we do not.

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

Roughly **32 items fully built and 8 partly built** after 2026-09-17. The rest is open.

---

## 3. Live in production

Model in production: `google/gemini-3.1-pro-preview`, confirmed by reading the environment variable
inside the running container. Latest deployed commit `83464ae` (2026-09-17, the second batch below).

**The assistant itself** (#382, #383, 2026-09-15)
- The tool loop, under a cap on rounds, time and paid searches
- Six read-only tools: documents, my tasks, branches, projects, people, WhatsApp summaries
- Every source shown is built by the server from what actually ran, so the model cannot invent one
- Each person's reach is decided inside the database query from their session, never by the prompt

**Web search** (#386, 2026-09-16), which only actually worked on one of two providers until #393.

**Honesty hardening** (#387, 2026-09-16), closing 12 of the 17 audit findings.

**Shipped 2026-09-17, eight PRs:**

| PR | What |
|---|---|
| #388 | The evaluation rewrite: real prompt, real tools, three-way grading, two new question sets, a cross-role leakage suite, and a prompt-injection containment fix |
| #389 | Reliability and cost: one retry per answer, real per-call timeouts, duplicate-lookup guard, per-round call cap, migration 0048 recording cost and tokens |
| #390 | The research, committed so it outlives one laptop |
| #391 | Status doc |
| #392 | The gate now refuses to score a battery that did not run |
| #393 | **Web search only worked on one of two providers.** Google AI Studio rejects the built-in search beside our function tools. Production survived on luck and lost an answer whenever routing fell through, which is exactly when the good provider wobbled. Roughly 1 answer in 10 |
| #394 | Stop inventing sources (prompt), a free detector for it, and three grading corrections |
| #395 | Web chips point at the page actually read, not a Google redirect |

**Merged later the same day, five PRs (2026-09-17):**

| PR | What |
|---|---|
| #396 | This status doc, rewritten after the first real evaluation runs |
| #397 | Pin to Vertex only for a model Google actually serves, the prerequisite for a non-Google backup model |
| #398 | The company's public website read live at question time, as a seventh tool: a branch's hours, its kashrut certificate, the menu. Nothing stored, no sync job |
| #399 | The `latinLed` checker no longer flags an English block that quotes a Hebrew term |
| #400 | **The source guard.** The finished answer is checked in our own code: an "according to X" where nothing from X was received sends the draft back once with the reason, and if the rewrite still names it the attribution is cut and a note added. Replayed over 242 saved answers it tripped on exactly the 7 inventions and on nothing else. Fixed in the same PR: the loop never summed cost, cached or reasoning tokens, so migration 0048's three columns were NULL on every row until now |

---

## 4. Measured, not guessed

The first trustworthy baseline, 2026-09-17, both question sets against the live model.

| | Routing (38) | Freshness (30) |
|---|---|---|
| Answered | 38 | 30 |
| Correct | 30 | 30 |
| **Incorrect** | **0** | **0** |
| Route accuracy | 92% | 93% |
| Tool-call F1 | 0.93 | 0.97 |

**Zero wrong answers across 68 live questions in both languages.** Hebrew and English scored within
a few points of each other.

Cost, from the production log and the eval records:
- **A real staff answer costs about 1.9 cents.** 17 real answers since launch, 32 cents in total
- A full 68-question battery costs about $1.50
- Testing is what costs money, not production

**Claude Sonnet 5 was evaluated as a primary model and rejected**, on evidence rather than opinion.
It routes better (100% on both sets) and never skipped a search for a dated fact, but its native
web search pulls about eight times the page text (22,000 input tokens per question against Gemini's
2,800) and **14 of 68 questions timed out on our own 40 second budget.** Asking for fewer search
results made the payload larger, not smaller, so the volume is outside our control. Sonnet remains
the right choice for the backup model, where slower and dearer beats absent.

A caveat on the retrieval numbers: the eval runs against a local database with 4 users, 2 tasks and
129 chunks. Several declines are that thin corpus, not the assistant. A clean retrieval figure needs
a production-like corpus.

---

## 5. Known bugs, live today

| Bug | Severity | State |
|---|---|---|
| **States a dated figure without searching, and names a source it never fetched.** Three cases in the question sets, both languages, every figure right. Then caught live on production the same day by Justin: asked one branch's opening hours, the assistant answered "according to tabitisrael.co.il" with no search run and no site opened, and the hours were wrong for Thursday, Friday and Saturday night. A right figure is the worse case: a wrong number invites a check, a right number with an invented source does not | High | **Caught and repaired at answer time since #400 (2026-09-17), not yet seen on a live run.** Prompt fenced in #394 plus a free detector; two prompt rules did not stop it, and Google's own documentation says the model decides whether to search and no setting forces it. #398 reads the company's site live for company facts. #400 checks the finished answer in our own code: an attribution to a site nothing was received from sends the draft back once with the reason, and if the rewrite still names it the attribution is cut and a note added. Replayed over 242 saved answers: the 7 inventions tripped it, nothing else did. Two shapes still pass: an outlet named in plain words with no domain, and a stale figure given with no source at all. Every trip is written to the answer log as a `source_guard` entry, so the first live cases can be counted. **Sonnet does not have this bug** |
| Documents carry no date, owner or verified state, so a 2024 price list answers as confidently as this year's and ranks above it | Medium | Not started |
| Nothing enforces per-role tool access in the prompt; a driver is offered the WhatsApp summaries | Medium | Not started. The scope checks inside each tool do hold, proven 2026-09-17 in both languages, so this is defence in depth rather than an open hole |
| The routed model is a preview, with no cutover plan if Google retires it | Low | Watch item. **Corrected 2026-09-17:** no shutdown date is announced for `gemini-3.1-pro-preview`. The date quoted here earlier belonged to the older `gemini-3-pro-preview`, shut down 2026-03-09. Sonnet failed on latency as a primary and stays the chosen backup. Its prerequisite, #397, merged 2026-09-17; the wiring itself is not started |
| Hebrew surface flags (`latinLed`) firing on English answers | Low | **Fixed in #399, 2026-09-17.** A false alarm in the checker, not a defect in the answers: it flagged any English block that quoted a single Hebrew word. Now a block is flagged only when it opens in Latin and Hebrew letters outnumber Latin ones. On 239 saved answers, 33 flags became 1, a real one |

**Proven NOT broken on 2026-09-17:** cross-role permissions. An employee asking for the head office
WhatsApp group, or for staff at a branch they do not work at, is refused by the scope predicate and
the assistant explains why, in both languages. This is the evidence the client CEO's written
department-permission requirement never had.

---

## 6. Not built, in the order I would do it

**Next**
- Document dates and owners, with a recency tie-break in retrieval
- Per-role tool access in the prompt
- Spend alert. Buildable now: 0048's cost columns exist since #389 and are actually filled since
  #400, because until then the loop never summed cost or tokens across rounds. **Verified not
  built**
- Backup model wiring, with Sonnet. Its prerequisite, #397, merged 2026-09-17
- Two paid measurements, about $1.50 each, only on the owner's word: web search through Exa instead
  of Google's native engine, and the tool-tuned Gemini variant (`gemini-3.1-pro-preview-customtools`)

The guard for the invented-source bug left this list on 2026-09-17: it is #400, live, see section 5.

**Robustness at the edge** (batch 3 remainder, all verified not built)
- Rate limit per person on the assistant. The only rate limiter in the repo is on password reset
- Retry safety, so a dropped phone does not pay for the same answer twice
- Finish running answers on deploy instead of killing them mid-sentence
- An assistant health check that does not restart the API because Google is slow
- Model parameters and cache-friendly prompt order, which now have a baseline to measure against

**Quality and language** (batch 4 remainder, all verified not built)
- Thumbs up and down under each answer, stored
- A persist-time check that flags a table or a raw link
- Model-written thread titles instead of the first 80 characters
- A company facts sheet, about 25 lines owned by head office
- Sensitive-topics rules: never rate a colleague; route pay, health and discipline to HR
- The persona pass: no emoji, no flattery, correct Hebrew gender
- Accept the Hebrew word for "sources" in the trailer
- Screen-reader labels on source chips
- The Hebrew store-listing text, which still does not match the English
- Zero-data-retention flags to the provider

**The company website** (group (a)). Justin chose a live lookup over a stored copy on 2026-09-17:
the assistant reads burgersbar.co.il at question time for a branch's hours, its kashrut certificate
and the menu, with nothing stored and no sync job. Merged 2026-09-17 as #398, live. The stored
mirror, 11 items, stays unstarted and is only needed if staff ask questions that span every branch
at once.

**Later** (group (d), 9 items, none started): streaming, resumable answers, inline numbered
citations, claim-level fact checking, rolling thread summaries, single-page fetch, an ops dashboard.

**Parked option, written down rather than chased:** switch web search from each provider's native
engine to OpenRouter's own. It would make every model behave identically and return real URLs
everywhere, which is architecturally the right answer for a primary-and-backup pair. It changes
Gemini's behaviour too, and Gemini currently works. One more reason, found 2026-09-17 in
OpenRouter's documentation: the result and use limits we send are ignored by the native engine, so
our search caps have been partly a no-op. It needs one paid measured run, so it waits for Justin's
word.

---

## 7. Needs a person, not code

1. **May a branch admin read chain-wide lease and franchise terms?** About 46 accounts. Set
   deliberately in the 18-role commit, so this is policy, not a bug. The suite in #388 pins today's
   answer with the question written beside it
2. **Approval of the WhatsApp purpose statement**, the in-group notice and the opt-out
3. **From head office:** a document owner per knowledge folder, plus the registered business name
   and contact email. The last two are placeholders on the privacy page and **block both app store
   listings today**
4. **One paid check:** do the zero-data-retention flags still route
5. **Eleven test conversations** from the 2026-09-16 battery are still on the live system, awaiting
   the word to delete

Resolved 2026-09-17: the backup model choice is Sonnet, decided on measurement rather than opinion.

---

## 8. A note on the instrument

Five defects were found on 2026-09-17 and **not one was the bot giving a wrong answer.** Three were
in the evaluation harness itself:

- The gate passed a run where 32 of 38 answers never happened, because every rate it checks was
  computed over the survivors
- An answer that delivered from the web and then honestly said "I did not find an internal policy"
  was scored as a total refusal, punishing the exact behaviour the prompt demands
- The `refuse` route was unreachable in code, so two questions were marked wrong however well the
  assistant behaved

The lesson worth keeping: a measuring instrument built in a hurry mismeasures in both directions,
and any number it produced before 2026-09-17 should not be compared with one produced after.
