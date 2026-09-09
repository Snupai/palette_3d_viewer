# Standalone ring, edge-strip, and unequal-step search

Work in progress. The solver does **not** yet reproduce every Multipack solution.
The comparison comprises 304 captured synthetic solutions across four inputs;
matching maximum package counts alone is not sufficient evidence of parity.

## Closing verification

The final production-solver comparison on 2026-09-09 reproduces **206 / 304**
reference layouts. All 144 previously matched layouts are retained; 62 more
are now available. **98 reference layouts remain unmatched.**

| Package footprint | Matched / reference | Remaining | Maximum packages |
| --- | --- | --- | --- |
| 135 × 91 | 35 / 56 | 21 | 73 |
| 147 × 104 | 36 / 65 | 29 | 59 |
| 158 × 78 | 92 / 112 | 20 | 70 |
| 177 × 123 | 43 / 71 | 28 | 42 |

These are complete `solveLayer` runs with identity equivalence, the production
region-search budget, and 500 drafts per generator. They are not sums of raw
generator-only experiments. Local synthetic comparison artifacts are named
`final-135.json`, `final-147.json`, `final-158.json`, and `final-177.json`.

The final focused run passes 34 tests across mosaic grids, variable staircases,
slice grids, staircase grids, and candidate finalization. Lint and typecheck
pass. The eight seeded geometry cases also passed after collecting collision
failures rather than creating an assertion for each pair. Fresh solver runs
confirm candidate inventories of 369 for the 102-package case, 552 for the
101-package case, and 133 maximum-count candidates for the observed 55-package
case. Their exact inventory assertions and narrowly scoped timing allowances
were updated. **The complete regression suite has not been rerun after the
final changes.**

Remaining work: reproduce the 98 missing layouts, run the full regression suite,
and reduce search/finalization cost. Reaching the four reference maxima is not
an optimality proof or an exhaustive-pattern guarantee.

## Inputs and comparison contract

All four cases use a 1200 × 800 mm physical pallet. Negative underhang values
reduce the total length or width once, rather than once on each side.

| Package footprint | Total underhang L / W | Generation bounds | Reference solutions |
| --- | --- | --- | --- |
| 135 × 91 | −17 / −34 | 1183 × 766 | 56 |
| 147 × 104 | −24 / −29 | 1176 × 771 | 65 |
| 158 × 78 | −52 / −10 | 1148 × 790 | 112 |
| 177 × 123 | 0 / −23 | 1200 × 777 | 71 |

The separate photographed 158 × 82 mm carton remains a different case.
Comparison uses `matchPhysicalFootprintPlacements` with the existing 0.500001 mm
tolerance, physical coordinates, and footprint orientation. The comparison does
not translate, reflect, or rotate a candidate to make it match a source.

## Added geometric constructions

- `rounded-slice` retains boundary-clamped and fractional-pitch distribution
  separately from `slice-grid`. Putting new rounding variants inside the old
  family's bounded inventory displaced its previously available last candidate.
- `capped-ring` permits an outer cap wider than the compact four-arm ring below
  it. The cap and the ring retain independently derived grid dimensions. Its
  structural partitions are discovered before reflection expansion, including
  transposed layouts with a shorter ring aligned against a taller side grid.
- `anchored-ring` places the opposite crosswise arm against the outer edge.
  Its center can consequently be wider than the bottom normal arm suggests.
  Root widths are derived from feasible mixed-orientation spans.
- `nested-edge` explores a mixed strip at either outside edge of a uniform
  parent grid, distributing the child's residual space along both axes.
- `staircase-variable` uses three crosswise steps with independently sized first
  arms. The right-hand normal grid ends at the second step's lower edge, so a
  shorter first arm leaves a derived gap instead of forcing overlapping boxes.
  Mixed spans can enlarge either root dimension; shared rows or columns absorb
  the resulting residual space without breaking adjacent pickup groups.

Each construction uses dimensions and constraints from its input. No Multipack
process, captured coordinates, product identifier, or capture file is consulted
at runtime. Reflections, clearance, allowed rotations, count bounds, cancellation,
and work limits remain part of generation and validation.

## Search and verification notes

The 500-candidate family limit is not an exhaustive search guarantee. Enumerating
all reflections or all center alignments before other partitions can consume it
prematurely. Partition sampling therefore precedes repeated alignments in the new
searches. Increasing the limit alone does not recover missing constructions.

New tests pin complete synthetic coordinates for a wider cap, an anchored core,
a 70-package nested edge strip, fractional pickup-pitch rounding, and an unequal
70-package staircase. Clearance and reversed rotation enumeration are checked.
The orchestration test reverses `BASE_GENERATOR_FAMILIES` itself so future added
families cannot silently be omitted from the order-independence check.

Finalization caches immutable draft sort keys and prepared candidates within a
single run. Identical directed, labeled placements share validation, grouping,
and metric calculation while every draft still contributes provenance and
duplicate statistics. Cache entries do not persist between solver inputs.

Do not promote raw generator matches to a claim that all 304 solutions are
available. Final acceptance still requires the complete production-solver
comparison, preservation of prior matches, and successful relevant tests.
