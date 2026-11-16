import { setImmediate } from "node:timers/promises";
import { afterEach, expect } from "vitest";
import type { LayerSolverInput } from "~/domain/solver/types";
import { validateAndNormalizeSolverInput } from "~/domain/solver/validation";

/** Shared fixtures for the split `solver.*.test.ts` files. */

export function yieldBetweenSolverTests(): void {
  afterEach(async () => {
    // Long synchronous solves can starve Vitest's onTaskUpdate RPC. Let the
    // worker send queued updates and receive their acknowledgements between tests.
    await setImmediate();
    await setImmediate();
  });
}

export function basicInput(
  overrides: Partial<LayerSolverInput> = {},
): LayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 100, width: 50 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 400, maxY: 300 },
    ...overrides,
  };
}

export function syntheticRegionInput(
  minimumPackageCount = 2,
  maximumPackageCount = minimumPackageCount,
): LayerSolverInput {
  return {
    package: {
      shape: "cuboid",
      dimensionsMm: { length: 2, width: 1 },
      clearanceMm: 0,
    },
    envelopeMm: { minX: 0, minY: 0, maxX: 6, maxY: 4 },
    constraints: {
      allowedRotations: [0],
      minimumPackageCount,
      maximumPackageCount,
      maxPlacements: maximumPackageCount,
      maxBands: 2,
      maxCandidatesPerGenerator: 20,
      allowMixedPackageOrientations: false,
    },
  };
}

export function normalized(input: LayerSolverInput) {
  const result = validateAndNormalizeSolverInput(input);
  expect(result.valid).toBe(true);
  expect(result.normalized).not.toBeNull();
  return result.normalized!;
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
