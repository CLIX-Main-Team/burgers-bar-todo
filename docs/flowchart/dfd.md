# Data Flow — Burgers Bar Staff App

The account of what data moves between actors and systems, and through which enforcement point
each write passes. This is the data layer of the Flowchart deliverable. It is derived from
docs/prd.md and the architecture decision records, uses the CONTEXT.md vocabulary exactly, and is
the authority on the diagram's data content. The arrows in the diagram carry the labels named
here; the process steps they attach to are numbered in business-process-flow.md.

The App is the single trusted server side — server actions, row-level access rules (RLS), and the
database. The data stores it holds are the User records, the Task records (with their Assignee
sets), the Threads and their Messages, and the local Knowledge cache. Google Drive is an external
store the App mirrors from. The browser is a client that, for the assistant, is read-only.

## Stores

- Users — one record per person: id, email, display name, role, Location (except Admins, who are
  chain-wide), User status, preferred language, timestamps, and the Invite details (token, expiry,
  and who sent it).
- Tasks — one record per unit of work: id, Location, creator, the Assignee set, title,
  description, Status, priority, optional due date, completed-at, board position, timestamps.
- Threads and Messages — a Thread per private conversation (owner, auto-title) and its Messages
  (role user or agent, content).
- Knowledge cache — the local mirror of the Knowledge Docs, each a procedure or policy.
- Google Drive (external) — the shared folder where Knowledge Docs are authored.

## Data movements

Each movement names what data moves, from where to where, and the enforcement point it passes
through. The step numbers refer to business-process-flow.md.

1. Invite issued (steps 2–3). The inviter sends the new User's name, role, and Location to the
   App. The App writes a User record at status invited and issues an Invite token with the role
   and Location baked in. The token is the carrier: role and Location travel inside it and the
   recipient cannot alter them (ADR-0005).

2. Invite redeemed (steps 4–5). The recipient sends the token and a chosen password to the App.
   The App reads the token, validates it is single-use and unexpired, writes the password, and
   moves the User record to status active. The token is then spent.

3. Session established (step 6). The User sends email and password; the App returns an
   authenticated session scoped to the User's role and Location. All later reads and writes ride
   this scope.

4. Task authored (steps 7–8). A Manager or Admin sends Task content and the Assignee set to the
   App. These writes pass through the row-level access rules, which permit a Manager to write only
   their own Location's board and an Admin to write any Location's. The App writes the Task record;
   an empty Assignee set marks it Backlog.

5. Status changed (steps 9–10). An Employee sends only a new Status through a dedicated,
   status-only server action. That action writes the Status field alone (and the completed-at
   stamp when the Status is done) and nothing else — deliberately not a broad database permission
   that would let an Employee rewrite the rest of the Task (ADR-0002). Managers and Admins may
   write any field through the row-level rules.

6. User deactivated (step 11). An Admin sends a deactivate instruction; the App moves the User
   record to status deactivated, which blocks login and revokes the session while retaining the
   record. No Task Assignee sets are rewritten automatically.

7. Prompt submitted (steps 12–13). A User's browser sends a prompt to the App's assistant server
   action. The browser cannot write Messages directly: for the assistant it is read-only on the
   User's own Threads, and every Message is written by the trusted server action, so the
   Assistant's voice cannot be forged and a User cannot inject a fake turn (ADR-0003).

8. Grounding retrieved (step 14). The assistant server action reads Task and Knowledge data to
   ground the answer, and that read is capped at the asking User's own scope — an Employee's
   assigned Tasks, a Manager's own-Location board, an Admin's cross-Location view — plus the
   chain-wide Knowledge cache. Retrieval can never exceed what the User may already see.

9. Answer generated and stored (steps 14–15). The App sends the prompt and the retrieved grounding
   to the Assistant in one direct synchronous call; the Assistant returns a grounded reply, which
   the App writes back into the Thread as a Message with role agent. The browser then reads the
   updated Thread. The Assistant reads only the grounding it is handed and writes nothing directly.

10. Knowledge synced (steps 16–17). Knowledge Docs authored in Google Drive are mirrored one way,
    Drive into the App's local Knowledge cache. The Assistant reads the cache only and never Drive
    live (ADR-0004). No data flows from the App back to Drive.

## Enforcement points named on the diagram

Three writes are drawn as passing through a named guard, because the guard is the decision and is
easy to get wrong:

- Row-level access rules — the guard on Task authoring (movement 4) and on Manager/Admin edits.
- Status-only server action — the guard on an Employee's Status change (movement 5), writing the
  Status field alone.
- Assistant server action (service role) — the guard on every Message write (movements 7 and 9);
  the browser stays read-only on its own Threads.

These three labels appear on the corresponding arrows in the diagram so that the enforcement
point, not just the data, is visible.
