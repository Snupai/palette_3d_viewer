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

## Design

The UI follows the approved Fable v2 “Hallenboden” ("shop floor") design (epoxy-grey canvas,
kraft/wood pallet material, one Szaidel-navy `--brand` accent `#173159`, Barlow,
system light/dark); the former navy/steel corporate chrome is superseded. Tokens,
workflow rules, and banned patterns live in `docs/DESIGN.md`. Do not restore
skippable planning tabs, a Tools catalog, or a `.rob` “reference” overlay when the file is already the plan. Open a finished
project on its last completed step, not on Inputs. Editor, Robotics, Simulation,
and Report are gated by `productionToolGate` in `planningCaseModel.ts` — the
single prerequisite map; geometry review blocks Robotics, Simulation, and Report.
Do not duplicate gating inside tool overlays.

## Decisions and Glossary

Architecture decisions for the implemented LAN backend (M9: records, auth, admin API,
PostgreSQL) and browser-local plans with explicit sync live in `docs/adr/`.
Read the relevant ADR before changing storage, access, or sync: 0001–0008 cover
storage/access/concurrency/import/HTTPS; 0009 supersedes 0001 with PostgreSQL in
Docker/Podman; 0010 amends 0002/0007 with browser-local plans; 0011 amends 0006 with server
record tombstones and version continuity across delete/recreate. Changing a decision
means writing a new ADR, not silently diverging. Domain terms (e.g.
"Werkskatalog") are defined in `GLOSSARY.md` — use them consistently in code,
UI, and docs.

## Commands

