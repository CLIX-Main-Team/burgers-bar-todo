# research — research notes

Investigations that fed the decisions. A research note captures the facts a decision waits on; it
does not pick a winner — that happens in the grilling and lands in an ADR. Read a note for the
groundwork behind a decision, and the ADR it fed for the choice made.

Notes:

- auth-spa-native.md — SPA and native auth options for the invite-only email/password flow
  (issue #11). Compared better-auth, Lucia, and a hand-rolled approach, and established the
  cross-site-cookie constraint that pushes all options toward a bearer token. Fed the auth
  grilling #12 and ADR-0006.
