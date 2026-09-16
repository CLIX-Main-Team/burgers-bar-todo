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
page, or a billed search with none). The public website mirrored into the knowledge base (branch
pages, hours, menu, club rules) follows, so a branch fact has a company source before a web one;
then the evaluation is rewritten into three buckets (documents, web, honest no-answer), every
question in both languages, graded by hand rather than by a paid judge.

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
- The chips are typed: a document, a read of the app's data, a web page that links out. The
  changing status line while an answer is worked on still waits on streaming; until then the
  pending indicator stays the generic one.
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
