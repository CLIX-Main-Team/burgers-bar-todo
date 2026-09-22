# Tasks: the house-style redesign (2026-09-22)

Owner brief, 2026-09-22: "Now you will focus on redesigning the entire task page. It looks normal
right now but I want it to be clean. Another tab just redesigned the dashboard page and I really
like it. Follow the redesign standard." The standard is the method the Dashboard's order rail was
made by: the idea comes from the restaurant's own world, decoration carries real data, it is drawn
in the app's own tokens, there is one quiet signature per page, motion belongs to the object, and it
works for every reader (Hebrew, phone, both themes).

Nothing about what the page does changed: the same reads, the same writes, the same permissions.
This is a change of shape.

## The house style, shared with the Dashboard

The two surfaces the Dashboard is built from now live in `components/ui/surfaces.ts` and the pill
row in `components/ui/pill-group.tsx`, so both pages draw from one source:

- a card: 20px corners, hairline border, a soft shadow, on the grey canvas;
- a tile: 14px corners on the sunken ground, sunk into a card rather than lifted off it;
- pills: rounded toggles whose chosen one wears the soft ink wash, with a count in a small disc.

## Level by level

**The two top levels (departments, private list).** The head is the Dashboard's: the page name and
today's date at the inline start; the search, the Personal tasks pill and New task at the inline end.
Under it, one strip of department pills, each with its open count, the chosen one in solid blue.

