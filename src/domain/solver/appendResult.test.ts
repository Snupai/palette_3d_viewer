import { beforeAll, describe, expect, it } from "vitest";
import { appendSolverResult } from "~/domain/solver/appendResult";
import { solveLayer } from "~/domain/solver/solve";
import type { LayerSolverInput, SolverResult } from "~/domain/solver/types";

const input: LayerSolverInput = {
  package: {
    shape: "cuboid",
    dimensionsMm: { length: 100, width: 50 },
    clearanceMm: 0,
  },
  envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
  constraints: { minimumPackageCount: 24, maximumPackageCount: 24 },
};

describe("appendSolverResult", () => {
  let multipack: SolverResult;
  let legacy: SolverResult;
  beforeAll(() => {
    multipack = solveLayer(input, { generatorScope: "multipack" });
    legacy = solveLayer(input, { generatorScope: "legacy" });
  }, 30_000);

  it("keeps the first run's order and appends only new layouts", () => {
    const merged = appendSolverResult(multipack, legacy);

    const first = new Set(
      multipack.candidates.map(({ geometryFingerprint }) => geometryFingerprint),
    );
    const appended = legacy.candidates.filter(
      ({ geometryFingerprint }) => !first.has(geometryFingerprint),
    );
    expect(multipack.candidates).toHaveLength(93);
    expect(legacy.candidates).toHaveLength(319);
    expect(appended).toHaveLength(298);
    expect(merged.candidates.map(({ id }) => id)).toEqual([
      ...multipack.candidates.map(({ id }) => id),
      ...appended.map(({ id }) => id),
    ]);
    expect(merged.candidates.map(({ rank }) => rank)).toEqual(
      Array.from({ length: 391 }, (_, index) => index + 1),
    );
    expect(merged.statistics.candidateCount).toBe(391);
    expect(merged.statistics.geometricDuplicateCount).toBe(285 + 1497 + 21);
    expect(merged.statistics.generatedByFamily.multipack).toBe(
      multipack.statistics.generatedByFamily.multipack,
    );
  });

  it("drops the empty-result warning once the later run adds layouts", () => {
    const none: SolverResult = {
      ...multipack,
      candidates: [],
      diagnostics: [
        {
          severity: "warning",
          phase: "ranking",
          code: "no-valid-candidates",
          message: "none",
        },
      ],
    };
    const merged = appendSolverResult(none, legacy);
    expect(merged.diagnostics.map(({ code }) => code)).not.toContain(
      "no-valid-candidates",
    );
  });
});
