# Project v2 Domain Model

As of: 05.08.2026

`ProjectV2` remains the compatible contract for the existing fixtures and
`.rob` adapters. The canonical working and storage format is the current project
version explicitly migrated from it. It adds individual package placements and
robot cycles without reinterpreting the V2 contract. The previous `PalletData`
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

This lets the project form and solver build incrementally on the current project
model without rewriting the stable `.rob` workflow at the same time.

## Persistence and portable backup

The existing IndexedDB `pallets-db` keeps the `pallets` store unchanged. In
addition, there are separate stores for projects, reusable resources and
quarantine records. Loading and importing go through a safe version switch;
unknown or corrupted records are quarantined with path diagnostics instead of
being silently reinterpreted.

The migration from `SavedPallet` generates deterministic placement and cycle
IDs. It copies into the project store and does not delete the `.rob` source
record. Portable JSON packages can contain multiple projects as well as pallet,
gripper and palletizing station resources, and support the conflict rules
`skip`, `overwrite` and `rename`.
