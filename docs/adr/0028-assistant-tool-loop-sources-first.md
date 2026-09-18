# The assistant looks things up itself: a bounded tool loop over the company's own reads, sources first, never an invented fact

Status: accepted. Supersedes the answer-only-from-the-excerpts policy that ADR-0025 carried
forward from #267. Decided with the owner on 2026-09-15, after the client asked the assistant how
many branches the chain has and it declined: the ask, in the owner's words, is that it "must be
intelligent, like a Gemini chat or ChatGPT or Claude chat", able to answer about the company from
its documents and its app, to go to the web when those do not answer, and to help with anything a
work colleague would, while never making anything up.

## Context

Until now the answer path ran one model call with the grounding pasted into the prompt: retrieval
picked the best excerpts for the question, the task board was rendered beside them, and the
guardrail forbade any claim not written in that block. That was the right posture for a corpus of
thirty-seven procedures and a bot whose whole job was to quote them. It is the wrong posture for
what the client now expects. The excerpts could never hold the branch list, the people directory,
the projects or the WhatsApp summaries, because they were never retrieved; a question about any of
them was declined by design. A question the documents do not cover was declined too, with no way
to look further, so "how many branches" got a refusal while the answer sat one table away and on
the chain's own website.

Three things were established before the design was locked:

- A stress test of the design (forty-five questions across three roles, three critics) found the
  failure modes to guard: a model that narrates a search it did not run, a source conflict resolved
  silently, and app data widened past what the person's own pages show.
- A wire spike proved the mechanism on the model in production (Gemini 3.1 Pro through
  OpenRouter): function tools and the broker's server-side web search ride in one request, the
  model's opaque reasoning must be echoed back unmodified on a tool-calling turn or the next call
  is refused, and the model did once claim "from the web" without any search being billed. So
  provenance can never come from the model's own account of itself.
- Cost was measured: about 1.4 cents for a plain answer, about 3 cents for one that takes a tool
  round or two, plus about 1.4 cents per web search. The owner accepted roughly twice today's spend
  and no per-person cap; the guards are per question.

The owner also settled the policy questions in one sitting: the scope is anything a work colleague
would help with; a conflict between sources is reported with both sides; a company question the
documents and the app do not answer always goes to the web before "no answer"; app data is exactly
what the person's own pages show; WhatsApp summaries are a source for head-office roles only,
matched by group name; the persona is "Burger's Bar's assistant" with no name of its own; every
answer shows where it came from as a row of chips.

## Decision

**The model asks for what it needs.** The answer path opens a bounded tool loop (`tool-loop.ts`):
the model is offered a set of read-only tools and decides, round by round, whether it needs one
before it can answer. At most four tool rounds and forty seconds of wall clock, after which the
tools are withheld and the model answers with what it has. Every call is recorded in a trace, and
the trace, never the model's narration, is what the answer's provenance and its log row are built
from.

**Every tool is an existing scoped read, wrapped, and nothing else** (`tools.ts`). The document
search runs the same retrieval the one-shot path ran, over the same knowledge scope. The task
board, the branches, the projects and the people each go through the repository method their own
page reads through, with the scope derived from the principal exactly as that page's route derives
it. A page the role cannot open makes its tool answer `out_of_scope`, and the model is told to say
the data is outside what this person can view; a tool never narrows a list to make an answer
possible. The WhatsApp summaries are read by a substring of the group name over a window of at
most ten days, by head-office roles only. This is ADR-0007's rule facing a new caller: what the
assistant can reach is decided by the reads, and the prompt only narrates it.

**Sources first, the web after, general knowledge last.** The system prompt carries the persona
and the policy: the company's own material comes first for anything about Burger's Bar; the web
comes next for what that material does not cover, through the broker's search tool when it is
offered; the model's general knowledge comes last, for what a colleague would reasonably know or
do. A fact is never invented, a miss is reported as "I did not find it" and never as "it does not
exist", a conflict is reported with both sides and their sources, a request outside work is declined
in a sentence, and the answer is in the language of the question.

**Provenance is built by the server.** A reply's sources are the documents it cited, resolved
against the titles the search tool actually returned (an invented title resolves to nothing, as
before), then the app data the trace shows was read, then the pages the broker's web search cited on
the completion. The chips are typed (document, app, website, web, general), so a company fact and a
web fact read differently at a glance. Tool results are quoted between a per-call fence id the
prompt declares to be data, never instructions.

