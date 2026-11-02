# Block-plan golden fixtures

Pinned expected layouts for fixed palette/package/clearance inputs. All
coordinates are in 0.1 mm (dmm).

## `golden-pattern-100pk.blocks.json`

Expected Muster record for a 1200×800 mm palette, a 112×76 mm package and
zero clearance, after generation, replication/finalization and the
LaengsSpiegel Verbund mirror. The record holds `count: 100` entries, every one
a `1×1` block (per-package emission).

Fields per entry: `X`, `Y`, `dX`, `dY`, `xMax`, `yMax`, `XCount`, `YCount`,
`SubOrient`, `Orient`.

## `golden-pattern-100pk.json`

Compact placement view of the same layout: `entries` are
`[x, y, dX, dY, orient]`, exactly what the test compares after tiling and the
Verbund mirror. It also records `layerOrient` and a short `description`.

## `golden-pattern-44pk-underhang.json`

Expected layout for a 157×110 mm package (`1570×1100` dmm), zero clearance and
an underhang of -220 / -150 dmm. The pattern block is `11000 × 6910`, centered
on the full palette at `500/545`. The 7-package band has 10 dmm of slack; the
truncated edge-fill gap `10 div 6 = 1` places it at 1 dmm spacing and leaves
4 dmm at the far end. The same solution shape as below (type-2 band, then
type-1 band, LaengsSpiegel) produces it, and the enumerator finds it as
variant `bands:y:t2x3:t1x2`.

## Solution inputs

The 100-package layout uses a 1200×800 mm palette (`12000×8000` dmm), a
112×76 mm package (`1120×760` dmm) and zero clearance. The solution record
that produces it:

| input                              | value                                         | note                                                 |
| ---------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| palette                            | `12000 × 8000`                                |                                                      |
| block                              | `11400 × 7560`                                | offsets 300/220 from the palette margins             |
| package                            | length 1120, width 760                        |                                                      |
| clearance                          | 0                                             |                                                      |
| slot 1                             | simple, type 2, `0..11400 × 0..2240`, 15×2    | 30 packages with `dX=760`, `dY=1120`                 |
| slot 2                             | simple, type 1, `0..11400 × 2240..7560`, 10×7 | 70 packages with `dX=1120`, `dY=760`                 |
| `alignMode`                        | 1 (near X / near Y)                           | with Verbund 1; mode 0 without mirror gives the same |
| `layerOrient`                      | 2                                             |                                                      |
| `interactiveQuality`               | on                                            | per-package emission                                 |
| `replicate2x2` / `replicateMirror` | off                                           |                                                      |
| `swapEliminate`                    | off                                           |                                                      |
| Verbund                            | 1 (LaengsSpiegel)                             | `Y` values are mirrored around 8000                  |

Each alignment mode yields both layouts together with the matching Verbund
mirror (0 + Turm, 1 + LaengsSpiegel, 2 + QuerSpiegel, 3 + Rotiert): on a
centered block the far placement equals the reflection. The tests use mode 1 +
LaengsSpiegel and assert the equivalence.

`interactiveQuality` switches between per-package emission and block
emission. With alignment mode 1 and the LaengsSpiegel mirror the tiled
placements are the same either way, but the block-level assertions (100 / 44
one-package blocks, the block-for-block comparison) depend on it being on.

## Plan search

`planSearch.ts` implements the plan-search families, including the interlock
pinwheels, the nested kombi blocks and the stop-mode second pass. The tests
pin their output and check that every record tiles to its own package count
without overlaps. Notable details:

- The area bound that gates the pinwheel center block is
  `Trunc((A·B − corner waste) / (L·S))`.
- Scoring clears the tie flag and the type flags of the scored slots on every
  path, whether the candidate is stored or rejected.
- The stop-mode pass uses `j − S` as the near edge of its partial row instead
  of `(j − 1)·S`.

## Not covered by these fixtures

Both replication flags are off here, so the mirror axis is not exercised; see
`replication.ts`. Round/oval/complex packages and stored standard patterns
are unsupported; see `optimizer.ts`.
