# AGENTS.md

Palletizing planner: parses/writes legacy `.rob` robot plans, generates layer patterns
with a deterministic solver, stacks them into pallets, derives robot cycles, and renders
everything in a Three.js viewer.

## Learned User Preferences

- Writes prompts in German (mixed with English technical terms) and expects answers in German.
- Iterates on UI in small steps with short corrections; apply the smallest targeted change instead of redesigning the component.
- References ChatGPT's UI as the design target (e.g. the conversation/prompt navigation rail for the layer slider); when markup is pasted, match its structure and sizing closely.
- Dislikes wireframe rendering for hidden or above-cutoff layers; prefer hiding them or using subtle opacity.
- Hover magnification should push neighbouring items apart, but spacing must be tuned so the first and last item stay visible when hovering near the ends.
- Layer-rail hit targets should extend beyond the visible tick marks so clicking is easier.
- Clickable elements must show a pointer/hand cursor.
- Wants compact status readouts next to controls (e.g. a `3/4` current-layer indicator below the slider).
- Clicking a package should set the visible-layer cutoff to that package's layer (e.g. click on layer 2 → show only layers 1–2).
- Expects a typecheck run after each change, with the result reported.
- Gripper selection marker should stay semi-transparent (~30% opacity), not solid.

## Commands

| Purpose                                                   | Command                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Typecheck (run after **every** change, report the result) | `npm run typecheck`                                                        |
| Lint + typecheck                                          | `npm run check`                                                            |
| Tests (watch / once)                                      | `npm run test` / `npm run test:run`                                        |
| Format                                                    | `npm run format:write`                                                     |
| Dev server                                                | `npm run dev`                                                              |
| External `.rob` corpus (opt-in, needs `ROB_CORPUS_DIR`)   | `npm run test:corpus`, `npm run corpus:rob`, `npm run corpus:rob:sentinel` |

Stack: Next.js 15 App Router, React 19, Three.js, Tailwind v4, TypeScript, Zod;
T3 scaffold with Bun (`packageManager` pinned to `bun@1.3.14`). Vitest + Testing Library,
jsdom by default; add `// @vitest-environment node` for Node-only files.

## Architecture

Layering is enforced by direction: `domain` knows nothing about React, `features` compose
domain logic into workspaces, `components` render.

- **`src/domain/`** — pure logic, no React.
  - `solver/` — pattern generation (`generators`, `rectangularBlock`), validation, `metrics`, `labelOrientation`, ranking in `solve.ts`. Must stay deterministic and order-independent.
  - `stack/` — layer composition, interlayers, capacity, `materialize.ts`.
  - `robotics/` — grip grouping, cycle materialization, frames/poses, reach & collision `checks`, `timeline`, `robExport`.
  - `project/` — project schema v2, migration, factory, pallet templates, equipment profiles.
  - `geometry/`, `formats/` — canonical rectangle math; MPB v1.
  - `palletTypes.ts`, `robParser`-adjacent helpers, `gripDependencies`, `layerPatternPreview`.
- **`src/features/`** — one folder per workspace: `project` (`PlannerProjectWorkspace` is the shell), `candidates`, `editor`, `stack`, `robotics`, `simulation`, `reporting`, `planning-case`, `legacy-plan`, `legacy-mpb`. Non-trivial state lives in a sibling `*Model.ts` that is unit-tested without rendering.
- **`src/components/`** — `RobViewer.tsx` + `rob-viewer/` (scene builder/controller, picking, highlight, resources, camera presets, gripper & robot-cell loaders), `LayerEditor2D.tsx` + `layer-editor/`, `LayerSlider`, `LayerPattern`.
- **`src/lib/`** — `robParser.ts` (`.rob` parse/serialize + Z math), `projectAdapters.ts` (SavedPallet ⇄ project v2), `projectRepository.ts`, `storage.ts` / `plannerDatabase.ts` (IndexedDB), `parity/` (corpus harness), `parityGoldenCase.ts`.
- **`src/workers/`** — solver runs off the main thread; `solverClient.ts` + `solverProtocol.ts` are the only supported entry points.

`RobViewer` and `LayerEditor2D` are loaded via `next/dynamic` with `ssr: false`; anything
that must survive server rendering (report/preview markup) has to stay free of
`document`/canvas/WebGL.

## `.rob` Format and Geometry

- Layout: line 0 pallet dims, line 1 package dims with an optional 4th input-direction flag (`1` = packages arrive rotated 90°), line 2 unique layer count, line 3 total layer count, then one layer-order row per layer whose second column is the Zwischenlage flag, then per-layer coordinate blocks.
- Blank lines are positionally significant and must not be filtered out during parsing; numeric fields are integer-based and parser errors include line numbers.
- Each coordinate line holds x, y, rotation (0/90/180/270), package count, and dx/dy encoding the blue-line side or corner; a multi-package line is a single grip, so all its boxes share the same `placeX`/`placeY`; clicking a box highlights the whole grip and shows place coords.
- Bottom-face Z (`layerZBottom`) is the sum of package heights below plus Zwischenlagen (3 mm each, `ZWISCHENLAGE_HEIGHT_MM`, matching the robot's `Dicke_ZwLagen`); robot place Z (`layerPlaceZ`) is bottom-face Z plus the current package height (top of the box); pallet height is excluded.
- Selection marker is the gripper OBJ+MTL under `public/models/gripper/` (Y-up CAD → scene Z-up); strip OBJ `l` edge lines for a solid look, but do not dispose shared MTL materials when removing those lines; use ~30% opacity; rotate yaw 90° when the grip is a single package and package length is below 265 mm.
- Saved pallets keep their raw `.rob` text and are re-parsed on load so older entries pick up newer parser fields.
- Imported raw text is retained verbatim (`source.rawRobText`) and must never be rewritten by editor commands — only project-derived exports are regenerated.

## Testing Policy

The suite is ~438 tests in 85 files and is deliberately behaviour-first. Keep it that way:

- **Test the model, not the DOM.** Prefer `*Model.ts` / domain unit tests. Reach for
  Testing Library only for flows that are genuinely UI-level (drawer guards, unsaved-change
  confirms, cross-workspace session state). Full `PlannerProjectWorkspace` renders cost
  ~1.3 s per test — four such files already exist; extend them rather than adding a fifth.
- **Assert exact numbers.** Existing tests pin literal geometry (`boundingBlockAreaMm2 === 120`,
  camera target `[600, 400, 378]`, "55 placements → 36 cycles"). Follow that; avoid
  `toBeGreaterThan`-style assertions that pass on regressions.
- **Determinism is a feature.** Solver tests assert independence from generator order and
  progress batching. Any new solver path needs that guarantee.
- **Don't test the platform.** No assertions about Node `crypto`, `JSON`, or framework
  behaviour — only project logic.
- **Seeded property tests are allowed but budgeted.** `solver.test.ts` alone is ~37 % of
  total runtime; do not add more `O(n²)` sweeps there without trimming cases.
- **`// @vitest-environment node`** for anything touching `node:fs`/`node:crypto`
  (parity, digests, discovery, bundled asset checks).

## Corpus Privacy

Real customer `.rob` files are **not committed** — they live in the user's local pallet-plan
folders outside the repo and are reached only through `ROB_CORPUS_DIR`. The parity harness
enforces this and the enforcement is tested: reports must never contain `rawText`,
`sourceText`, or absolute corpus paths; discovery rejects non-absolute roots, symlinked
directories, forged descriptors, and oversized entries; sentinel manifests are hash-only and
basenames are anonymized. Never weaken those gates, and never paste corpus content into
fixtures, logs, or commit messages.
