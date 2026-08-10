import { describe, expect, it } from "vitest";
import { extractRobCorpusScenarios } from "~/lib/parity/inputExtraction";
import { characterizeRobSource } from "~/lib/parity/sourceCharacterization";
import { parseRobText } from "~/lib/robParser";

const SYNTHETIC_ROB = [
  "400 300 100",
  "100 50 20 1",
  "1",
  "2",
  "0 1",
  "1 0",
  "1 2",
  "1",
  "50 25 0 50 50 0 1 0 0",
].join("\n");

describe("conservative .rob solver input extraction", () => {
  it("uses only encoded dimensions and direction while preserving source stack observations", () => {
    const source = characterizeRobSource(parseRobText(SYNTHETIC_ROB));
    const scenarios = extractRobCorpusScenarios(source, {
      maxCandidatesPerGenerator: 25,
    });

    expect(source.encodedInput).toMatchObject({
      packageDimensionsMm: { length: 100, width: 50, height: 20 },
      palletDimensionsMm: { length: 400, width: 300, height: 100 },
      inputDirection: { value: 1, explicit: true },
      sourceFeasiblePackageCount: 1,
      sourceFeasibleCountRole: "feasible-reference-not-asserted-maximum",
      fieldsNotEncoded: [
        "clearance",
        "allowed-overhang",
        "multipick-eligibility",
        "gripper",
        "station",
      ],
    });
    expect(source.patterns[0]).toMatchObject({
      packageCount: 1,
      orientations: { 0: 0, 90: 1, 180: 0, 270: 0 },
      boundsMm: { minX: 25, minY: 0, maxX: 75, maxY: 100 },
    });
    expect(source.stack).toMatchObject({
      sourcePatternIdentitySequence: [1, 1],
      patternEqualitySequence: ["pattern-equality-1", "pattern-equality-1"],
      packagesPerPhysicalLayer: [1, 1],
      cyclesPerPhysicalLayer: [1, 1],
      interlayersBeforePhysicalLayers: [1, 0],
      trailingInterlayer: 2,
    });

    const nominal = scenarios[0]!;
    expect(nominal.id).toBe("nominal-strict-v1");
    expect(nominal.solverInput).toMatchObject({
      package: {
        shape: "cuboid",
        dimensionsMm: { length: 100, width: 50 },
        clearanceMm: 0,
      },
      envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
      constraints: {
        allowedRotations: [0, 90, 180, 270],
        maxCandidatesPerGenerator: 25,
      },
    });
    expect(
      nominal.solverInput?.constraints?.maximumPackageCount,
    ).toBeUndefined();
    expect(nominal.inputSummary.allowedOverhangPolicyMm).toEqual({
      lengthPerSide: 0,
      widthPerSide: 0,
    });

    const observed = scenarios[1]!;
    expect(observed).toMatchObject({
      id: "observed-envelope-v1",
      basis: "source-observation",
      inputSummary: {
        envelopeMm: { minX: 25, minY: 0, maxX: 75, maxY: 100 },
        allowedOverhangPolicyMm: null,
        observationOnly: true,
        sourcePackageCountConstraintApplied: false,
      },
    });
  });

  it("records an omitted direction flag as non-explicit instead of inventing provenance", () => {
    const source = characterizeRobSource(
      parseRobText(SYNTHETIC_ROB.replace("100 50 20 1", "100 50 20")),
    );

    expect(source.encodedInput.inputDirection).toEqual({
      value: 0,
      explicit: false,
    });
  });
});
