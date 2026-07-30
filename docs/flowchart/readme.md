# Flowchart — client deliverable (wing index)

The Flowchart is one of the fixed client deliverables: a single diagram combining the business
process flow and the data flow — what happens in the business, in order, and what data moves
between actors and systems at each step. It is authored in two layers, text first (rule 11).

Rooms in this wing:

- business-process-flow.md — the process layer. The ordered account of what happens and who is
  responsible, derived from docs/prd.md. Authority on the diagram's process content. Also records
  the diagram-convention decisions (swimlanes; two bands; Admin/Manager as separate lanes).
- dfd.md — the data layer. What data moves between actors and stores, and the enforcement point
  each write passes through. Authority on the diagram's data content and arrow labels.
- flowchart.excalidraw — the render. One Excalidraw diagram drawn from the two source docs,
  combining them. This is the only layer the client receives.

The two source docs are the authority; the diagram is redrawn from them, never edited in
isolation. All three are updated in the same change (rule 3). The diagram is a bound chart —
labelled shapes joined by directed connectors, actors shown by swimlanes, and every arrow
labelled with the data it carries; every step and data movement in the source appears in it, and
nothing appears in it that is not in the source.

A rendered preview is not kept in this wing: open flowchart.excalidraw in Excalidraw (or import it
at excalidraw.com) to view it.