| Purpose                                                                | Command                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Typecheck (run after **every** change, report the result)              | `bun run typecheck`                                                        |
| Lint + typecheck                                                       | `bun run check`                                                            |
| Tests (watch / once)                                                   | `bun run test` / `bun run test:run`                                        |
| Lint (check / fix)                                                     | `bun run lint` / `bun run lint:fix`                                        |
| Format (check / write)                                                 | `bun run format:check` / `bun run format:write`                            |
| Dev / build / build + serve / serve build                              | `bun run dev` / `bun run build` / `bun run preview` / `bun run start`      |
| Sheet-photo evaluation (needs absolute `SHEET_CORPUS_DIR`)             | `bun run sheet:eval`                                                       |
| External `.rob` corpus (opt-in, needs `ROB_CORPUS_DIR`)                | `bun run test:corpus`, `bun run corpus:rob`, `bun run corpus:rob:sentinel` |
| PostgreSQL container up / down (`CONTAINER_ENGINE=podman` for Podman)  | `bun run db:up` / `bun run db:down`                                        |
| Full stack in containers: db + migrate + app (`Dockerfile`, issue #49) | `bun run stack:up` / `bun run stack:down`                                  |
| PostgreSQL backup now / restore (hourly `backup` service, issue #38)   | `bun run db:backup` / `bun run db:restore <file> --yes`                    |
| DB migrations (generate from schema / apply to `DATABASE_URL`)         | `bun run db:generate` / `bun run db:migrate`                               |
| Admin account (ADR 0005, hidden prompt; containers: README)            | `bun run admin:init` / `bun run admin:reset-password`                      |

For deployment settings, consult `src/env.js`, `src/lib/sheetExtraction/sheetExtractionConfig.ts`
and `compose.yaml`: `NEXT_PUBLIC_PALETTE_STORAGE_MODE=local|server` is build-time;
server mode requires `DATABASE_URL`. Sheet extraction uses `SHEET_EXTRACTION_API`
(`ollama|openai`), `SHEET_EXTRACTION_URL` (`OLLAMA_URL` alias),
`SHEET_EXTRACTION_MODEL`, optional `SHEET_EXTRACTION_API_KEY`, and
`SHEET_EXTRACTION_MAX_CONCURRENT` (default 1 per process; saturation → 429).
`NEXT_PUBLIC_DISABLE_AI_FEATURES=true|1` hides photo import and disables its API at
build time. Compose uses `PALETTE_STORAGE_MODE`, `PALETTE_DISABLE_AI_FEATURES`,
`PALETTE_DB_PASSWORD` (URL-safe), `PALETTE_DB_PORT`, `PALETTE_APP_PORT`, and
`PALETTE_BACKUP_{DIR,USER,INTERVAL_SECONDS,RETENTION_DAYS}`; keep published ports
on localhost until HTTPS is configured (ADR 0008).

Session verification opportunistically purges expired sessions at most hourly per
process/database; cleanup failures do not reject valid sessions.

Stack: Next.js 15 App Router, React 19, Three.js, Tailwind v4, TypeScript, Zod;
T3 scaffold with Bun (`packageManager` pinned to `bun@1.3.14`). Vitest + Testing Library,
jsdom by default; add `// @vitest-environment node` for Node-only files.

## Architecture

Layering is enforced by direction: `domain` knows nothing about React, `features` compose
domain logic into workspaces, `components` render.

- **`src/domain/`** — pure logic, no React.
  - `solver/` — pattern generation (`generators`, `rectangularBlock`), validation, `metrics`, `labelOrientation`, ranking in `solve.ts`. Must stay deterministic and order-independent.
  - `stack/` — layer composition, interlayers, capacity, `materialize.ts`.
  - `robotics/` — grip grouping, cycle materialization, frames/poses, reach & collision `checks`, `timeline`, `robExport`. `ur10eKinematics` holds UR10e DH FK, analytic 8-solution IK and the URDF link chain of `public/models/ur10e/ur10e.glb`; `ur10eCell` holds the bundled lift-cell installation (base from the CAD mount, lift 0–900 mm, `GRIPPER_FLANGE_TO_SUCTION_MM`) and per-waypoint reach/limit/singularity/payload checks (warnings, `kinematics` phase). `features/robotics/cellKinematicsModel.ts` maps guided-plan cycles into the cell frame exactly like the simulation; the viewer poses the arm from the same IK.
  - `project/` — project schema v2, migration, factory, pallet templates, equipment profiles.
  - `sheetExtraction/` — sheet schema, prompt, validation; `lib/sheetExtraction/` handles model transport/config/evaluation, `/api/sheet-extraction` guards uploads and inference. Photos are not stored.
  - `geometry/`, `formats/` — canonical rectangle math; MPB v1.
  - `palletTypes.ts`, `robParser`-adjacent helpers, `gripDependencies`, `layerPatternPreview`.
- **`src/features/`** — workspaces and supporting flows: `project` (`PlannerProjectWorkspace` is the shell), `candidates`, `editor`, `stack`, `robotics`, `simulation`, `reporting`, `planning-case`, `planner`, `admin`, `auth`, `import`. Non-trivial state lives in a sibling `*Model.ts` that is unit-tested without rendering.
- **`src/features/import/`** — keep legacy local import (originals retained) separate from browser-plan sync. `BrowserSyncController`/`BrowserSyncOverview` coordinate explicit selection/consent; `browserSyncModel.ts` owns comparison, `keep-server` / `keep-mine` / `save-copy`, retries and retention. Confirmed sync removes the local payload, retains server/user-scoped version/hash links, and preserves newer concurrent local edits. Session/network loss stops uploads; catalog entries are not published by sync (ADR 0010).
- **`src/components/`** — `RobViewer.tsx` + `rob-viewer/` (scene builder/controller, picking, highlight, resources, camera presets, gripper & robot-cell loaders), `LayerEditor2D.tsx` + `layer-editor/`, `LayerSlider`, `LayerPattern`.
- **`src/lib/`** — `robParser.ts` (`.rob` parse/serialize + Z math), `projectAdapters.ts` (SavedPallet ⇄ project v2), `projectRepository.ts`, `plannerStorageFactory.ts` (`createPlannerRecordStorage` selects local/server primary storage; `createBrowserLocalPlannerStorage` explicitly selects browser plans), `storageMode.ts` (build mode + server URL validation), `plannerRecordStorage.ts`, `serverPlannerRecordStorage.ts` (records API), `storage.ts` / `plannerDatabase.ts` (legacy IndexedDB `pallets-db`), `browserPlanStorage.ts` (`BrowserLocalPlannerStorage`, separate `pallets-db:browser` with sync-link metadata). Server errors/session loss never reroute server saves to browser storage (ADR 0002/0010). `parity/` and `parityGoldenCase.ts` cover the corpus harness.
- **`src/i18n/`** — UI languages (`de` source, `en`; add more in `locales.ts` + `messages/<locale>/`). `LocaleProvider` sits in the root layout, resolves stored choice → system language → `de`, persists to localStorage and exposes `useT()` / `useLocale()`. Messages are flat, namespace-prefixed keys in one file per feature under `messages/de|en/`; English files use `satisfies` against the German key set, so missing keys fail `tsc`. Non-React model code takes a `t: Translate` parameter (tests use `translateDe`); `src/domain` diagnostics stay English and untranslated. Without a provider `useT()` returns German, which is what unit tests rely on.
- **`src/server/`** — server-only code (never import from client components). `db/database.ts` exposes `openDatabase(url)` → `{ db, migrate(), close() }` (postgres.js) and `openMigratedDatabase`; repositories take the driver-neutral `PlannerDatabase` type. `db/serverDatabase.ts` lazily caches the route database; local mode returns `null` and records/auth/admin routes answer 404. `records/recordRepository.ts` enforces record structure, ownership and optimistic versions; client code validates domain payloads. Routes: `/api/records/[store]` and `/api/records/[store]/[id]`, `/api/auth/{login,logout,me}`. Tables live one per file in `db/schema/` (re-exported from `db/schema/index.ts`), generated migrations in `drizzle/`. Tests use `db/testing.ts` (`openMigratedTestDatabase()`, PGlite, same migrations) — never a running container (ADR 0009). `auth/sessionUser.ts` handles request sessions and public user projection; `auth/userModel.ts` defines roles and username normalization. `auth/loginRateLimit.ts` bounds failed login attempts in process (5 per normalized username, 30 per address per 15 minutes; injected clock). `loginHandler.ts` applies it before password verification; only explicitly trusted, overwritten proxy headers identify clients (see deployment guide). `auth/` holds local accounts (ADR 0005/0008): `password.ts` (argon2id via `@node-rs/argon2`), `sessionToken.ts` (random token, only its SHA-256 is stored; `Secure` cookie except dev on localhost), `accounts.ts` (users, session create/verify/revoke/revoke-all; password reset revokes sessions; login re-checks the verified hash so a concurrent reset wins), `adminCli.ts` (`admin:init` / `admin:reset-password` logic with an injected prompt; `scripts/admin.ts` is the thin entry), `passwordStrength.ts` (admin-chosen password rules as codes, shared by the CLI and `/api/admin/users`). Account deletion (#86) lives in `auth/deleteUser.ts`: lock admin rows in ID order, recheck the actor, protect self/last admin, cascade sessions and retain records with a null creator (ADR 0005 addendum); no migration. Admin API (#32): `src/app/api/admin/` behind `requireAdmin` (401/403/404); screen at `/admin` with state in `features/admin/adminUsersModel.ts`.
- **`src/workers/`** — use `solverClient.ts` + `solverProtocol.ts` for the solver; use `docAlignerClient.ts` + `docAlignerProtocol.ts` for document alignment in `docAligner.worker.ts`. Keep worker details behind these clients.

`RobViewer` and `LayerEditor2D` are loaded via `next/dynamic` with `ssr: false`; anything
that must survive server rendering (report/preview markup) has to stay free of
`document`/canvas/WebGL.

## `.rob` Format and Geometry

- Layout: line 0 pallet dims, line 1 package dims with an optional 4th input-direction flag (`1` = packages arrive rotated 90°), line 2 unique layer count, line 3 total layer count, then one layer-order row per layer whose second column is the Zwischenlage (interlayer) flag, then per-layer coordinate blocks.
- Blank lines are positionally significant and must not be filtered out during parsing; numeric fields are integer-based and parser errors include line numbers.
- Each coordinate line holds x, y, rotation (0/90/180/270), package count, and dx/dy (fields 8/9); a multi-package line is a single grip, so all its boxes share the same `placeX`/`placeY`; clicking a box highlights the whole grip and shows place coords.
- Fields 8/9 (`dx`, `dy` ∈ {−1, 0, 1}, #96) are the place pre-position: pre-position XY = final XY + (dx, dy) · `PLACE_APPROACH_OFFSET_MM` (80 mm; the real cell usually uses less) in pallet axes, not rotated with the place rotation; Z = place Z + package height + `PLACE_APPROACH_CLEARANCE_MM` (provisional 10 mm). The robot slides diagonally from there into the place (`place-slide`); `0 0` is a vertical place. Both constants live in `src/domain/placeApproach.ts` and are shared by the editor sweep and the robot route/simulation. Projects store the raw values as `placeApproachDirection: { dx, dy }` (schema v5; v4 `labelOffset` is migrated); export writes them unchanged. The editor still derives new grips' dx/dy from the label side — external label semantics remain open.
- Bottom-face Z (`layerZBottom`) is the sum of package heights below plus Zwischenlagen (3 mm each, `ZWISCHENLAGE_HEIGHT_MM`, matching the robot's `Dicke_ZwLagen`); robot place Z (`layerPlaceZ`) is bottom-face Z plus the current package height (top of the box); pallet height is excluded.
- Selection marker is the gripper OBJ+MTL under `public/models/gripper/` (Y-up CAD → scene Z-up); strip OBJ `l` edge lines for a solid look, but do not dispose shared MTL materials when removing those lines; use ~30% opacity; rotate yaw 90° when the grip is a single package and package length is below 265 mm.
- Saved pallets keep their raw `.rob` text and are re-parsed on load so older entries pick up newer parser fields.
- Imported raw text is retained verbatim (`source.rawRobText`) and must never be rewritten by editor commands — only project-derived exports are regenerated.

## Testing Policy

The suite contains 1914 tests in 191 files (2 tests and 1 file skipped) and is
deliberately behaviour-first. Keep it that way:

- **Test the model, not the DOM.** Prefer `*Model.ts` / domain unit tests. Reach for
  Testing Library only for flows that are genuinely UI-level (drawer guards, unsaved-change
  confirms, cross-workspace session state). Full `PlannerProjectWorkspace` renders cost
  ~1.3 s per test — three such files exist (`.editor`, `.generator`, `.robotics`); extend them before adding another.
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
