# assistant — feature planning

The planning and operations artifacts for the Assistant: the in-app grounded chatbot, its
Google Drive knowledge corpus, and the usage-driven sync that mirrors that corpus into a
local cache.

The spec (PRD input) for this feature lives in GitHub, not on disk: issue #83, "Implement:
Assistant (grounded chatbot, knowledge cache, Drive sync)", with its build slices as
sub-issues #86–#94. Read it first — it holds the problem, the user stories, and the slice
breakdown the documents here derive from.

Rooms in this folder:

- provisioning-runbook.md — the out-of-band credential and access setup that lets the backend
  reach the client's Drive corpus (issue #86): the GCP project, the read-only service account
  and its key, the folder share, and the two config keys the sync job reads. Human-executed;
  it introduces a standing secret and carries rule-5 review.

Still to come (rule 4): the slice planning artifacts (ui-flow, plan, test cases) for the three
build slices — knowledge cache and Drive sync, the answer path and thread persistence, and the
Assistant UI — as those slices reach the build.

How an answer is produced since #381 (ADR-0028): the answer service opens a bounded tool loop
(`apps/api/src/assistant/tool-loop.ts`) with the persona-and-policy prompt
(`grounding.ts`, `buildAssistantSystemPrompt`) and offers the model six read-only tools
(`tools.ts`): `search_documents` (the chunked retrieval of ADR-0025, over the caller's knowledge
scope), `my_tasks`, `branch_directory`, `projects`, `people_directory`, and `whatsapp_summaries`
(head-office roles only, read through `whatsapp-summaries.ts`). Each tool is the scoped read its
app page performs; a page the role cannot open answers out of scope. The reply's sources are built
from the loop's trace and the cited titles, never from the model's narration, and the answer log
records which tools ran (migration 0045). Web search, the website mirror and the rewritten
evaluation are the following slices; the design, the costs and the owner's decisions of
2026-09-15 are in ADR-0028.

This feature rests on ADR-0003, ADR-0004, ADR-0007, ADR-0013, ADR-0014, ADR-0025 and ADR-0028
(see ../../adr/) and on the Engineering Design (../../engineering-design.md).
