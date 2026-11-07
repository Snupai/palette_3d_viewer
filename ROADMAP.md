# Palletizing Planner Roadmap

Status as of: 06.11.2026

Implementation status: **M0–M9 are implemented as an end-to-end internal product
workflow, including the LAN backend and ADR 0010 browser-plan synchronization.**
Projects can be created without a `.rob`, validated, saved locally,
solved, compared, combined into stacks, edited in pattern/sequence/flow modes,
checked against robot constraints, simulated, reported and exported in a
controlled way. The existing `.rob` viewer/editor remains fully usable alongside
it. Server mode adds shared PostgreSQL records, local accounts, administration,
version-conflict handling, Browserpläne with explicit synchronization and scheduled
backups. The automated baseline comprises 183 test files with 1834 tests,
TypeScript, ESLint, Prettier and production build gates, as well as a
browser-verified create-solve-stack-reload and legacy import flow.

For third-party parity, only evidence-bound questions remain open: the semantics
of "Blöcke" (blocks), the external sign/final-field conventions and real
production kinematics/collisions. Solver parity is considered reached, and the
proprietary `.mpb` format is no longer pursued. These boundaries are labeled in the UI, export and
report as Observed, Open, internal or unverified and are not claimed as
compatibility.

The basis is the requirements capture of 05.08.2026. The goal is a modern web
workflow built on general palletizing and gripping principles: capture a
project, compute many usable layer patterns, compare them visually, edit them,
check them against robot constraints, save them and output them as `.rob`.

## Target vision

Without an existing `.rob` file, a user can:

1. define the product, package, pallet, gripper and palletizing station.
2. compute a broad, reproducible set of distinct layer patterns;
3. filter the candidates by piece count and compare them visually with the
   arrow keys;
4. combine two layer patterns into a complete stack;
5. refine positions, grip groups, sequence, labels and interlayers;
6. check dimensions, utilization, weight, cycles and robot limits;
7. simulate the flow and gripper motion;
8. reopen the project, document it and output it as a validated `.rob` file.

The existing viewer and editor will continue to be used. They already form the
visualization and editing foundation; the roadmap mainly adds the missing
planning, solver and robotics layer underneath.

## Starting point

### Reliably implemented

- `.rob` import with line-accurate errors, original/edited view,
  parser/serializer round trip, local library and the existing 2D/3D editor
- versioned project model, deterministic migration, separate project/resource
  stores, search, sorting, duplication, **Speichern unter** ("Save as") and
  portable JSON packages
- project/package dialog with standard and custom pallets, overhang/underhang,
  stacking height, tare and maximum weight
- deterministic row/block/edge/mixed-pattern solver in a Web Worker with
  progress, cancellation, stable identity, deduplication and diagnostics
- candidate table with count/maximum filter, `x von y` (x of y), arrow-key
  navigation, SVG thumbnails and immediate 3D preview
- stack composition, free layer sequence, mirroring/rotation, special layer,
  variable interlayers, production metrics and limit warnings
- project editor with pattern, sequence and flow modes, multi/box selection,
  fine movement, labels, grip groups, dependencies and shared history
- gripper/station resources, multipick cycles, TCP/reach/envelope and simple
  collision diagnostics, plus a strictly pre-validated project `.rob` export
- deterministic RobotCycle timeline, forward/backward control, fixed views and
  simplified robot/gripper visualization
- print/PDF view, metrics/warnings/cycle report and an explicitly unverified,
  strictly read-only `.mpb` diagnostic boundary
- AI sheet-photo extraction through `DocumentCamera` / `SheetPhotoImport` and
  `/api/sheet-extraction`, configured with `SHEET_EXTRACTION_*` for a local
  Ollama or OpenAI-compatible endpoint; `NEXT_PUBLIC_DISABLE_AI_FEATURES`
  disables AI features
- explicit server mode with PostgreSQL/Drizzle, record API and
  `ServerPlannerRecordStorage`, local accounts, `/admin` user management and
  optimistic concurrency with a visible conflict comparison
