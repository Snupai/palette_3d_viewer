import { describe, expect, it } from "vitest";
import type { Rotation } from "~/domain/palletTypes";
import underhangGolden from "~/domain/solver/multipack/__fixtures__/golden-pattern-44pk-underhang.json";
import { generateCandidateFamily } from "~/domain/solver/generators";
import {
  enumerateMultiPackSolutions,
  generateMultiPackLayers,
  mirrorMusterPackages,
} from "~/domain/solver/multipack";
import {
  validateAndNormalizeSolverInput,
  validateCandidatePlacements,
} from "~/domain/solver/validation";

const PALETTE = { x: 12000, y: 8000 };

function normalized(
  length: number,
  width: number,
  allowedRotations: Rotation[] = [0, 90, 180, 270],
) {
  const result = validateAndNormalizeSolverInput({
    package: {
      shape: "cuboid",
      dimensionsMm: { length, width },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
    constraints: {
      allowMixedPackageOrientations: true,
      allowedRotations,
    },
  });
  if (!result.normalized) throw new Error("invalid test input");
  return result.normalized;
}

describe("MultiPack solver family", () => {
  it("enumerates the captured 44-package underhang layer", () => {
    const input = {
      paletteDmm: PALETTE,
      package: { length: 1570, width: 1100 },
      clearanceDmm: 0,
    };
    expect(enumerateMultiPackSolutions(input)).toHaveLength(26);
    const layer = generateMultiPackLayers(input).find(
      ({ variant }) => variant === "bands:y:t2x3:t1x2",
    );
    expect(layer?.blockCount).toBe(44);
    expect(
      mirrorMusterPackages(layer!.packages, 1, PALETTE).map(
        ({ x, y, xMax, yMax, orient }) => [x, y, xMax - x, yMax - y, orient],
      ),
    ).toEqual(underhangGolden.entries);
  });

  it("falls back to block emission instead of overflowing the 400-entry record", () => {
    const layers = generateMultiPackLayers({
      paletteDmm: PALETTE,
      package: { length: 500, width: 400 },
      clearanceDmm: 0,
    });
    expect(layers).toHaveLength(86);
    expect(layers[0]).toMatchObject({
      variant: "grid:t1:24x20",
      blockCount: 1,
    });
    expect(layers[0]!.packages).toHaveLength(480);
  });

  it("keeps legacy positions and maps the footprint to solver rotations", () => {
    const input = normalized(157, 110);
    const output = generateCandidateFamily(input, "multipack");
    expect(output.drafts).toHaveLength(26);
    const draft = output.drafts.find(({ provenance }) =>
      provenance.some(({ variant }) => variant === "bands:y:t2x3:t1x2"),
    )!;
    expect(draft.provenance).toEqual([
      {
        family: "multipack",
        variant: "bands:y:t2x3:t1x2",
        parameters: { musterBlocks: 44 },
      },
    ]);
    expect(
      draft.placements
        .slice(0, 2)
        .map(({ positionMm, rotation }) => [
          positionMm.x,
          positionMm.y,
          rotation,
        ]),
    ).toEqual([
      [105, 133, 90],
      [105, 290, 90],
    ]);
  });

  it("produces valid drafts when width exceeds length or sizes are not 0.1 mm multiples", () => {
    for (const [length, width, drafts] of [
      [110, 157, 26],
      [147.25, 104, 29],
    ] as const) {
      const input = normalized(length, width);
      const output = generateCandidateFamily(input, "multipack");
      expect(output.drafts).toHaveLength(drafts);
      for (const draft of output.drafts) {
        expect(validateCandidatePlacements(input, draft.placements).valid).toBe(
          true,
        );
      }
    }
  });

  it("reports layouts that need a disallowed yaw", () => {
    const output = generateCandidateFamily(
      normalized(110, 157, [0]),
      "multipack",
    );
    expect(output.drafts).toHaveLength(1);
    expect(output.diagnostics).toEqual([
      expect.objectContaining({
        code: "unauthorized-yaw-source-rejected",
        generator: "multipack",
        count: 25,
      }),
    ]);
  });

  it("is deterministic", () => {
    const input = normalized(157, 110);
    expect(generateCandidateFamily(input, "multipack")).toEqual(
      generateCandidateFamily(input, "multipack"),
    );
  });
});