It used to be four rows of controls before any content: the title, a search-and-button row, a pair
of underline tabs (Personal tasks / All tasks) and then the department chips. "All tasks" only ever
led to the chips under it, so it is gone; Personal tasks moved into the head on a desktop (a private
list is a different kind of place from a department, and taking it out of the strip lets the seven
departments hold one line at a laptop's width). On a phone, where the head keeps no buttons, it
leads the strip, set off by a rule.

**A department.** One card: the department's mark in a sunken square, its name and one-line sum,
the owner's branch filter and New subject at the inline end, and the subjects as tiles inside. Each
tile leads with its open count at the Dashboard's figure size, the done count under it, the faces
on the work, and the per-task rail in the subject's colour.

**A subject's page.** The way back to the department with New task at the other end of that line,
then the subject's head card: its colour, name, place pill and description; the open count at the
Dashboard hero's size with the overdue and due-today chips beside it; the done count; and the ticket
spike. Under it one toolbar row (search, board or list, the count, the three filters, the priority
sort), then the board.

**The board.** Each lane is a card with the status dot, name and count at its head, and its tasks
as tiles sunk into it. A tile carries three lines and nothing else: the title (with the priority
flag only when the task has been raised); the due date, red once late, or the day it was finished;
and the footer of faces, checklist count, branch and the status control. On a phone the three
lanes become three status pills over one lane card.

**The list.** The same one-frame table, now the Dashboard's card. The status colour is a short
rounded bar set just inside each row instead of a stripe on the frame's edge: a stripe on the edge
cannot follow a 20px corner without clipping, and the frame may not clip because the status menu
opens inside it.

## Panes that scroll (owner follow-ups, 2026-09-22)

Two asks the same day, after the first review: "make the parent div for the subjects and for the
task in a fixed height ... take the space below and just make it scrollable vertically. not
horizontally", and then, on a subject's board, "make the parent divs of the tasks twice as long.
its okay for the main window to be scrollable".

- **A department** fills the screen: its card runs from under the department pills to the foot
  of the screen, and its tiles scroll inside it under a head that stays put. The page itself does
  not scroll.
- **A subject's board** (and the private board) is capped at one screen's height, less the page's
  margins. The lanes grow with their tiles up to that and scroll inside it from there, and the
  page scrolls to bring the board into view. On the owner's screen that took a busy lane from
  500px to 839px. Exactly twice would have been taller than the screen, which puts a lane's head
  and its pager on different screens, so the cap is one screen. A small subject keeps short lanes
  rather than a screen of empty ones.
- **The list** takes the same cap. Its column head sticks to the top while the rows scroll under
  it, and it lives inside the scrolling frame so a scrollbar can never pull the columns out of
  line with their names.
- Scrolling is vertical only (`.bb-scroll-y` in `index.css`), with the thin bar in the hairline
  ink where the platform draws one. A pane with nothing left to scroll hands the wheel on to the
  page: an early cut held it, which froze the page under a pointer resting on a lane that had no
  bar at all (owner report the same day). Each scroll area runs out to its card's edges and repeats the
  card's padding inside itself, so the bar sits at the card's edge and tiles are cut at the card's
  own corners.
- A lane that scrolls clips whatever leaves it, so a dragged tile now travels in an overlay above
  the page: the same tile, lifted with a shadow and a slight tilt, while a faded copy holds its
  place in the lane.
- None of this on a phone, where the head is most of the screen and a box scrolling inside a
  scrolling page feels stuck, or on a screen shorter than 700px, where the page flows as before
  (`FILL_QUERY` and `BOARD_CAP` in `tasks-screen.tsx`).

## What came off, and why

- The row the drag grip and the priority flag shared at the top of every card. The grip now waits
  in the tile's corner and appears when the pointer finds the tile or the keyboard reaches it
  (always, on a touch screen), so every tile starts with its title.
- The flag on an ordinary task. Normal is the floor every task starts at, so a grey flag on every
  card said nothing forty times over. Only a raised priority is marked on the board; the list still
  gives every task its priority in its own column.
- The hairline over each card's footer and the bordered branch pill: spacing does the first job and
  a pin beside the name does the second.
- The grey lane trays, the dashed empty-state outline and the underline tabs: replaced by the cards
  and pills above.

A Hebrew title in the English interface (and the reverse) now starts where the rows under it start,
on the tiles, the list and the read-only sheet: the title's own box is sized to it, rather than a
full-width heading that flushed it to the far edge.

## The signature: the ticket spike

The Dashboard hangs the shift's open work on the order rail above the pass. The other half of the
same kitchen is what happens when a job is done: the ticket comes off the rail and is pushed down
onto the spike by the pass, a steel pin on a round foot where finished tickets pile up through the
shift. The subject's head card carries that spike (`ticket-spike.tsx`): the pin is the whole subject
and the pile on it is how far through it the team has got.

- The pile is data: `spikeSlips(done, total)` deals the done share in eighths of the pin, never
  rounding a finished task away, never filling the pin while something is left, and never drawing
  more slips than there are finished tasks. A subject with nothing done is a bare spike. Pinned by
  `ticket-spike.test.ts`.
- Drawn in the rail's hand: sunken paper, hairline edges, and no colour at all, since every slip on
  a spike means the same thing. Only the top slip shows its tear and its writing.
- Motion belongs to the object: each slip drops the last stretch of the pin onto the one below it,
  lowest first, 70ms apart (`animate-spike`, `bb-spike-in` in `index.css`). Reduced motion gets the
  settled pile.
- It mirrors in Hebrew, is hidden from assistive tech (the counts are in the text beside it), and
  stands behind the text at a fixed height, so every subject's pin is the same length and only the
  pile changes.

## How to verify

1. As the super admin, open Tasks: one strip of seven department pills with open counts, Personal
   tasks and New task in the head, the chosen department as one card of tiles.
2. Open a subject: the head card shows the open figure, the overdue and due-today chips, the done
   count and the spike; the pile grows as tasks are moved to Done.
3. Hover a task tile on the desktop board: the grip appears in its corner and drags as before.
4. Switch to List: one card, a status bar per row, groups that fold.
5. Repeat in Hebrew and in dark mode, and at phone width (status pills over one lane card).
6. At a desktop size, open Operations: the card reaches the foot of the screen and its tiles
   scroll inside it. Open a busy subject and scroll the page down: the three lanes fill the
   screen and each scrolls on its own; drag a tile to the next lane and it floats over it. Open a
   small subject: the lanes are only as tall as their tiles.
