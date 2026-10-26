# MultiPack golden fixtures

## `golden-pattern-100pk.blocks.json`

Verbatim copy of `analysis/golden_pattern_100pk.json` from the reverse-engineering
workspace (`C:\Users\naeher\rea-multipack`). It is the live `mpick32.exe
2.1.315.25` Muster record captured at address `0xa13f780` after generation,
replication/finalization and the Verbund mirror. The record holds `count: 100`
entries; every entry is a `1×1` block, i.e. the optimizer ran with the
per-package ("interactive quality") emission enabled.

Fields are the raw 29-byte Muster record: `X`, `Y`, `dX`, `dY`, `xMax`,
`yMax`, `XCount`, `YCount`, `SubOrient`, `Orient`, all in 0.1 mm.

## `golden-pattern-100pk.json`

Compact placement view of the same capture: `entries` are
`[x, y, dX, dY, orient]`, exactly what the parity test compares after tiling
and the Verbund mirror. It also records the capture source and `layerOrient`.

## Reverse-fitted inputs

The capture came from a 1200×800 mm palette (`12000×8000` dmm) with an
112×76 mm package (`1120×760` dmm) and zero clearance. The solution record
that reproduces it:

| input                              | value                                         | evidence                                               |
| ---------------------------------- | --------------------------------------------- | ------------------------------------------------------ |
| palette                            | `12000 × 8000`                                | runtime globals `00d26d7c` / `00d288e8`                |
| block                              | `11400 × 7560`                                | offsets 300/220 and the palette margins                |
| package                            | length 1120, width 760                        | block candidates `0x10df8cc / 0x10df8d0`               |
| clearance                          | 0                                             | runtime global `0x10df778`                             |
| slot 1                             | simple, type 2, `0..11400 × 0..2240`, 15×2    | 30 packages with `dX=760`, `dY=1120`                   |
| slot 2                             | simple, type 1, `0..11400 × 2240..7560`, 10×7 | 70 packages with `dX=1120`, `dY=760`                   |
| `alignMode`                        | 1 (near X / near Y)                           | only mode 1 gives the captured `Y=6660, 5540, …` order |
| `layerOrient`                      | 2                                             | `Muster[2]` in the capture                             |
| `interactiveQuality`               | on                                            | 100 `1×1` blocks in the capture                        |
| `replicate2x2` / `replicateMirror` | off                                           | runtime globals `00d28de4` / `00d277e0` = 0            |
| `swapEliminate`                    | off                                           | control-file caller `0x00ca746b` pushes 0              |
| Verbund                            | 1 (LaengsSpiegel)                             | captured `Y` values are mirrored around 8000           |

`AddBlock` alignment is the optimizer's `param_2` (`EDX`, stored at
`EBP-0x9d`). The control-file caller `0x00ca746b` passes `EDX=0`, while the
preview/three-variant callers (`0x00cb71ec`, `0x00a42c94`) forward their own
value; the capture is only reproducible with mode 1, so it is treated as a
reverse-fitted input rather than a constant.

The per-package emission is the legacy combination `[frame+8] != 0 &&
solution.word0 < 250`. The rectangular path forces `[frame+8] := 1`
(0x00a465d6), and the capture's 100 `1×1` blocks show the second test passed.
This port exposes the combined switch as `interactiveQuality` instead of
reconstructing the semantics of `solution.word0`.

## Not covered by the capture

The capture has both replication flags off, so the mirror axis (Real48 at
solution `+0x10`) is not exercised. The port models the axis branches from
`0x00a468f2–0x00a46b38`; see `replication.ts`. The Round/Oval/Complex path
(MPWin) and the stored-standard-pattern path are documented as unsupported in
`mpwin.ts` / `optimizer.ts`.
