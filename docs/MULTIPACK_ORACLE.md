# MultiPack desktop oracle

The legacy desktop generator remains the version-specific oracle for candidate-set parity.
The capture workflow is Windows-only and pinned to this executable:

| Property       | Value                                                              |
| -------------- | ------------------------------------------------------------------ |
| Product        | `MULTIPACK für Roboter`                                            |
| File version   | `2.1.315.25`                                                       |
| Architecture   | native x86 Delphi/VCL                                              |
| SHA-256        | `629dbab6deb9aac9a6cd254df59e0e6bd4c92dd9e45936ea9a78f701df4a67ff` |
| Candidate grid | DevExpress `TcxGrid`                                               |
| Solution view  | `TFormQSolution`                                                   |

The real `.mpb` format stores only the generated patterns selected for a project. It is not a
complete candidate-set archive, so candidate evidence must be captured while the generated
result list is open.

## Writable oracle copy

The installed database `mpick32.ini` lives below `Program Files (x86)`. A normal user can read
it but cannot create the SQLite journal files needed during robot export. The observed failure is:

```text
SQLite3 Error 8 - attempt to write a readonly database
```

Do not relax the ACL on the installed application. Create or reuse an isolated copy below
`%LOCALAPPDATA%` instead:

```bash
npm run corpus:rob:oracle:setup -- -Launch
```

The setup runner:

- verifies the source file version and executable digest;
- copies `mpick32.exe` and `mpick32.ini` only when the target does not exist;
- never overwrites an existing writable oracle database;
- reuses an already-running oracle process for the same executable path.

Enter the case and generate its candidates in this writable instance before starting a full
capture.

## Inventory capture

Inventory mode reads the generated candidate order without exporting files. It navigates to the
first and last DevExpress records, obtains the exact count from the `Lösung N` window title, then
restores the originally selected solution.

```bash
npm run corpus:rob:oracle -- -OutputDirectory "C:\absolute\external\capture" -CaseId "package-201x139-euro" -PackageLengthMm 201 -PackageWidthMm 139 -PackageHeightMm 231 -ClearanceMm 0 -InputDirection 0 -PalletLengthMm 1200 -PalletWidthMm 800 -RequestedPackagesPerLayer 31 -ExpectedCandidateCount 87 -ProcessId 33408 -InventoryOnly
```

The `201 × 139 × 231 mm`, zero-clearance EURO-pallet reference run contains exactly **87**
solutions. The six rows visible in the desktop table are only the current viewport.

## Full ROB capture

A full capture requires:

- a generated candidate set in the writable oracle instance;
- an unlocked interactive Windows desktop, because the standard Save As dialog accepts its
  address and filename through the normal Windows input path;
- a new or empty absolute output directory;
- an explicit process ID when more than one `mpick32.exe` process is running.

Run the same command without `-InventoryOnly`, using the writable process ID:

```bash
npm run corpus:rob:oracle -- -OutputDirectory "C:\absolute\external\capture" -CaseId "package-201x139-euro" -PackageLengthMm 201 -PackageWidthMm 139 -PackageHeightMm 231 -ClearanceMm 0 -InputDirection 0 -PalletLengthMm 1200 -PalletWidthMm 800 -RequestedPackagesPerLayer 31 -ExpectedCandidateCount 87 -ProcessId 34652
```

For each solution the runner:

1. verifies the active `Lösung N` title;
2. invokes `Roboterdatei...`;
3. writes `exports/candidate-NNNN.rob`;
4. waits until the file has a stable non-zero size;
5. records its byte length and SHA-256 digest;
6. advances exactly one DevExpress record;
7. restores the original selection after completion or failure.

The pinned executable build, process windows, candidate order, output directory, and every modal
dialog are checked before actions continue. Existing capture files are never overwritten. MultiPack
remembers the selected export directory after the first file, so the runner navigates to it only for
the first export or verification of each run and enters only the synthetic basename thereafter.

## Resume an interrupted capture

A failed run can continue from its first missing candidate without replacing earlier files:

```bash
npm run corpus:rob:oracle -- -OutputDirectory "C:\absolute\external\capture" -CaseId "package-201x139-euro" -PackageLengthMm 201 -PackageWidthMm 139 -PackageHeightMm 231 -ClearanceMm 0 -InputDirection 0 -PalletLengthMm 1200 -PalletWidthMm 800 -RequestedPackagesPerLayer 31 -ExpectedCandidateCount 87 -ProcessId 34652 -Resume
```

Resume mode accepts only a contiguous non-empty sequence beginning with
`candidate-0001.rob`. Every existing ordinal is temporarily re-exported as
`resume-check-NNNN.rob`, compared by byte length and SHA-256, and the temporary file is removed.
Only then does the runner continue at the first missing ordinal. The runner sets the Save As
directory once on the first verification and reuses it for the remaining rows. Unexpected files,
gaps, directories, mismatched
re-exports, or an already-written manifest stop the run.

## Manifest contract

Each run writes `oracle-manifest.json` using oracle-capture schema v2. The schema is defined in
`src/lib/parity/oracleCaptureManifest.ts` and records:

- the pinned oracle version and executable digest;
- non-identifying case dimensions;
- the exact candidate count and contiguous solution order;
- synthetic candidate export basenames;
- export byte lengths and SHA-256 digests;
- whether the active candidate export set is complete.

`exportSetComplete` means only that every expected solution ordinal has a regular, parser-valid,
hash-matching `.rob` export. Package dimensions, pallet dimensions, and input direction are
verified from the encoded `.rob` headers. Case ID, clearance, and requested packages per layer
are not encoded by `.rob`; the manifest marks them explicitly as operator-asserted rather than
verified.

The manifest stores no absolute paths, source `.rob` text, automatically discovered source
basenames, or screenshots. It does store the operator-provided Case ID, which must be anonymized
and must not reuse a `.rob` basename. Captured `.rob` files remain external and must never be
committed. Table-only values such as the
legacy `Blöcke` and `Zyklen` columns remain `null` until they are independently transcribed or
extracted; geometry and grip data come from the per-candidate `.rob` exports.

## Failure behavior

The runner stops without guessing when:

- the executable version or digest differs;
- the generated grid or solution window is missing;
- a solution number does not advance exactly as expected;
- another modal dialog is already open;
- Windows is locked;
- the Save As dialog cannot receive normal input;
- MultiPack raises a `Fehler` dialog;
- an export is missing, empty, unstable, or would overwrite an existing file.

Partial external exports are retained for inspection, but no export-set-complete manifest is claimed.
