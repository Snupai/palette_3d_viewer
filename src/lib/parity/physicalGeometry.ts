import {
  rectangleSizeForRotation,
  type PlacementGeometry,
  type RectangleBoundsMm,
  type RectangleSizeMm,
} from "~/domain/geometry";

export type PhysicalFootprintOrientationHistogram = {
  lengthwise: number;
  crosswise: number;
  square: number;
};

export type PhysicalPlacementMatch = {
  matched: boolean;
  maximumAxisDisplacementMm: number | null;
};

type IndexedPlacement = {
  index: number;
  placement: PlacementGeometry;
};

function normalizedNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIndexedPlacements(
  left: IndexedPlacement,
  right: IndexedPlacement,
): number {
  return (
    compareNumbers(left.placement.positionMm.x, right.placement.positionMm.x) ||
    compareNumbers(left.placement.positionMm.y, right.placement.positionMm.y) ||
    left.index - right.index
  );
}

function footprintKey(
  placement: PlacementGeometry,
  packageSize: RectangleSizeMm,
): string {
  const footprint = rectangleSizeForRotation(packageSize, placement.rotation);
  return `${normalizedNumber(footprint.length)},${normalizedNumber(footprint.width)}`;
}

function groupedPlacements(
  placements: readonly PlacementGeometry[],
  packageSize: RectangleSizeMm,
): Map<string, IndexedPlacement[]> {
  const groups = new Map<string, IndexedPlacement[]>();
  placements.forEach((placement, index) => {
    const key = footprintKey(placement, packageSize);
    const entries = groups.get(key) ?? [];
    entries.push({ index, placement });
    groups.set(key, entries);
  });
  for (const entries of groups.values()) entries.sort(compareIndexedPlacements);
  return groups;
}

export function physicalFootprintOrientationHistogram(
  placements: readonly PlacementGeometry[],
  packageSize: RectangleSizeMm,
): PhysicalFootprintOrientationHistogram {
  const histogram: PhysicalFootprintOrientationHistogram = {
    lengthwise: 0,
    crosswise: 0,
    square: 0,
  };
  const square = packageSize.length === packageSize.width;
  for (const placement of placements) {
    if (square) {
      histogram.square += 1;
    } else if (placement.rotation === 0 || placement.rotation === 180) {
      histogram.lengthwise += 1;
    } else {
      histogram.crosswise += 1;
    }
  }
  return histogram;
}

export function physicalFootprintGeometryFingerprint(
  placements: readonly PlacementGeometry[],
  packageSize: RectangleSizeMm,
): string {
  const tuples = placements.map((placement) => {
    const footprint = rectangleSizeForRotation(packageSize, placement.rotation);
    return [
      normalizedNumber(placement.positionMm.x),
      normalizedNumber(placement.positionMm.y),
      normalizedNumber(footprint.length),
      normalizedNumber(footprint.width),
    ] as const;
  });
  tuples.sort((left, right) => {
    for (let index = 0; index < left.length; index += 1) {
      const compared = compareNumbers(left[index]!, right[index]!);
      if (compared !== 0) return compared;
    }
    return 0;
  });
  return JSON.stringify(tuples);
}

