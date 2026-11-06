# Parity Corpus and Scorecard

As of: 05.08.2026

The M0 corpus separates executable repository baselines from external
observations and open questions. It contains no private original data. The
machine-readable cases live under `src/lib/__fixtures__/` and are discovered
statically via `src/lib/parityCorpus.ts`. As a result, the same validated corpus
is available in Vitest and in application diagnostics; file system access or
private local paths are not part of the runtime API.

## Evidence status

- **Golden:** anonymized or synthetic expectation with an executable,
  reproducible repository basis;
- **Observed:** documented third-party observation without fully locally
  reproducible evidence;
- **Open:** meaning, input or expected value is not yet sufficiently
  clarified.

`Open` can additionally carry `applicable: false` for dimensions that do not
apply. An existing numeric value does not become Golden merely by being
plausible.

## Schema versions

- Schema **v1** is retained as a strict import-related contract.
  `parityGoldenCaseSchema`, `ParityGoldenCase`,
  `PARITY_GOLDEN_CASE_SCHEMA_VERSION` and `evaluateRobGoldenCase` remain
  compatible.
- Schema **v2** adds project inputs, import artifacts, the candidate set and
  order, freely named metrics, artifact references, evidence per expectation and
  all nine scorecard dimensions.
- `parityCaseSchema` accepts both versions. Observed candidate sources with
  unknown deduplication explicitly carry `null` for identity or geometry
  instead of an invented version assignment.

The candidate contracts are versioned separately and defined in
[docs/CANDIDATE_IDENTITY.md](CANDIDATE_IDENTITY.md).

## Versioned reference corpus

| Case                           | Origin                | Executable basis                      | Core expectations                                                |
| ------------------------------ | --------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Anonymized ROB import baseline | anonymized/synthetic  | LF and CRLF `.rob` fixture, schema v1 | Import summary and semantic roundtrip                            |
| Synthetic alternating stack    | synthetic             | committed `.rob`, schema v2           | 2 patterns, 4 layers, 14 packages, 8 cycles, interlayers         |
| Synthetic square grid          | synthetic             | inline `ProjectV2`, schema v2         | two ordered 12-package candidates; orientation remains different |
| Synthetic identity variants    | synthetic             | inline `ProjectV2`, schema v2         | one geometry, three identities via label/grip partition          |
| AP5006 / 1329-00004 observed   | reference observation | no committed original input           | 65 total, 15 with 55 and further observed target values          |

The corpus thus contains four clearly anonymized or synthetic references and a
separate Observed case. The synthetic values are contracts of this project and
are not presented as outputs of another system.

## Parity matrix

The JSON scorecards are the authoritative, machine-readable source. This table
is their compact summary.

| Case                        | Input    | Geometry | Variety  | Ranking  | Stack    | Robotics | Export   | Operation | Performance |
| --------------------------- | -------- | -------- | -------- | -------- | -------- | -------- | -------- | --------- | ----------- |
| Anonymized ROB import       | Golden   | Golden   | Open n/a | Open n/a | Golden   | Golden   | Golden   | Open n/a  | Open n/a    |
| Synthetic alternating stack | Golden   | Golden   | Open n/a | Open n/a | Golden   | Golden   | Golden   | Open n/a  | Open n/a    |
| Synthetic square grid       | Golden   | Golden   | Golden   | Golden   | Open n/a | Open n/a | Open n/a | Open n/a  | Open n/a    |
| Synthetic identity variants | Golden   | Golden   | Golden   | Golden   | Open n/a | Open     | Open n/a | Open n/a  | Open n/a    |
| AP5006 / 1329-00004         | Observed | Observed | Observed | Open     | Observed | Observed | Open     | Observed  | Open        |

## Corpus and diagnostics APIs

`src/lib/parityCorpus.ts` exports:

- `discoverParityCorpus`: validates arbitrary public document sources,
  reports exact Zod paths as well as duplicate case IDs and sorts
  deterministically;
- `loadBuiltInParityCorpus`: loads the statically imported repository corpus;
- `evaluateParityCase`: compares an import, candidate or metric observation
  with a case;
- `runParityCorpus`: runs a synchronous or asynchronous adapter over all cases
  without searching for private files itself;
- `aggregateParityResults`: aggregates mismatches, Golden regressions,
  unexecuted checks and status counts per scorecard dimension;
- `collectExpectedParityMismatches`: returns exact paths for partial v2
  expectations; the existing exact v1 comparison is retained separately.

An application can pass current solver/project values directly as an
observation. Vitest can load committed artifacts via `node:fs`. The shared
production code, in contrast, imports no Node file system and knows no local
production folders.

## AP5006 / 1329-00004 – observed target values

These values come from an existing reference plan. They only become Golden
gates once the input and relevant outputs are fully anonymized and locally
reproducible.

| Dimension            | Observation                              |
| -------------------- | ---------------------------------------- |
| Package              | 157 × 106 × 150 mm, cuboid, spacing 0 mm |
| Pallet               | EURO 1200 × 800 mm                       |
| Usable block         | Underhang length −34 mm, width −11 mm    |
| Solver set           | 65 plans in total                        |
| Relevant set         | 15 plans with 55 packages each           |
| Visible cycle counts | 33 or 36                                 |
| Visible block sizes  | Length 1162–1166 mm, width 785–789 mm    |
| Selected candidate   | 55 packages, 33 cycles, 1166 × 785 mm    |
| Example stack        | 10 layers, 550 packages, height 1500 mm  |
| Utilization          | approximately 95 % area and 86 % volume  |

A locally inspected export contained, per pattern, 55 packages in 36 cycles and
19 double and 17 single grips. Because this production file is deliberately not
committed and not resolved by the corpus runner, these numbers also remain
**Observed**. In particular, neither the 65 candidates nor their identity
semantics or order are established under the new v1 contract.

## Artifact and provenance rules

- Repository artifacts use relative POSIX paths exclusively.
- External or missing artifacts must not contain a local path and are not
  resolved automatically.
- Every evidence reference must point to an artifact ID declared in the same
  case.
- Synthetic values are explicitly marked as synthetic.
- Screenshots, exports or `.mpb` files are referenced as Golden only if an
  anonymized file is actually committed and usable in the test.

## Evidence still required

1. complete anonymized AP5006 input;
2. placement geometry of all 65 candidates or at least of the 15 55-package
   patterns;
3. stable order and complete values of the solution table;
4. controlled `.rob` export pairs for `dx`/`dy`, label, grip group,
   infeed direction and palletizing direction;
5. a saved stack with interlayers and a differing top layer;
6. anonymized `.mpb` files with controlled individual changes.
