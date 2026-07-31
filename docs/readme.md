# docs — map

The documentation for the Burgers Bar staff app. Read this first: it is the map of what is on
disk and where to start, so you do not have to open files one by one to find your way. Every
folder under docs/ carries its own readme.md index; open the folder's readme before its files.

Project state — current phase, what is decided, what is open — is tracked in GitHub as wayfinder
maps and issues (the PRD map #1 and the engineering-foundation map #10), not in an on-disk status
or changelog. This docs tree holds the durable records; GitHub holds the live state.

The domain vocabulary is defined in CONTEXT.md at the repo root — the glossary of business terms
(Task, Location, Invite, Assistant, and so on). It is glossary-only and carries no implementation
detail.

## Top-level documents

- prd.md — the v1 product requirements, at a level a location manager can read and approve. What
  we are building and why. The starting point for understanding the product.
- engineering-design.md — how the app is built: the SPA-plus-dedicated-API design that ties the
  architecture decisions together. A living document; the how, not the what.

## Folders

- adr/ — architecture decision records, immutable and numbered. The decisions behind the product
  and the build, each with its rationale. See adr/readme.md.
- flowchart/ — the flowchart client deliverable: plain-text source (business process flow, data
  flow) and the drawn Excalidraw diagram. See flowchart/readme.md.
- research/ — research notes that fed the decisions, capturing facts without picking winners. See
  research/readme.md.
- agents/ — operating instructions for the engineering agents working in this repo: the issue
  tracker, triage labels, and how to consume the domain docs. See agents/readme.md.
