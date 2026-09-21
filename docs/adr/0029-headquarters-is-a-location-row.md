# The company headquarters is a location row, and only the owner is branch-less

Status: accepted. Decided with the owner on 2026-09-21, from the client's own notes for this
round: the chain wants "company headquarters for the super admin, all roles, a new branch but no
admin", and "every role should have a department". The head office is, in the client's words,
"not literally a branch, but it will be one for this specific system". Supersedes the part of the
2026-08-28 role expansion (migrations 0033 and 0036) that forced the office roles to hold no
location at all.

## Context

The chain has two kinds of workplace: forty-odd restaurant branches, and the head office where
the owner and the office roles (finance, marketing, procurement, the chain chef, the bookkeeper
and so on) work. The app knew only the first kind. A `locations` row was a branch by definition,
and when the eighteen-role model arrived the fourteen office roles were given no location at all,
enforced by `users_role_location_check`: a branch role must hold a branch, everything else must
hold nothing. Two things went wrong with that.

First, "holds nothing" was standing in for "sits at the office", and every rule that read the
location column got the office wrong: a finance manager was "chain-wide" in the roster where the
client thinks of them as sitting at headquarters; a scoped read for an office role matched no row
where it should have matched the office's; the assistant had no row to name when asked where
someone works. Second, the rule was too tight in the other direction. The client's note says
"branches can have all the roles, not just manager and employee"; a driver or a field-ops person
belongs at a branch, and the constraint forbade it.

Two designs were considered. A nullable `location_id` with "null means the office" is what the
schema already had, and it is exactly what made every reader guess. A separate `headquarters`
table would make the office a different kind of thing from a branch, when the client's framing
is that it is the same kind of thing for this system, staffed and read like one, with a few
things missing.

## Decision

A location is one of two kinds. Migration 0051 adds `locations.kind` (`branch` or
`headquarters`), checked, defaulting to `branch`, with a partial unique index that lets the
table hold exactly one head office. The migration seeds that row itself (Hebrew name, no branch
number), so production gets it without anyone clicking it in; nothing in the app creates or
edits a `kind`, and the create and patch contracts carry no such field on purpose.

The users constraint is recut for the third time. The owner (super_admin) alone holds no
location; every other role holds one, a branch or the head office. The same migration moves
every existing branch-less office account onto the head office before the new check is added,
and fails loudly, naming the rows, if anything would still offend it. The invite path places an
office role at the head office when no branch is named and at the branch when one is (an interim
rule: the users round that follows makes the location an explicit choice on every invite), and
every role can be moved between locations except the owner. One role is refused at the office,
on the invite path and on the move path alike: a branch admin, who answers for one restaurant,
and the office is not one. The owner runs the office.

Every location read carries `kind`, and the principal and the user summary carry `locationKind`
beside `locationName`, so a rule that means "holds a branch" asks that, never "holds any
location" and never a name comparison that breaks the day the office is renamed. `GET /locations`
keeps returning the head office beside the branches, marked, because three consumers need it
there: the Locations page draws it apart from the grid, the invite picker offers it as a place
to put an office role, and the task form files head-office work at it.

Everything that COUNTS or LISTS branches filters `kind = 'branch'`, through one pair of helpers
on the web side, so no page and no assistant answer ever calls the head office a branch. On the
Locations page the office is its own box above the grid, out of the branch count, without the
admin and manager ranks, the branch number or the projects count. Its page is the branch page
with the staffing slots and Delete removed: the office is staffed from People, where an invite
names the role, and it can never be deleted, which the API answers with its own 409. The
dashboard's league table ranks branches only; the task table beneath it still names the office
on its rows. A project's branch picker offers branches only. The `/locations` redirect that sent
a one-branch viewer straight to their branch now keys on the viewer's locations horizon rather
than on holding a location, since every role but the owner holds one now and a finance manager
at the office still reads the whole chain.

## Consequences

- The office roles gain a real place in the data, and every scoped read that was matching
  nothing for them now matches the head office row. Their `locations.view` and `users.view`
  defaults of `branch` therefore resolve to the office rather than to nothing, which is the
  intended reading and is noted for the Access page's copy.
- A person is never branch-less unless they are the owner, so "chain-wide" in the roster means
  the owner alone.
- `holdsBranch(role)` in the shared role model no longer describes the constraint, and its
  callers are re-read by the role-model change that follows this one; the WhatsApp summaries
  reader check that used it is to be decided by tier, not by whether a role holds a location.
- Test harnesses keep the seeded head office across resets, the way the departments seed already
  survives, so every case starts in the world production is in, and cases about branches read
  the branches only.
- The migration is applied to production by hand (the runbook for `when`-stamped migrations),
  and the seed is guarded so a re-run adds nothing.