- explicit legacy local-data import, separate Browserpläne and consent-based
  synchronization with account-scoped links and whole-plan conflict choices
  (ADR 0010, implemented through PRs #73–#79)
- scheduled consistent `pg_dump` backups, retention, health checks and restore
  tooling in the Compose backup service
- automated baseline: 183 test files with 1834 tests, counted by `bun run test`

### Still open, evidence-bound

- exact meaning and scoring of "Blöcke"
- external label and sign semantics (the last two `.rob` fields are clarified,
  see below)
- real place pre-position offset and safety clearance at the cell (simulation
  uses 80 mm and a provisional 10 mm, `src/domain/placeApproach.ts`)
- real robot kinematics beyond the UR10e lift cell (implemented in
  [#93](https://github.com/Snupai/palette_3d_viewer/issues/93)): UR20 with its
  own cell model, production collisions and gantry robots

## Guardrails

1. **Functional parity before UI parity.** The core flow must enable the same
   decisions; the web UI may stay more modern and compact.
2. **A broad candidate set instead of a single optimum.** Geometrically
   different patterns are retained even if piece count and block dimensions are
   equal.
3. **Deterministic and explainable.** Identical inputs produce the same
   candidates in the same order. Scores and exclusion reasons are visible.
4. **Pure domain core.** Geometry, solver, metrics, transformations and
   robotics stay separate from React and Three.js and are tested directly.
5. **Reference-driven parity.** Evidence is explicitly tracked as Golden,
   Observed or Open. Observations become Golden Cases only with an anonymized,
   executable basis; unresolved heuristics are not guessed or silently labeled
   compatible.
6. **Do not break existing `.rob` workflows.** Import, editing, round trip and
   the local library remain usable throughout the rework.

## Releases and milestones

Effort sizes are relative T-shirt sizes, not calendar commitments.

### R0 – Viewer/editor baseline

Status: available

The product can check, visualize, manage locally and to a limited extent edit
existing `.rob` plans. This remains the stable baseline for all subsequent
releases.

### M0 – Reference corpus and parity measurement

Status: completed · Effort: S · Dependency: none

Scope:

- assemble three to five anonymized/synthetic reference projects with inputs,
  expected metrics and machine-readable artifact references; reference
  screenshots and exports only where evidence is actually available;
- describe the run `AP5006 / 1329-00004` as the primary observed solver target
  case and promote it to Golden only with executable evidence;
- formally define candidate identity and geometric equality;
- document open `.rob` fields, "Blöcke" semantics and solver deviations;
- create a parity matrix per reference project.

Exit criteria:

- Expected values can be loaded automatically without committing private
  original data to the repository.
- For every later solver change it is measurable what moved closer to the
  reference cases and what got worse.

### M1 – Complete project and domain model

Status: implemented · Effort: M · Dependency: M0

Scope:

- versioned model for `Project`, `Package`, `Pallet`, `Gripper`,
  `PalletStation`, `Solution`, `LayerPattern`, `LayerStack` and `RobotCycle`;
- clear separation between the imported `.rob` source and the editable project;
- create/edit project dialog with cuboid, dimensions, weight, spacing, infeed
  direction and multi-gripping;
- EURO, industrial and custom pallets with overhang/underhang, stacking height,
  tare and maximum weight;
- schema migration of the existing IndexedDB data;
- portable JSON export/import as a backup and diagnostic format.

Exit criteria:

- A new project can be created, validated, saved and reopened without a
  `.rob`.
- Existing saved `.rob` plans remain readable and round-trip capable.

### M2 – Deterministic layer solver v1

Status: implemented · Effort: XL · Dependency: M1

Scope:

- 0°/90° rectangle packing within pallet, spacing and overhang;
- generators for row, block, edge and mixed patterns;
- generate symmetry variants, but remove only true geometric duplicates;
- stable candidate ID derived from placement geometry, orientation and grip
  data;
- metrics for piece count, area, block dimensions and preliminary cycle count;
- deterministic scoring and sorting;
- solver execution in a Web Worker with progress and cancellation;
- property-based checks for overlap, bounds and determinism.

Exit criteria:

- Every output is geometrically valid and reproducible for identical inputs.
- The reference case reaches 55 packages per layer.
- The solver retains several distinct 55-piece patterns. The observed
  `65 gesamt / 15 mit 55` (65 total / 15 with 55) is a parity target, but becomes
  a hard gate only once the underlying rules are sufficiently understood.

### M3 – Candidate browser and immediate visual comparison

Status: implemented · Effort: L · Dependency: M2

Scope:

- focusable, scrollable solution table with no., count, status, cycles, length
  and width;
- exact count filter, "Maximum" quick selection and a visible `x von y`;
- arrow up/down changes the active row and keeps it in the viewport;
- instant 2D thumbnails, metrics and a large 3D preview without re-running the
  solver;
- stable sorting and filter reset without losing candidates;
- diagnostic view for score and exclusion reasons.

Exit criteria:

- The visual comparison described in the specification is fully possible with
  mouse and keyboard.
- Switching candidates updates the visible previews without noticeable delay.

Outcome of M0–M3: **Planner Alpha**. From here on, a plan is created from input
data for the first time instead of only from a `.rob` import.

### M4 – Stack composition and production metrics

Status: implemented · Effort: L · Dependency: M3

Scope:

- select two layer patterns and combine them as a tower, longitudinal mirror,
  transverse mirror or rotation;
- derive the layer count from the stacking height limit, package height and interlayers;
- freely editable layer sequence;
- interlayer rules with thickness, bottom and top layer;
- a deviating top layer with its own candidate list;
- area/volume utilization, total weight, block dimensions and limit warnings;
- 3D options "raise top layer", top views and layer labels.

Exit criteria:

- The complete stack, metrics and warnings react consistently to every layer,
  interlayer or special-layer change.
- The example calculation `55 × 10 = 550` as well as height, area and volume
  are covered as Golden tests.

### M5 – Layer editor and sequence parity

Status: implemented · Effort: L · Dependency: M4

Scope:

- separate working modes for pattern, sequence and 2D flow check;
- Ctrl multi-selection, Shift box selection, centering and fine positioning;
- insert lengthwise/crosswise and change the label side;
- explicitly number, add and remove grip groups;
- automatic sequence as an editable suggestion;
- show pick/place TCP, angle, group and status step by step;
- extend the existing undo/redo and collision checks to all actions.

Exit criteria:

- An imported or computed layer can be fully modified without text editing and
  serialized back into a semantically equivalent `.rob` structure.
- The known 55-piece reference plan can be represented as 36 cycles with 19
  double and 17 single grips.

### M6 – Gripper, palletizing station and robot-valid export

Status: implemented internally, third-party semantics partially Open · Effort: XL · Dependency: M5

Scope:

- gripper library with TCP, envelope, angles, dimension limits and infeed
  direction;
- suction grippers first, clamp and fork grippers afterwards;
- palletizing station with origin, interference contour, TCP limits,
  directions, radius and infeed alignment;
- multipick grouping and pick/place TCP calculation;
- reach, envelope and simple collision checks;
- `.rob` export from the project model instead of a mere round trip;
- controlled comparison exports to verify the last two `.rob` fields and all
  sign conventions.

Exit criteria:

- Every exported cycle line is explainable from the project model and checked
  against Golden Files.
- Invalid gripper, angle, station or envelope combinations are blocked with a
  clear explanation before export.

Outcome of M4–M6: **Robot-ready Beta**. Plans can be designed, edited, checked
against robot constraints and exported deliberately.

### M7 – Robot simulation

Status: implemented · Effort: L · Dependency: M6

Scope:

- timeline of pick, transfer and place phases;
- start/stop, step, back, end and a speed control;
- gripper display for X/Y/Z/angle and the current group;
- fixed top, front and top-right views plus zoom;
- infeed conveyor, pallet, gripper and an initially simplified articulated arm;
- motion duration from configured speeds and pick/place times;
- gantry robots and detailed kinematics only after the flow has been verified.

Exit criteria:

- Every robot group can be played back deterministically forward and backward.
- Simulation and `.rob` export use exactly the same `RobotCycle` data.

### M8 – Report, project management and legacy compatibility

Status: implemented up to the documented evidence boundary · Effort: L to XL · Dependency: M6, M7 for the simulation part

Scope:

- project/product filter, sorting, duplication and **Speichern unter**;
- print view/PDF with 2D/3D image, metrics and robot cycles;
- import/export package for project, gripper and palletizing station;
- ~~optional, strictly read-only `.mpb` importer and `.mpb` writer~~ — dropped;
  the existing read-only v1 diagnostic boundary stays as implemented.

Exit criteria:

- A project can be searched, duplicated, portably backed up and shared as a
  report.
- Legacy imports openly flag unknown or unverified fields.

Outcome of M7–M8: **Parity Candidate** for the observed core workflow.

### M9 – Local backend with users on the LAN

Status: implemented, including ADR 0010 · Effort: L · Dependency: M8

The implemented backend is a server operated locally on the plant network (LAN),
through which several signed-in users work on shared projects. No cloud hosting,
no reachability from the internet. The binding decisions are in
[`docs/adr/`](docs/adr/), domain terms such as "Werkskatalog" in
[`GLOSSARY.md`](GLOSSARY.md).

Scope:

- a single host with PostgreSQL as a container (`compose.yaml`, Docker or
  Podman) under `DATABASE_URL`, Drizzle as the schema, migration and query
  layer; no distributed write instances; tests run against PGlite without a
  container
  ([ADR 0009](docs/adr/0009-postgres-container.md), supersedes ADR 0001);
  `bun run stack:up` (or `podman compose up -d --build`) starts the database,
  migrations and app as containers, `bun run db:up` + `bun run db:migrate`
  only the database for development, see README "Running the full stack
  in containers";
- a generic table for JSON records; the server checks stores, IDs,
  permissions, expected version, JSON structure and size limits, while the
  domain-level Zod validation stays in the client
  ([ADR 0004](docs/adr/0004-generic-planner-records.md));
- Next.js route handlers as a thin API for project and resource records;
- projects and the Werkskatalog can be read, searched and exported without
  signing in; only the creator and admins may edit and delete, and only admins
  may change the Werkskatalog; other users save their own copy
  ([ADR 0003](docs/adr/0003-public-project-reading.md));
- local user accounts with argon2-hashed passwords and an httpOnly session
  cookie that is always `Secure` outside of `localhost` and requires HTTPS
  ([ADR 0008](docs/adr/0008-https-authentication.md));
- the admin is created with `bun run admin:init` or its password reset with
  `bun run admin:reset-password`, with no public initial registration; further
  users are managed via `/admin` and `/api/admin/users`
  ([ADR 0005](docs/adr/0005-admin-initialization.md));
- writes and deletes atomically check the expected version; conflicts result in
  409 and a comparison view instead of a silent overwrite
  ([ADR 0006](docs/adr/0006-optimistic-concurrency.md));
- a client-side `ServerPlannerRecordStorage` implements the existing
  `PlannerRecordStorage` interface from `src/lib/projectRepository.ts` on top
  of these route handlers, so that `ProjectRepository` and the workspaces
  remain unchanged;
- explicit build mode: IndexedDB (default) or server, with no automatic
  fallback; server outages and session loss keep server drafts read-only with
  backups per server, user and project
  ([ADR 0002](docs/adr/0002-explicit-storage-mode.md));
- in server mode, never-signed-in or deliberately signed-out users may edit
  Browserpläne in the dedicated IndexedDB `pallets-db:browser`, separate from
  the legacy `pallets-db`, together with account-scoped sync links; sign-in
  offers synchronization with explicit publication consent (including original `.rob` text), whole-plan
  conflict choices and account-scoped links replacing confirmed local copies;
  the Werkskatalog stays admin-only and local deletions never delete server plans
  ([ADR 0010](docs/adr/0010-browser-local-plans.md));
- an explicit, repeatable import of the existing browser data after signing in,
  with an overview and confirmation of publication
  ([ADR 0007](docs/adr/0007-explicit-local-import.md));
- implemented consistent `pg_dump` backups in the Compose `backup` service:
  `scripts/pg-backup.sh` supports `loop`, `once`, `health` and `restore`, with
  script tests covering backup, retention and restore behavior; defaults are
  hourly (`PALETTE_BACKUP_INTERVAL_SECONDS=3600`) and seven days of retention
  (`PALETTE_BACKUP_RETENTION_DAYS=7`), with storage set by `PALETTE_BACKUP_DIR`;
  `bun run db:backup` takes an extra dump and
  `bun run db:restore <file> --yes` restores one
  ([ADR 0009](docs/adr/0009-postgres-container.md)).

The backend was implemented through the `area:backend` issues (#23–#38).
ADR 0010's Browserplan workflow (#72, foundation #65, implementation #66–#71)
is implemented through PRs #73–#79.

Remaining work: none.

Later steps:

- revisions or version history per project;
- field-level merging on version conflicts;
- share links for individual projects within the LAN;
- roles (e.g. read, edit, manage);
- sign-in with Windows/domain or Microsoft 365 accounts once the company
  identity infrastructure has been clarified.

Exit criteria:

- Two users on different machines on the LAN see the same server projects;
  without signing in, server projects and the Werkskatalog are read-only, and
  account data and internal administration data are not readable at all.
- Anonymous users can create, import, edit, duplicate and delete Browserpläne
  that survive reloads without server writes. Session loss never turns a server
  draft into a Browserplan. After sign-in, synchronization requires publication
  consent and explicit conflict choices; retries create no duplicates and
  confirmed plans leave the anonymous inventory. Local mode stays unchanged.
- Concurrent editing of the same project leads to a visible conflict, never to
  a silent overwrite.
- Without a configured backend, the app behaves unchanged, as with IndexedDB.
- Storage contract tests run against IndexedDB, memory and server storage.

## Technical target structure

```text
src/domain/
├─ project/        master data, validation, metrics
├─ geometry/       rectangles, transformations, collisions
├─ solver/         generators, deduplication, ranking
├─ stack/          layer sequence, interlocking, interlayers/special layers
├─ robotics/       gripper, station, cycles, limits
├─ formats/        internal schema and .rob adapters
└─ sheetExtraction/ sheet schema, prompts and validation

src/workers/       solver execution and progress
src/features/      project, candidates, editor, stack, robotics, simulation,
                   reporting, planning-case, planner, admin, auth, import
src/server/        auth, db, records (server-only)
src/app/api/       records, auth, admin, sheet-extraction
src/components/    reusable UI and existing viewer
```

`PalletData` initially remains the compatible viewer/editor DTO. The new
project model derives a targeted preview from it. This way the existing
viewer does not have to be rewritten at the same time as the solver.

## Parity scorecard

After every milestone, each reference case receives the same assessment:

| Dimension   | Measurement                                                      |
| ----------- | ---------------------------------------------------------------- |
| Input       | all observed fields modeled and validated                        |
| Geometry    | maximum piece count and existing pattern families                |
| Diversity   | number of distinct candidates with the same piece count          |
| Ranking     | position of the visually matching reference pattern              |
| Stack       | layer sequence, height, interlayers, weight and block dimensions |
| Robotics    | groups, sequence, TCP, angle and cycle count                     |
| Export      | semantic comparison of every `.rob` line                         |
| Usability   | core flow possible with mouse and keyboard without detours       |
| Performance | solver time and preview switching on the reference device        |

A feature does not count as "done" merely because the UI exists. It needs at
least one domain test, one reference case and visible error handling.

## Original start plan (completed)

These ten work packages were the recommended entry into M0–M3 and have been
implemented. The order remains documented as a record; it avoided an early
large-scale redesign of the existing UI.

1. define the anonymized Golden Case format and parity matrix;
2. design `Project` schema v2 including Zod validation and migration;
3. implement the `Project/Solution -> PalletData` adapter;
4. build the project and package dialog as a thin end-to-end slice;
5. add pallet templates, overhang and envelope validation;
6. implement pure metric functions for area, volume, height and weight;
7. test the canonical candidate ID and true geometric deduplication;
8. implement the first row/block pattern generator;
9. wire up the solver worker with progress, cancellation and deterministic
   sorting;
10. place the candidate table with count filter, `x von y` and arrow-key
    navigation in front of the existing 3D preview.

The first visible product increment ended at package 4: a project was created
without a `.rob` and displayed as a still-manual single-layer pattern in the
existing viewer. After that, the solver was added step by step without working
for long without a demonstrable end-to-end state. M9 and ADR 0010 are now
implemented; the remaining backend work is listed under M9.

## Open research questions

- exact meaning and scoring of "Blöcke"
- stability rules across adjacent layers
- exact label rules and their influence on candidate identity
- ~~meaning and sign of the last two `.rob` cycle fields~~ — clarified in
  [#96](https://github.com/Snupai/palette_3d_viewer/issues/96): `dx`/`dy`
  ∈ {−1, 0, 1} put the place pre-position at final + (dx, dy) · offset in
  pallet axes (not rotated with the place), raised by package height + a
  safety clearance; the robot then slides diagonally into the place, `0 0` is
  a vertical place. Offset and clearance at the real cell remain to be
  measured.
- gripper/station collision model and real kinematics

These questions run as a research track alongside product development. They
may refine milestones, but should only block the parts for which exact
compatibility is actually required.

## Deliberate non-goals

- pixel-accurate replication of existing desktop UIs
- gantry robots or photorealistic robot models
- `.mpb` import or writer (dropped; only the existing read-only diagnostic stays)
- automatic image similarity search
- complete collision kinematics
- cloud hosting, multi-tenant accounts reachable publicly over the internet, or
  SaaS operation (the local backend on the LAN is implemented as M9)

This keeps the focus on the unique selling point: generating many sensible
patterns, comparing them visually and quickly, and continuing to edit them with
robot awareness.
