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

function packageSpan(packages: { x: number; y: number; xMax: number; yMax: number }[]) {
  const minX = Math.min(...packages.map((item) => item.x));
  const minY = Math.min(...packages.map((item) => item.y));
  const maxX = Math.max(...packages.map((item) => item.xMax));
  const maxY = Math.max(...packages.map((item) => item.yMax));
  return { x: maxX - minX, y: maxY - minY };
}

describe("MultiPack solver family", () => {
  it("enumerates the captured 44-package underhang layer", () => {
    const input = {
      paletteDmm: PALETTE,
      package: { length: 1570, width: 1100 },
      clearanceDmm: 0,
    };
    const layers = generateMultiPackLayers(input);
    expect(enumerateMultiPackSolutions(input)).toHaveLength(layers.length);
    const layer = layers.find(
      (item) =>
        JSON.stringify(
          mirrorMusterPackages(item.packages, 1, PALETTE).map(
            ({ x, y, xMax, yMax, orient }) => [x, y, xMax - x, yMax - y, orient],
          ),
        ) === JSON.stringify(underhangGolden.entries),
    );
    expect(layer?.blockCount).toBe(44);
    expect(layer?.packages).toHaveLength(44);
  });

  it("ranks the 157 by 106 sheet grid first and still keeps the 1166 by 789 plans", () => {
    const layers = generateMultiPackLayers({
      paletteDmm: PALETTE,
      package: { length: 1570, width: 1060 },
      clearanceDmm: 0,
    });
    expect(layers[0]?.packages).toHaveLength(55);
    expect(packageSpan(layers[0]!.packages)).toEqual({ x: 11660, y: 7850 });
    expect(
      layers.some(
        (layer) =>
          layer.packages.length === 55 &&
          packageSpan(layer.packages).x === 11660 &&
          packageSpan(layer.packages).y === 7890,
      ),
    ).toBe(true);
  });

  it("falls back to block emission instead of overflowing the 400-entry record", () => {
    const layers = generateMultiPackLayers({
      paletteDmm: PALETTE,
      package: { length: 500, width: 400 },
      clearanceDmm: 0,
    });
    expect(layers).toHaveLength(124);
    expect(layers[0]?.blockCount).toBe(1);
    expect(layers[0]!.packages).toHaveLength(480);
  });

  it("keeps legacy positions and maps the footprint to solver rotations", () => {
    const input = normalized(157, 110);
    const output = generateCandidateFamily(input, "multipack");
    expect(output.drafts).toHaveLength(49);
    const draft = output.drafts.find(({ placements }) => {
      const first = placements.slice(0, 2).map(({ positionMm, rotation }) => [
        positionMm.x,
        positionMm.y,
        rotation,
      ]);
      return (
        JSON.stringify(first) ===
        JSON.stringify([
          [105, 133, 90],
          [105, 290, 90],
        ])
      );
    });
    expect(draft?.provenance).toHaveLength(1);
    const [provenance] = draft!.provenance;
    expect(provenance?.family).toBe("multipack");
    expect(provenance?.variant).toMatch(/^mp:\d+:c2:n44:11000x6910$/);
    expect(provenance?.parameters).toEqual({ musterBlocks: 44 });
  });

  it("produces valid drafts when width exceeds length or sizes are not 0.1 mm multiples", () => {
    for (const [length, width, drafts] of [
      [110, 157, 49],
      [147.25, 104, 67],
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
        count: 48,
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
