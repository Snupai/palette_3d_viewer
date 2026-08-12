# Pallet 3D Viewer

Import, inspect, and edit `.rob` pallet plans in the browser.

## Features

- Create, validate, persist, duplicate, filter, and portably export planner projects
- Deterministic row/block/edge/mixed layer solver in a cancellable Web Worker
- Accessible candidate browser with count filters, diagnostics, SVG thumbnails,
  keyboard navigation, and immediate Three.js preview
- Compose editable stacks with two patterns, transforms, special top layers,
  variable interlayers, capacity, utilization, weight, and boundary warnings
- Pattern, order, and flow editing with shared undo/redo, multi-selection, labels,
  grip groups, dependency-aware sequencing, and canonical RobotCycle inspection
- Gripper/station resources, reach/envelope/collision diagnostics, validated
  project-derived `.rob` export, deterministic simulation, and printable reports
- Safe portable project/resource packages and read-only, explicitly unverified
  `.mpb` envelope diagnostics
- Existing `.rob` import, local library, original/edited text, 2D editor, and
  Three.js viewer retained as a separate compatible workflow

## Roadmap

The prioritized path from the current `.rob` viewer/editor to a complete
MultiPack-like pallet planner is documented in [ROADMAP.md](ROADMAP.md).
The evolving reference-case scorecard is documented in
[docs/PARITY.md](docs/PARITY.md).
The versioned planning domain and its `.rob` compatibility mapping are
documented in [docs/PROJECT_MODEL.md](docs/PROJECT_MODEL.md). Candidate identity
and geometric equality are specified in
[docs/CANDIDATE_IDENTITY.md](docs/CANDIDATE_IDENTITY.md); open format and solver
questions are tracked in the dated
[parity research log](docs/research/2026-08-05-parity-research-log.md).

## Requirements

This project uses [Bun](https://bun.sh/) as its package manager. The pinned
version is `bun@1.3.14`, as declared by the `packageManager` field in
`package.json`.

## Development

```sh
bun install
bun run dev
```

Open `http://localhost:3000`. Create a planner project from the default workspace,
or switch to the legacy `.rob` workspace to import an existing plan.

Available verification commands:

```sh
bun run test:run
bun run typecheck
bun run lint
bun run format:check
bun run build
```

## External `.rob` corpus parity

The optional corpus harness reads an external directory only when
`ROB_CORPUS_DIR` is set to an absolute local directory. It does not copy source
text into the repository, and generated JSON reports are written only under the
ignored `.rob-corpus/` directory. Reports retain file basenames, byte and
semantic digests, structured evidence, and aggregate package/pallet families;
they do not retain the configured root or any absolute source path.

```sh
ROB_CORPUS_DIR="<absolute-local-directory>" bun run corpus:rob
ROB_CORPUS_DIR="<absolute-local-directory>" bun run test:corpus
```

`corpus:rob` writes a local report and exits nonzero when a `FAIL` check is
recorded. `test:corpus` exercises the configured external corpus without
writing a report. When `ROB_CORPUS_DIR` is unset, the external Vitest case is
skipped cleanly, including during the normal test suite.

The named solver scenarios are conservative: `nominal-strict-v1` uses encoded
pallet dimensions, zero clearance, and no policy overhang;
`observed-envelope-v1` uses measured source extents as an observation only and
never converts them into allowed-overhang policy. Source grip/cycle metrics are
reported separately as observed and generated robotics parity remains blocked
until group planning is available.

## Supported `.rob` invariants

- Blank lines are positionally significant and are preserved while parsing.
- Package coordinates are integers.
- Supported package rotations are `0`, `90`, `180`, and `270` degrees.
- Each `Zwischenlage` contributes 3 mm to the stack height.
- Imported raw text is retained so plans can be parsed again and round-tripped
  without discarding source formatting.

## Stack

Next.js 15 App Router, React 19, Three.js, Tailwind CSS 4, TypeScript, and
Vitest.

## License

[MIT](LICENSE)
