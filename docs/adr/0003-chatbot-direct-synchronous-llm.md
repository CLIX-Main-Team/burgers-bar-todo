# Chatbot answers via a direct, synchronous in-app LLM call

The source CRM's chatbot fires an n8n webhook and waits ~90–110s for a callback, delivering
the answer over a realtime channel; it also has a lighter in-process branch that just calls
an LLM provider directly. For the Burgers Bar ops-assistant we answer with a single direct
in-app LLM call, fully synchronous — the answer is returned in the server action's response,
not pushed over realtime. This drops the webhook, the `job_id` correlation, the realtime
subscription, optimistic echo, and the persisted `error` message role (a failure is a
transient inline retry, not a thread row).

We chose this because staff on the floor need seconds-fast answers, and the webhook path
would add a hosted automation, a public callback ingress, and a shared secret in both
directions for no payoff on short retrieval-augmented Q&A. The webhook pattern only earns its
keep for genuinely long, multi-step, human-in-the-loop orchestration, which this is not.

Two security decisions ride along with this shape:

- All chat writes go through a service-role server action; browsers get a read-only RLS
  policy on their own threads and never insert directly. This means the Assistant's `agent`
  voice cannot be forged from a browser and a user cannot inject a fake turn — the same split
  as ADR-0002's status-only server action.
- Retrieval that grounds an answer is capped at what the asking user may already see
  (employee = own assigned tasks, manager = own-location board, admin = cross-location), so
  the chatbot cannot become a data-exfiltration side-channel around the three-role model
  (ADR-0001).

## Consequences

- If a future ops workflow needs genuinely long, multi-step, human-in-the-loop orchestration,
  revisit the async webhook pattern for that specific flow — do not retrofit the whole chatbot.
- Token streaming (answer appearing word-by-word) remains possible later via a streamed
  response; it is compatible with the synchronous model and does not require adopting the
  async-write-then-realtime pattern.
- Do not "simplify" chat writes into a permissive browser INSERT policy — that would let a
  browser forge `agent` rows, breaking the trust boundary this ADR establishes.
