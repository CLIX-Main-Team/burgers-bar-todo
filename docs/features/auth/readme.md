# auth — feature planning

The rule-4 planning artifacts for the authentication feature: the full invite-only
email/password auth surface (seeded admin, invite create/resend/revoke/accept, sign-in,
logout and logout-all, password reset, deactivate/reactivate), delivered as one unit with the
ADR-0010 foundation.

The PRD (spec input) for this feature lives in GitHub, not on disk: issue #25, "Implement:
Authentication surface (invite-only email/password login)", a sub-issue of engineering map #10.
Read it first — it holds the problem, the 36 user stories, the implementation decisions, and
the testing decisions the documents here derive from.

Rooms in this folder:

- ui-flow.md — the user-facing flow: the four pre-auth screens (login, accept/set-password,
  reset-request, reset-consume) and the in-app session, invite, and deactivation touchpoints,
  each traced to the user stories. Text-first per rule 11.
- plan.md — the implementation plan: the module seams, the foundation-first build sequence, the
  single-seam testing approach, the rule-5 review points, and the risks.
- test-cases.md — the test cases derived from issue #25's user stories and testing decisions:
  the happy paths and the security negatives, each traced to a story and asserted through the
  single HTTP seam.

Still to come (rule 4): implementation under rule-5 human review (the auth module is
security-sensitive).

This feature rests on ADR-0005, ADR-0006, ADR-0007, ADR-0008, ADR-0009, and ADR-0010 (see ../../adr/) and
on the Engineering Design (../../engineering-design.md).
