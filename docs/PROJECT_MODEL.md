# Project Domain Model (schema v4)

As of: 06.11.2026

`ProjectV2` remains the compatible contract for the existing fixtures and
`.rob` adapters. The canonical working and storage format is the current project
schema version 4, explicitly migrated from v2 or v3. It adds individual package
placements and robot cycles without reinterpreting the V2 contract. The previous `PalletData`
remains a compatible DTO for `.rob`, the viewer and the layer editor for the time
being.

## Covered areas

- Project and product number as well as creation/modification time
- Origin as a new project or `.rob` import
- Package with shape, dimensions, weight, spacing, infeed direction, label sides
  and multi-gripping
- Pallet with type, dimensions, stacking clearance, overhang/underhang, tare and
  maximum weight
- Gripper including TCP, envelope, angles, dimension limits and type-dependent
  fields
- Palletizing station including origin, interference/TCP contour, directions and
  radius
- multiple solutions with individual package placements, layer patterns,
  versioned layer stacks, robot cycles and the complete layer sequence
- selected gripper, palletizing station and active solution via validated
  references

Among other things, the schema validates unique IDs, all cross-references,
timestamps, min/max ranges, pallet weight and preferred palletizing direction.

## Dimension axes

The project model uses domain-unambiguous names:

```text
dimensionsMm.length × dimensionsMm.width × dimensionsMm.height
```

The historical `PalletData`, by contrast, adopts the order of the `.rob` rows in
the fields `width × length × height`. The adapter therefore applies:

| Project model | `.rob`/viewer DTO               |
| ------------- | ------------------------------- |
| `length`      | `width` or first `.rob` field   |
| `width`       | `length` or second `.rob` field |
| `height`      | `height` or third `.rob` field  |

This mapping is tested by a semantic import-project-viewer round trip.

## Imported legacy plans

A `.rob` import does not contain all project data. The adapter therefore
explicitly marks the following values as unknown instead of guessing them from
file names or geometry:

- Weight
- Pallet stacking clearance
- Tare and maximum gross weight
- Palletizing direction
- Gripper definition and palletizing station
- Project name

Package and pallet dimensions, infeed direction, layer patterns, pick/place
values, grip groups, sequence and interlayers are carried over. The file name
without `.rob` is used as a provisional product number.

## Compatibility flow

```text
SavedPallet / .rob
        │
        ▼
savedPalletToProjectV2
        │
        ▼
ProjectV2 ── migrateProject ──▶ current Project
        │                              │
        └── projectSolutionToPalletData ◀┘ ──▶ existing viewer/editor
```

`migrateProject` dispatches v2 records to `migrateProjectV2` and v3 records to
`migrateProjectV3`; both produce the current v4 schema. Current v4 records are
validated directly. Both migration paths seed the built-in default gripper and
palletizing station only for `new` projects with empty equipment lists and no
selected equipment. Imported or already configured equipment is preserved.

This lets the project form and solver build incrementally on the current project
model without rewriting the stable `.rob` workflow at the same time.

## Persistence and portable backup

`NEXT_PUBLIC_PALETTE_STORAGE_MODE` selects `local` (the default) or `server`.
There is no fallback between modes; server mode requires a PostgreSQL
`DATABASE_URL`. Server records live in PostgreSQL `planner_records`, keyed by
store and record ID, with a `jsonb` payload in `json` and an integer `version`
for optimistic concurrency (ADR 0009/0006).

Local mode uses IndexedDB `pallets-db`. It keeps the `pallets` store unchanged,
alongside `projects`, `project-resources`, `project-quarantine`,
`legacy-migrations` and storage-internal `record-versions`.

In server mode, anonymous browser plans use the separate IndexedDB database
`pallets-db:browser`, with the same stores plus `browser-plan-metadata`
(ADR 0010). This is an explicit browser-local inventory, not a fallback for
server errors or session loss. Browser plans become server records only through
a consented sync in `browserSyncModel`. Metadata keeps sync links containing
`{serverId, syncedVersion, syncedContentHash, syncedAt}`, scoped by `server`
and `userId`, to compare later local and server changes.

Loading and importing go through a safe version switch;
unknown or corrupted records are quarantined with path diagnostics instead of
being silently reinterpreted.

The migration from `SavedPallet` generates deterministic placement and cycle
IDs. It copies into the project store and does not delete the `.rob` source
record. Portable JSON packages can contain multiple projects as well as pallet,
gripper and palletizing station resources, and support the conflict rules
`skip`, `overwrite` and `rename`.
