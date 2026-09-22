# Dashboard, round 3: design

Owner brief, 2026-09-22: "I don't like the light mode and dark mode is just okay. I like the colour
palette of black though. The light mode not so much, like the background colour or something. The
layout needs to be changed too." He attached three dashboards built by coworkers (AlexBase, light;
Kol HaAm, dark and Hebrew) and asked that the new page follow their style, and that we decide which
data it shows. The direction below was reviewed as a clickable mockup the same day. He chose the cool
grey light mode, kept dark mode on today's charcoal, asked for a quieter hero card than the mockup's
solid blue one, and asked for it to be built in the app itself.

## What the page is for

One question, asked by whoever opens the app first thing: how is the work going, and where do I need
to step in? It stays a view of the task board the Tasks screen already reads (same query, same live
channel, same API scoping), so a number here can never disagree with the board.

## Layout, top to bottom

| Row | Left | Right |
|---|---|---|
| Head | Title and today's date | Branch and Department filter chips |
| 1 | Hero: Open tasks (a third of the row) | Overview tiles (two thirds) |
| 2 | Team activity | Team workload |
| 3 | Across the chain | Needs attention |
| 4 | Projects running, full width | |

Cards take the house style of the reference screens: 20px corners, generous padding, big numbers,
tiles on a sunken ground inside a card, pill toggles. The hero and the overview share a row from
1440px; rows 2 and 3 pair up from `lg`; below that every card takes the full width.

The overview's tiles answer to the card's own width (a container query), not the screen's: five in
one row from 37rem of card, three from 26rem, two on a phone. A tile three or more across and
under 47rem is too narrow for its label beside its icon, so there the icon drops beside the figure
and the label takes the tile's whole width; from 47rem (the owner's monitor) and two across on a
phone, the icon sits by the label. The first cut tied five across to an 1800px screen. On the
owner's 15-inch laptop, which has the same 18px root type with 400 fewer pixels, the tiles fell to
three and two and the hero stretched to their height with an empty half (2026-09-22, the day the
page went live). Below 1440px the hero takes the full width above the tiles rather than sit beside
two rows of them.

## The data, card by card

**Filters.** Branch and Department chips scope every card below them (the board's own FilterMenu
control). What they offer follows how far the viewer sees, not what the board holds that day. A
viewer whose dashboard runs chain-wide (the owner, the CEO, the HQ managers) is offered every place,
and one whose departments run chain-wide (the owner, a branch admin) every department, busy or not.
A narrower viewer is offered only the places and departments their own work touches, a task's
department being its subject's. A chip with one choice is not drawn, so a one-branch admin gets no
Branch chip, and place names need the Locations page capability. The first cut offered only places
and departments holding work, and on the quiet live board both chips vanished and read as missing
(owner, 2026-09-22).

**Hero, Open tasks.** Every shared task not yet done, with two chips: how many are overdue and how
many are due today. The whole card opens the Tasks board. It is quiet: the card's own surface and
the number in ink. Beside the figure hangs a kitchen order rail, the steel bar above the pass where
order tickets wait until the job is done: a few paper tickets in the app's hairline style, each
with a colour band dealt from the real counts (red late, amber due today, grey the rest). An empty
board is an empty rail. Two earlier motifs were turned down on sight: a solid blue card ("too much
for being blue") and the reference's ripple of rings ("looks like a data or wifi connection").

**Overview tiles.** Due today (how many of them are already started), In progress (at how many
places), Overdue (how late the oldest one is), Done this week (against the week before, as a
signed percentage), Projects running (how many are past their target). Each tile wears the tone its
state already owns everywhere else in the app.

**Team activity.** Tasks created against tasks completed per day, over 7, 14 or 30 days, from each
task's real createdAt and completedAt. This replaces the old "Finished each day" card, whose six
earlier days were invented sample data. Two smooth lines with soft fills, one axis, a crosshair
tooltip that lists both values for the day under the pointer. In Hebrew the time axis mirrors, so
time runs in the reading direction and today sits at the reading end.

**Team workload.** Open tasks per person as one stacked bar: overdue, to do, in progress (a
partition: a late task counts once, as overdue). Late work first, then the heaviest load. A search
field narrows the list; the first eight show and the card says how many there are. Hidden from an
employee, who has no team to read.

**Across the chain.** Two rings, drawn the way the reference dashboards draw them (the owner's
pick): a thick ring, round-ended slices with a gap between them, the figure bold in the middle and
its name set small and spaced out underneath. One reads branches that are behind (holding overdue
work), on track (open work, none late) or clear (nothing open); the other open tasks by priority. Under them a ranked list,
switchable between Branches and Departments, with open and overdue counts per row. Shown only when
the viewer's tasks span more than one place. The head office is a location but not a branch, so it
never counts as one; it appears in the list under its own name.

**Needs attention.** Tabs for Overdue, Due today and High priority, each listing the tasks to chase
with their place, subject, assignees and how late or when due. This replaces the round-11 paginated
task table: the board is where the full list lives, and this card is the short list to act on.

**Projects running.** The projects strip, restyled as tiles: colour and glyph, name, where, progress
and target date, late targets in the destructive ink.

## Colour

The light theme moves from warm greige to a cool grey that matches the charcoal night: canvas
#F1F2F4, white cards, #F6F7F9 sunken tiles, #E0E3E8 hairlines, a cool near-black ink. Night keeps
its charcoal ramp unchanged. The status and priority tones get crisper in both themes (the earthy
olive and mustard were a large part of why day read as muddy): done green, in-progress blue, to-do
amber, overdue red, each measured against the surfaces it lands on (text pairs at 4.5:1, marks at
3:1). The one action blue is unchanged. These are shared tokens, so the change is app-wide.

## Motion

The round-12 entrance stays: blocks rise in one score, rings draw, bars sweep, lines draw in. All of
it through motion-safe; reduced motion gets the settled page.

## Verification

Unit tests for every metric (the arithmetic is where a dashboard's honesty lives), typecheck, lint,
build, the e2e lane, and screenshots in both themes and both languages at desktop and phone widths,
as super admin, branch manager and employee.
