# Candidate identity and geometric equality

As of: 14.08.2026

This definition applies to the reference corpus and the current solver. It separates
two questions that must not be confused with each other:

1. Are the same packages in the same positions? That is **geometric
   equality**.
2. Do two candidates additionally describe the same plan in terms of labels and
   gripping? That is **candidate identity**.

The contracts are versioned independently:

- `CANDIDATE_GEOMETRY_EQUALITY_VERSION = 1`
- `CANDIDATE_IDENTITY_VERSION = 1`

The executable definitions live in
`src/domain/solver/candidateIdentity.ts`. Every golden case with
candidate expectations names both versions explicitly. For an observed
third-party source, `null` means that its identity or
deduplication rules are unknown.

## Geometric equality v1

For each package, the tuple

```text
(x center, y center, orientation)
```

is formed. Two candidates are geometrically equal if and only if their sorted
tuple sets are exactly equal.

The following applies deliberately:

- Coordinates are compared exactly; there is no rounding or tolerance.
- `0°`, `90°`, `180°` and `270°` remain distinct, even for square
  packages. Orientation may later carry label or gripping meaning.
- Local placement IDs, array order, labels and grip groups are ignored for
  this one relation.
- Translation, mirroring, pallet rotation and other symmetries are not
  automatically treated as equal.
- Equal geometry explicitly does **not** claim equal robotic
  executability.

This narrow definition prevents the solver from removing genuine variants based on an
unresolved symmetry or label assumption.

## Base-layout selection classes

The final solver candidate index additionally merges variants that the
operator can set themselves per physical stack layer. This selection policy is
deliberately **not** a change to geometric equality v1 or
candidate identity v1.

For each validated placement set, a canonical base-layout key is formed over all
mirrorings and rotations that preserve the generation frame.
For this selection key:

- `0°` and `180°` describe the same physical package footprint;
- `90°` and `270°` describe the same physical package footprint;
- known label sides are carried along with the global transformation and
  remain part of the key;
- a base draft not produced by the symmetry generator is preferred as the
  directed representative;
- further generator and symmetry provenances are merged onto the
  representative.

The chosen representative keeps its exact directed
`geometryFingerprint`, its `candidateIdentityFingerprint` and the grip plan
derived from them. Mirroring along the pallet length or width and a
180° rotation are instead chosen per individual physical layer in the stack builder;
on materialization, the directed geometry together with the grip plan is
re-derived for this.

## Candidate identity v1

The identity contains the geometric tuples and additionally all known
operational details:

- known placement/execution order;
- label side per package;
- assignment and partition of the packages into grip groups;
- known grip order;
- pick and place coordinates including orientation;
- package count per grip;
- the unmodified `dx`/`dy` values.

Local IDs are canonicalized via geometry and group membership.
Renaming a placement or grip ID, as well as a different array order,
therefore does not change the identity.

Unknowns are treated conservatively:

| State                             | Meaning                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| Field missing                     | unknown                                                     |
| `null`                            | explicitly no assignment/no label                           |
| concrete value                    | known operational statement                                 |
| Grip reference without definition | unresolved reference; must not be silently treated as equal |
| missing `grips`                   | grip definitions unknown                                    |
| `grips: []`                       | grip definitions verifiably empty                           |

"Unknown" is not the same as "none". Likewise, equal geometries with
a different label, a different grip partition or a different known order remain
distinct candidate identities.

## Fingerprints and compact IDs

The canonical fingerprints contain the complete versioned content.
For tables and fixtures, a compact 64-bit FNV-1a ID is additionally
generated from them:

```text
candidate-v1-<16 hex characters>
geometry-v1-<16 hex characters>
```

The complete fingerprint is the authoritative basis for comparison. If
a hash collision is ever detected, two candidates must not be
merged; first the complete fingerprints must be compared,
and then the ID scheme must be versioned in a controlled manner.

## Version rule

A version must be incremented when a change can alter existing fingerprints or
the meaning of equality, for example through:

- coordinate tolerances or quantization;
- treating `0°` and `180°` as equal;
- new symmetry or mirroring rules;
- adding or removing label, order or grip data;
- changed handling of unknown fields.

A new version does not silently replace old corpus values. Golden cases are
explicitly migrated or keep their previous version so that solver changes
remain comparable.