export function physicalFootprintCoarseKey(
  placements: readonly PlacementGeometry[],
  packageSize: RectangleSizeMm,
): string {
  const counts = new Map<string, number>();
  for (const placement of placements) {
    const key = footprintKey(placement, packageSize);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return JSON.stringify(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function matchGroupWithinTolerance(
  source: readonly IndexedPlacement[],
  candidate: readonly IndexedPlacement[],
  toleranceMm: number,
): PhysicalPlacementMatch {
  if (source.length !== candidate.length) {
    return { matched: false, maximumAxisDisplacementMm: null };
  }

  const adjacency = source.map(({ placement }) =>
    candidate
      .map(({ placement: candidatePlacement }, candidateIndex) => ({
        candidateIndex,
        deltaX: Math.abs(
          placement.positionMm.x - candidatePlacement.positionMm.x,
        ),
        deltaY: Math.abs(
          placement.positionMm.y - candidatePlacement.positionMm.y,
        ),
      }))
      .filter(
        ({ deltaX, deltaY }) => deltaX <= toleranceMm && deltaY <= toleranceMm,
      )
      .sort(
        (left, right) =>
          Math.max(left.deltaX, left.deltaY) -
            Math.max(right.deltaX, right.deltaY) ||
          left.deltaX + left.deltaY - (right.deltaX + right.deltaY) ||
          left.candidateIndex - right.candidateIndex,
      ),
  );
  if (adjacency.some((entries) => entries.length === 0)) {
    return { matched: false, maximumAxisDisplacementMm: null };
  }

  const sourceOrder = source
    .map((_, sourceIndex) => sourceIndex)
    .sort(
      (left, right) =>
        adjacency[left]!.length - adjacency[right]!.length ||
        compareIndexedPlacements(source[left]!, source[right]!),
    );
  const sourceForCandidate = Array<number>(candidate.length).fill(-1);
  const candidateForSource = Array<number>(source.length).fill(-1);

  const assign = (sourceIndex: number, visited: boolean[]): boolean => {
    for (const { candidateIndex } of adjacency[sourceIndex]!) {
      if (visited[candidateIndex]) continue;
      visited[candidateIndex] = true;
      const displacedSource = sourceForCandidate[candidateIndex]!;
      if (displacedSource === -1 || assign(displacedSource, visited)) {
        sourceForCandidate[candidateIndex] = sourceIndex;
        candidateForSource[sourceIndex] = candidateIndex;
        return true;
      }
    }
    return false;
  };

  for (const sourceIndex of sourceOrder) {
    if (!assign(sourceIndex, Array<boolean>(candidate.length).fill(false))) {
      return { matched: false, maximumAxisDisplacementMm: null };
    }
  }

  let maximumAxisDisplacementMm = 0;
  for (let sourceIndex = 0; sourceIndex < source.length; sourceIndex += 1) {
    const candidateIndex = candidateForSource[sourceIndex]!;
    if (candidateIndex < 0) {
      return { matched: false, maximumAxisDisplacementMm: null };
    }
    const sourcePlacement = source[sourceIndex]!.placement;
    const candidatePlacement = candidate[candidateIndex]!.placement;
    maximumAxisDisplacementMm = Math.max(
      maximumAxisDisplacementMm,
      Math.abs(sourcePlacement.positionMm.x - candidatePlacement.positionMm.x),
      Math.abs(sourcePlacement.positionMm.y - candidatePlacement.positionMm.y),
    );
  }
  return { matched: true, maximumAxisDisplacementMm };
}

export function matchPhysicalFootprintPlacements(
  source: readonly PlacementGeometry[],
  candidate: readonly PlacementGeometry[],
  packageSize: RectangleSizeMm,
  toleranceMm: number,
): PhysicalPlacementMatch {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0) {
    throw new Error("toleranceMm must be a finite non-negative number.");
  }
  if (source.length !== candidate.length) {
    return { matched: false, maximumAxisDisplacementMm: null };
  }

  const sourceGroups = groupedPlacements(source, packageSize);
  const candidateGroups = groupedPlacements(candidate, packageSize);
  if (sourceGroups.size !== candidateGroups.size) {
    return { matched: false, maximumAxisDisplacementMm: null };
  }

  let maximumAxisDisplacementMm = 0;
  for (const [key, sourceGroup] of sourceGroups) {
    const candidateGroup = candidateGroups.get(key);
    if (!candidateGroup) {
      return { matched: false, maximumAxisDisplacementMm: null };
    }
    const groupMatch = matchGroupWithinTolerance(
      sourceGroup,
      candidateGroup,
      toleranceMm,
    );
    if (!groupMatch.matched) return groupMatch;
    maximumAxisDisplacementMm = Math.max(
      maximumAxisDisplacementMm,
      groupMatch.maximumAxisDisplacementMm ?? 0,
    );
  }
  return { matched: true, maximumAxisDisplacementMm };
}

export function rectangleBoundsMaximumDifferenceMm(
  left: RectangleBoundsMm | null,
  right: RectangleBoundsMm | null,
): number | null {
  if (left === null || right === null) return left === right ? 0 : null;
  return Math.max(
    Math.abs(left.minX - right.minX),
    Math.abs(left.minY - right.minY),
    Math.abs(left.maxX - right.maxX),
    Math.abs(left.maxY - right.maxY),
  );
}

export function rectangleBoundsWithinTolerance(
  left: RectangleBoundsMm | null,
  right: RectangleBoundsMm | null,
  toleranceMm: number,
): boolean {
  const difference = rectangleBoundsMaximumDifferenceMm(left, right);
  return difference !== null && difference <= toleranceMm;
}
