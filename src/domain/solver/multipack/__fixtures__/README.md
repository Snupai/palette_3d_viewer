# MultiPack golden fixtures

## `golden-pattern-100pk.blocks.json`

Verbatim copy of `analysis/golden_pattern_100pk.json` from the reverse-engineering
workspace. It is the live `mpick32.exe
2.1.315.25` Muster record captured at address `0xa13f780` after generation,
replication/finalization and the Verbund mirror. The record holds `count: 100`
entries, every one a `1×1` block. The record has the `MakeMPMuster` shape,
which re-exports the tiled package list and is always `1×1`, so it does not
show whether the optimizer itself emitted blocks or single packages.

Fields are the raw 29-byte Muster record: `X`, `Y`, `dX`, `dY`, `xMax`,
`yMax`, `XCount`, `YCount`, `SubOrient`, `Orient`, all in 0.1 mm.

## `golden-pattern-100pk.json`

Compact placement view of the same capture: `entries` are
`[x, y, dX, dY, orient]`, exactly what the parity test compares after tiling
and the Verbund mirror. It also records the capture source and `layerOrient`.

## `golden-pattern-44pk-underhang.json`

Second live capture (address `0xa154ce0`, same build, same `MakeMPMuster`
shape) with a 157×110 mm package (`1570×1100` dmm), zero clearance and the
underhang globals `0xd277c8 = -220` / `0xd27a2c = -150`. The pattern block is
`11000 × 6910`, centered on the full palette at `500/545`. The 7-package band
has 10 dmm of slack; the truncated edge-fill gap `10 div 6 = 1` places it at
1 dmm spacing and leaves 4 dmm at the far end. The same solution shape
as below (type-2 band, then type-1 band, LaengsSpiegel) reproduces it, and
the enumerator finds it as variant `bands:y:t2x3:t1x2`.

## Reverse-fitted inputs

The capture came from a 1200×800 mm palette (`12000×8000` dmm) with an
112×76 mm package (`1120×760` dmm) and zero clearance. The solution record
that reproduces it:

| input                              | value                                         | evidence                                           |
| ---------------------------------- | --------------------------------------------- | -------------------------------------------------- |
| palette                            | `12000 × 8000`                                | runtime globals `00d26d7c` / `00d288e8`            |
| block                              | `11400 × 7560`                                | offsets 300/220 and the palette margins            |
| package                            | length 1120, width 760                        | block candidates `0x10df8cc / 0x10df8d0`           |
| clearance                          | 0                                             | runtime global `0x10df778`                         |
| slot 1                             | simple, type 2, `0..11400 × 0..2240`, 15×2    | 30 packages with `dX=760`, `dY=1120`               |
| slot 2                             | simple, type 1, `0..11400 × 2240..7560`, 10×7 | 70 packages with `dX=1120`, `dY=760`               |
| `alignMode`                        | 1 (near X / near Y)                           | with Verbund 1; mode 0 without mirror fits as well |
| `layerOrient`                      | 2                                             | `Muster[2]` in the capture                         |
| `interactiveQuality`               | on                                            | not determined by the capture (see above)          |
| `replicate2x2` / `replicateMirror` | off                                           | runtime globals `00d28de4` / `00d277e0` = 0        |
| `swapEliminate`                    | off                                           | control-file caller `0x00ca746b` pushes 0          |
| Verbund                            | 1 (LaengsSpiegel)                             | captured `Y` values are mirrored around 8000       |

`AddBlock` alignment is the optimizer's `param_2` (`EDX`, stored at
`EBP-0x9d`). The control-file caller `0x00ca746b` passes `EDX=0`, while the
preview/three-variant callers (`0x00cb71ec`, `0x00a42c94`) forward their own
value. Each alignment mode reproduces both captures together with the
matching Verbund mirror (0 + Turm, 1 + LaengsSpiegel, 2 + QuerSpiegel,
3 + Rotiert): on a centered block the far placement equals the reflection.
Since the control-file caller passes mode 0, mode 0 with Verbund 0 (Turm) is
the reading consistent with the call site; the tests keep mode 1 +
LaengsSpiegel and assert the equivalence. The captures alone cannot decide.

The per-package emission is the legacy combination `[frame+8] != 0 &&
solution.word0 < 250`. The rectangular path forces `[frame+8] := 1`
(0x00a465d6); the meaning of `solution.word0` is not reconstructed. This port
exposes the combined switch as `interactiveQuality`. With alignment mode 1 and
the LaengsSpiegel mirror the tiled placements are the same either way, but the
block-level assertions (100 / 44 one-package blocks, the block-for-block
comparison) and the mode-0 alternative depend on the reverse-fitted `on`.

## Not covered by the capture

The capture has both replication flags off, so the mirror axis (Real48 at
solution `+0x10`) is not exercised. The port models the axis branches from
`0x00a468f2–0x00a46b38`; see `replication.ts`. The Round/Oval/Complex path
(MPWin) and the stored-standard-pattern path are documented as unsupported in
`mpwin.ts` / `optimizer.ts`.