**Honesty hardening (#387), from the assistant-layer research in `docs/assistant-research/`.**
Thirteen lenses of published practice were scored against this implementation and the confirmed
gaps closed here. The prompt now names the routed model's own knowledge cutoff and orders a search
before any fact that can have changed, checks a question's premise, dates what it takes from the
web, declares when it is answering from general knowledge, and states its lookup budget. The loop
keeps web citations from every round, not only the last, so a page found while our own tools were
still running reaches the reader as a chip rather than silently. Because Google's native engine has
been seen to report no search count at all, a round that came back with citations counts as one
search, which is what makes the two-search cap enforceable; the per-request cap is rewritten each
round to the remainder. An answer that ran nothing and cited nothing now carries a `general` chip
and, when the budget ran out, a line saying the answer is partial. The grounding block prints each
document's last-modified date on its own line under the heading, never inside it, so the exact
citation key still resolves. The people directory marks a colleague who has left or has not
accepted, keeps work email behind an explicit contact argument, and folds Hebrew prefixes and
niqqud before matching, so "בתלפיות" finds the Talpiot branch.

**A named source has to have been received (the source guard, 2026-09-17).** The chips were
always built by the server, but the prose was never checked, and on 2026-09-17 the model was caught
eight times writing "according to <a site>" with no search run and no page opened: seven times in
the evaluation records and once by the owner on production, where the site was not even about the
company and the opening hours it "cited" were wrong for three days of the week. Two prompt rules
did not stop it (#394), and none can: Google documents that with its native search the model alone
decides whether to search, and no request setting forces one. So the check sits outside the model
(`source-guard.ts`). When a finished draft attributes itself to a site ("according to", "לפי",
"על פי") that appears nowhere in what the answer was given, and no search ran, the loop sends the
draft back once with a server-written instruction: search now, or answer from general knowledge
without naming a site or an "as of" date. What the answer was given means the questions, the tool
results and the source chips. The system prompt does not count, because it names sites to prefer
when searching, not facts that were read; and the model's own words never count, in this answer or
an earlier one, because a rejected draft's site would otherwise be backed by the turn that said "let
me re-check that site", and one invention would back every repeat of it for the life of a thread.
Several sites named in one breath are one claim, judged and cut as a whole. A "site" that is a
place, the site manager or the building site in either language, is not a source and is left
alone. The second pass runs under the same forty
seconds, round cap and search cap as the rest of the answer. If it is no better, fails, or cannot
be paid for out of the time left, the reader gets the draft with the claim cut out where that is
safe, and a note that no website was opened; a failed second pass never costs the reader the
answer they already had. The guard is deliberately narrower than the evaluation's
`fabricatedWebSource` flag, because a false alarm here buys a model call: run over the 242 real
answers saved from the 2026-09-17 runs, it tripped on exactly the seven inventions and on nothing
else. The log records it as one more entry in `tools`, `source_guard` with `ok` (sent back and
fixed) or `failed` (reached the reader with the note), and the evaluation runs the same guard and
reports the same two counts.

**The check reaches searched answers too, when the search lists its pages (2026-09-18).** With
Google's own engine the guard stands down after a search, because the engine shows the model pages
it never lists. With the broker-run engine (Exa, `ASSISTANT_WEB_SEARCH_ENGINE=exa`) every page the
model received comes back as a citation, so those pages are material and a site named outside them
is caught like any other. The chips under a searched answer are the pages the answer names, or all
of them when it names none: Exa returns three per search, read or not, and an unread event listing
under a sunset answer is noise, not provenance.

**The answer is in the language of the latest question (the language check, 2026-09-18).** The
prompt always said so, and on production a club-terms question asked in Hebrew and then in English
came back in Hebrew both times, because the model followed the previous turn. A second review sits
behind the source guard in the same loop hook: it reads the script of the latest question and of
the draft's prose, and a clear mismatch sends the draft back once with the language named. Digits,
marks and the SOURCES trailer do not count, and a text needs a seventy-percent majority before it
has a language at all, so an English answer listing Hebrew task names is left alone. One objection
per answer is acted on, and a wrong source outranks a wrong language. The log names the check that
spoke (`source_guard` or `language_check`). A menu answer now carries a chip to the item's page.

**A document chip opens the document and says how old it is (2026-09-18).** The chip under an
answer used to name the document and lead nowhere, while the Knowledge tab had linked the same
document to its file in Drive since the tab existed. The corpus read now carries each document's
Drive file id beside the date it last changed, the search tool remembers both for every document
it returned, and the cited source carries them to the reader: the chip opens the file in Drive in
a new tab and shows the short date, so a reader can check the material behind an answer and see
how current it is. Chips saved before this date have no link and render as before. The same date
now breaks a retrieval tie: two documents matching a question equally used to fall to index order,
which is ingestion order, so a 2024 price list sat above this year's; the newer document wins the
tie, and a document with no date counts as the oldest. The date was already printed under each
excerpt's heading for the model; this is the reader's half of it.

**The web query carries no company data, and that is now structural.** The privacy page's promise
was previously a claim with nothing behind it. The broker's search is withheld for the rest of an
answer once a tool has returned people or WhatsApp text, keyed off the trace rather than off the
model's cooperation, and the page states what the app actually guarantees.

**The day is Israel's.** The date the prompt states is the Asia/Jerusalem calendar day, not UTC; the
old formatting put the assistant a day behind every evening.

**The answer log grows a `tools` column** (migration 0045): the tools an answer ran, names and
statuses only, in call order. The arguments are model-written text about the question and stay out
of the log (ADR-0011). An answer that ran no document search logs retrieval mode `none` rather than
a mode it never used.

**Delivered in slices.** This record covers the loop, the six read-only tools, the persona, the
provenance and the Israel day (#381), and the web slice (#385): on OpenRouter the broker's own
search (`openrouter:web_search`, Google's engine behind the routed Gemini, three results a search)
rides beside our tools on every answer, capped at two searches an answer (`max_uses` on the request
and the loop's own count across rounds); the prompt sends anything that changes over time (a VAT
rate, a price, a holiday date, an opening hour) to a search rather than to memory, and on a
provider with no search says the web could not be checked instead of filling the gap; a page the
search cited becomes a web chip that links out; the search is logged from what came back (a cited
page, or a billed search with none). The evaluation was then rewritten (#388) to grade the real
loop in both languages, by hand rather than by a paid judge.

**The company's public website is read live, not mirrored (2026-09-17).** The original plan was to
copy burgersbar.co.il into the knowledge base. The owner chose a live lookup instead, and the same
day the need showed itself on production: asked one branch's opening hours, the assistant answered
from memory, attributed them to an unrelated site, and got three days of the week wrong. A seventh
tool, `company_website` (`company-website.ts`), reads the site at question time. The site is
WordPress and publishes feeds of its branches, products and pages, so the tool lists those (cached
for an hour, three small requests), matches the question against their titles with the same Hebrew
folding the people and branch searches use (`hebrew-text.ts`), and fetches the one or two pages
that match best. Product pages carry a name and nothing else, so a menu question is answered from
the list of names and no page is fetched. Nothing is stored: no sync job, no migration, no copy to
drift from the client's site, and an answer is as fresh as the page. The price is that a question
spanning every branch at once ("which branches open after midnight") would mean reading forty-five
pages, and is not attempted; a stored mirror remains the next step if staff turn out to ask that,
and nothing here is wasted by it. The prompt names the tool for a branch's hours, its kashrut
certificate, accessibility, a menu item and the club terms, and forbids stating opening hours, a
kashrut certificate or a menu item from memory. `COMPANY_WEBSITE_URL` points it elsewhere, or
switches it off when empty. A site that is down or slow yields a `failed` result the model reports
as such, never a guess at what the page would have said.

## Consequences

- The scope boundary does not move. An employee's answer cannot name a task, a branch, a project
  or a person they could not open in the app, because the tools cannot return one. What changed is
  that the assistant now reaches everything the person CAN open, not only the documents.
- A role without a page gets "outside what you can view" for that page's data. An employee has no
  Locations page by default, so a branch question is out of scope for them until the owner flips
  that switch on the Access page. Deliberate: the assistant mirrors the pages, it does not add a
  side door.
- Cost about doubles per answer and each web search adds its own cent and a half; the owner
  arranges the top-up. The only guards are per question (round cap, deadline, two searches), by
  the owner's decision.
- The chips are typed: a document that opens its file in Drive and shows its date, a read of the
  app's data, a web page that links out, and the quiet general-knowledge chip. The changing status
  line while an answer is worked on still waits on streaming; until then the pending indicator
  stays the generic one.
- The assistant is now a guest on the client's public site. It says who it is in its User-Agent,
  keeps the list of pages for an hour rather than asking again, reads at most two pages for one
  question, and gives up after eight seconds. robots.txt allows everything, checked 2026-09-17.
- The general-knowledge chip is decided by answer length, not by asking the model to classify
  itself: a greeting stays unlabelled, a substantive answer with no source is labelled. The
  threshold is a judgement call and is named in one constant.
- The answer log gains `rounds` and `capped` (migration 0047). Cost, cached tokens and the served
  model are still unlogged, so the per-answer cost figures above cannot yet be checked against
  production.
- An answer that trips the source guard costs a second model call and about doubles its wait. On
  the 2026-09-17 records that is 7 of the 92 answers that had not searched, and none of the 150
  that had. What the guard cannot see is an outlet named in plain words with neither a domain nor
  the word "site" ("according to Calcalist"), and a stale figure stated with no source at all,
  which still carries the general-knowledge chip.
- The broker does not always say how many searches ran (the native engine reported no
  `server_tool_use` in the spike), so a search that cited nothing may go unlogged; a cited page is
  the one certain signal, and the model is never asked whether it searched.
- OpenRouter's zero-data-retention terms do not cover its web search. Only a short model-written
  query reaches the engine, never the question or a document, and the privacy page says so.
- `assistant-eval.ts` and `assistant-probe.ts` still drive the one-shot prompt (kept exported)
  until the evaluation rewrite. They measure retrieval, which is unchanged inside the search tool.
- The digest worker's `whatsapp_summaries` table gains a second reader. Its four columns and the
  ten-day retention are now a contract between the two workspaces; a change to either is told to
  the assistant first.
- The tool loop is an OpenAI-compatible function-calling protocol, so the provider switch
  (ADR-0018) still holds; a provider whose model cannot call tools simply answers in one round.
