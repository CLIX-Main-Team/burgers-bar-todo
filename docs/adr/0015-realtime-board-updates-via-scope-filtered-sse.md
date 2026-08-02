# The task board updates live over scope-filtered server-sent events

Status: accepted. Decided while grilling the task-board build slices (map #53, ticket #58);
security-sensitive under rule 5. Resolves the realtime question the engineering design left to
the build ("likely polling in v1").

## Context

The task board is shared: a manager reassigns a task, an employee flips a status, and every
other viewer's board is now stale. The engineering design deferred how a viewer learns of a
change — live push versus TanStack Query polling — to the build, leaning toward polling. The
PRD's notification section reinforces a poll-or-open posture: "staff see their work by opening
the app." This ADR settles the board's freshness mechanism.

The hard part is not the transport. It is that any live channel has to honour the same
permission model as the reads it mirrors. ADR-0007 makes every board read pass a scope
predicate — employee sees only tasks assigned to them, manager only their own location, admin
chain-wide — and warns that any path returning tasks without that predicate is the failure
mode to guard against. A naive broadcast of "task X changed" to everyone at a location would
be exactly such a path: an employee would learn of a task never assigned to them, a manager of
a neighbouring location's board. Realtime must not become a way around the three-role model.

## Decision

The board updates live, server to client, over server-sent events (SSE). This reverses the
lean toward polling and the PRD's open-the-app posture for the board specifically.

Transport — SSE, not WebSocket. The channel is one-directional: the server pushes board changes
to the client, and the client patches its TanStack Query cache from the stream. All writes
continue to travel the ordinary REST endpoints, which already carry the ADR-0007 role guards
and scope predicates; nothing is written over the live channel. A one-directional need is met
by the one-directional transport — SSE rides plain HTTP and reconnects natively, and a
bidirectional socket would buy nothing this surface uses.

Scope-filtered fan-out — the security core. Every event is filtered per subscriber by the same
scope predicate that gates reads (ADR-0007), derived from the per-request principal, before it
is delivered. A subscriber receives an event for a task only if that task is within their read
scope at delivery time. The fan-out reuses the scope-predicate helper; it does not reimplement
the rule, so the live path and the read path cannot diverge. There is no unfiltered board
channel, the direct analogue of ADR-0007's "no unscoped repository method."

Build sequencing. The board ships first over plain REST reads (build slice A), so there is a
working, testable board before any streaming exists; the live channel is a distinct slice (A2)
layered on top, and every later write slice emits the events it relays. Isolating the channel
keeps the security-critical fan-out in its own review rather than entangled with basic reads.

## Considered options

Polling (TanStack Query refetch on focus and interval) was the design's leaning and was
considered: no channel, no fan-out, the read predicate covers freshness for free because every
refetch is an ordinary scoped read. It was set aside here because the shared board benefits from
immediacy and the team judged the scope-filtered SSE channel a small, well-understood addition;
polling remains the obvious fallback if the channel proves not worth its weight.

WebSocket was considered and rejected as more transport than a one-directional push needs, with
no client-to-server traffic to justify the bidirectional machinery.

## Consequences

The API gains a live SSE endpoint and a per-subscriber, scope-filtered fan-out. That fan-out is
security-critical code: it must pass every event through the ADR-0007 scope predicate, and any
change to it triggers rule 5 human review before merge — the same discipline the data-access
scope methods carry. The failure mode to guard against is an event delivered outside its
subscriber's read scope, the streaming analogue of an unscoped read.

The realtime question is no longer deferred; the engineering design is updated in the same
change to point here. The chatbot remains synchronous and needs no channel (ADR-0003); this
decision is the board's alone.
