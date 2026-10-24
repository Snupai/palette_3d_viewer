# Hallenboden — Palettenplaner

The production UI follows the approved **Fable v2** proposal. Its material language
is a quiet epoxy-grey floor, kraft cartons with tape, a wooden pallet and one Szaidel-navy
accent (`#173159`, the brand colour of szaidel-cosmetics.de; `#8bb0c9` steel blue in dark mode). The former navy/steel corporate chrome is superseded. Domain geometry, solver
ranking, robot checks, persistence and `.rob` semantics remain the source of truth.

## Tokens and typography

| Role           | Light     | Dark      |
| -------------- | --------- | --------- |
| Canvas         | `#e7e9e4` | `#1a1b19` |
| Surface        | `#f8f8f5` | `#242623` |
| Ink            | `#1d1b18` | `#ecebe6` |
| Muted          | `#62625a` | `#b1b4a9` |
| Line           | `#c9ccc3` | `#41453b` |
| Primary action | `#173159` | `#8bb0c9` |

Use the existing semantic CSS/Tailwind tokens, not an independent palette per tool.
Barlow is the body/control face; Barlow Semi Condensed carries headings and numeric
readouts. Both are bundled under `public/fonts/` with OFL licenses and loaded locally.
System appearance applies throughout. WebGL retains its contrasting engineering stage.

Chrome is flat, with 1px rules and small radii. Brand navy indicates a primary action,
selection or current step. The pallet geometry carries the visual emphasis. Every
interactive control has a pointer cursor and visible keyboard focus; primary controls
are at least 44px high. Honor reduced motion. Avoid decorative animation, fake scores
and unexplained technical status walls.

## Entry and saved plans

The first screen offers two explicit choices: **Neuen Plan erstellen** and
**Vorhandene Pläne ansehen**. The library is a full page with actual geometric
thumbnails and visible package L × W × H, physical layer count, counts per layer,
total packages and pallet dimensions. Filters combine dimensions, layer range,
packages-per-layer range, origin and pallet. Mixed stacks show their actual distinct
per-layer counts rather than one misleading average. Search/sort and portable
project/resource import/export retain the repository's behavior.

## Creation

New plans move sequentially through **Paket & Palette → Muster auswählen → Stapel**.
Review/save belongs to the stack stage, not a freely skippable planning tab.

- Inputs use progressive sections, useful defaults and optional advanced controls.
  Dimensions begin blank. Required exact package count reflects the real production
  solver; a simple-raster suggestion is only a suggestion, not a claimed maximum.
- Generation runs through `solverClient` and the worker protocol. Progress and results
  come from the actual run. Large top-down selected-pattern previews, alternatives
  and focused comparison support choice. Recommendation follows the existing
  deterministic ranker; it does not imply mechanical stability or robot readiness.
- Stack composition reuses the stack model and materialization. Counts, transforms,
  interlayers, dimensions, weight and capacity use real results. Review keeps the
  draft. Warnings retain their existing semantics; the UI must not invent new gates.
- Metadata or weight-only edits must not discard geometrically valid candidates.
  Geometry changes invalidate generation via the canonical solver input signature.
- Geometry or handling changes preserve saved placements and stacks, but mark
  affected nonempty solutions with `requiresGeometryReview`. The one canonical
  signature lives in `geometryReviewSignature` (package shape, dimensions,
  clearance, infeed, multipick, label sides, pallet dimensions, overhang); the
  input form hint, the discard confirm, and `updateProject` all read it.
  Storage limits, weights, and metadata never set the flag. They return to
  generation and cannot enter Robotics, Simulation, reporting, or derived `.rob`
  export until a newly calculated stack replaces them. This is a conservative
  review requirement, not a claim that every changed layout is invalid. The
  editor remains available for inspection; editing alone does not clear the flag.
  Metadata and weight changes preserve the solution status. Retained imported
  `.rob` downloads remain the unchanged original file.
- Guided plans persist automatic storage length/width independently. Each axis
  follows pallet size plus total overhang until the user edits that storage
  limit. Older plans without this metadata retain explicit stored limits.
- Saved projects reopen on their furthest completed step. Imported `.rob` files
  already are the plan, so they bypass generation. There is no reference overlay.

## Tools and rendering

Editor, Robotics, Simulation and Report are named secondary surfaces. Their gates
come exclusively from `productionToolGate` in `planningCaseModel.ts`. Do not duplicate
prerequisite logic in overlays. There is no Tools catalog or Validate planning step.
Original `.rob` text stays verbatim; only project-derived exports are regenerated.

`PlanRender` is a server-safe read-only SVG projection of actual preview/stack data;
WebGL and interactive editors remain client-only. Clicking a package cuts visibility
to its layer and selects its grip; the selection inspector shows canonical placement
coordinates. Above-cutoff layers are hidden; the gripper remains ~30% opaque.

## Responsive layout

Use one responsive application for phones and desktops. Main pages have no fixed
minimum desktop width. On desktop forms/results sit beside the growing geometric
stage. On mobile that stage is compact and expandable, actions remain reachable,
and lists reflow into readable compact entries. Library filters collapse into a
mobile disclosure. Dense engineering tables may scroll within their own surface,
not widen the entire page. Do not resurrect a separate mobile planner with fewer
capabilities.
