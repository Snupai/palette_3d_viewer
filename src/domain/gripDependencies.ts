import type { Grip } from "~/domain/palletTypes";
import { footprintSize, gripsToBoxes } from "~/domain/palletGeometry";

type BoxBounds = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

type GripDependency = {
  prerequisiteIndex: number;
  dependentIndex: number;
};

function buildGripDeltaDependencies(
  grips: Grip[],
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
): GripDependency[] {
  const boundsByGrip = grips.map((grip) =>
    gripsToBoxes([grip], packageWidth, packageLength, 0, inputDirection).map(
      (box): BoxBounds => {
        const size = footprintSize(box);
        return {
          left: box.rect.x - size.width / 2,
          right: box.rect.x + size.width / 2,
          bottom: box.rect.y - size.length / 2,
          top: box.rect.y + size.length / 2,
        };
      },
    ),
  );
  const coordinateTolerance = 0.500_001;
  const nearestTolerance = Math.max(
    coordinateTolerance,
    Math.min(2, Math.min(packageWidth, packageLength) * 0.01),
  );

  const nearestInDirection = (
    sourceIndex: number,
    axis: "x" | "y",
    direction: -1 | 1,
  ): number[] => {
    const sourceBounds = boundsByGrip[sourceIndex] ?? [];
    const candidateGaps: { index: number; gap: number }[] = [];

    boundsByGrip.forEach((candidateBounds, candidateIndex) => {
      if (candidateIndex === sourceIndex) return;
      let candidateGap = Number.POSITIVE_INFINITY;

      sourceBounds.forEach((source) => {
        candidateBounds.forEach((candidate) => {
          const perpendicularOverlap =
            axis === "x"
              ? Math.min(source.top, candidate.top) -
                Math.max(source.bottom, candidate.bottom)
              : Math.min(source.right, candidate.right) -
                Math.max(source.left, candidate.left);
          if (perpendicularOverlap <= coordinateTolerance) return;

          const gap =
            axis === "x"
              ? direction > 0
                ? candidate.left - source.right
                : source.left - candidate.right
              : direction > 0
                ? candidate.bottom - source.top
                : source.bottom - candidate.top;
          if (gap < -coordinateTolerance) return;
          candidateGap = Math.min(candidateGap, Math.max(0, gap));
        });
      });

      if (!Number.isFinite(candidateGap)) return;
      candidateGaps.push({ index: candidateIndex, gap: candidateGap });
    });

    const nearestGap = Math.min(...candidateGaps.map(({ gap }) => gap));
    return candidateGaps
      .filter(({ gap }) => gap - nearestGap <= nearestTolerance)
      .map(({ index }) => index);
  };

  const dependencies = new Map<string, GripDependency>();
  grips.forEach((grip, dependentIndex) => {
    const axes = [
      grip.dx === 0
        ? null
        : ({ axis: "x", direction: -Math.sign(grip.dx) } as const),
      grip.dy === 0
        ? null
        : ({ axis: "y", direction: -Math.sign(grip.dy) } as const),
    ].filter(
      (value): value is { axis: "x" | "y"; direction: -1 | 1 } =>
        value !== null,
    );

    axes.forEach(({ axis, direction }) => {
      nearestInDirection(dependentIndex, axis, direction).forEach(
        (prerequisiteIndex) => {
          dependencies.set(`${prerequisiteIndex}:${dependentIndex}`, {
            prerequisiteIndex,
            dependentIndex,
          });
        },
      );
    });
  });

  return [...dependencies.values()];
}

/**
 * Replaces selected grips with one merged grip while retaining their .rob
 * placement constraints. A grip's dx/dy points toward already placed
 * reference grips; conversely, other grips whose dx/dy points at a selected
 * grip must remain after the merged grip.
 */
export function insertMergedGripByDeltaDependencies(
  grips: Grip[],
  selectedIndices: ReadonlySet<number>,
  mergedGrip: Grip,
  packageWidth: number,
  packageLength: number,
  inputDirection: 0 | 1,
): { grips: Grip[]; mergedIndex: number } | null {
  const selected = new Set(
    [...selectedIndices].filter((index) => index >= 0 && index < grips.length),
  );
  if (selected.size < 2) return null;

  const remaining = grips
    .map((grip, originalIndex) => ({ grip, originalIndex }))
    .filter(({ originalIndex }) => !selected.has(originalIndex));
  const remainingIndexByOriginal = new Map(
    remaining.map(({ originalIndex }, index) => [originalIndex, index]),
  );
  let earliestInsertion = 0;
  let latestInsertion = remaining.length;

  buildGripDeltaDependencies(
    grips,
    packageWidth,
    packageLength,
    inputDirection,
  ).forEach(({ prerequisiteIndex, dependentIndex }) => {
    const prerequisiteSelected = selected.has(prerequisiteIndex);
    const dependentSelected = selected.has(dependentIndex);
    if (prerequisiteSelected === dependentSelected) return;

    if (dependentSelected) {
      const prerequisitePosition =
        remainingIndexByOriginal.get(prerequisiteIndex);
      if (prerequisitePosition !== undefined) {
        earliestInsertion = Math.max(
          earliestInsertion,
          prerequisitePosition + 1,
        );
      }
    } else {
      const dependentPosition = remainingIndexByOriginal.get(dependentIndex);
      if (dependentPosition !== undefined) {
        latestInsertion = Math.min(latestInsertion, dependentPosition);
      }
    }
  });

  if (earliestInsertion > latestInsertion) return null;

  const firstSelectedIndex = Math.min(...selected);
  const preferredInsertion = remaining.filter(
    ({ originalIndex }) => originalIndex < firstSelectedIndex,
  ).length;
  const mergedIndex = Math.max(
    earliestInsertion,
    Math.min(preferredInsertion, latestInsertion),
  );
  const next = remaining.map(({ grip }) => grip);
  next.splice(mergedIndex, 0, mergedGrip);
  return { grips: next, mergedIndex };
}
