import {
  rectangleSizeForRotation,
  type RectangleSizeMm,
} from "~/domain/geometry";
import type { SolverCandidate } from "~/domain/solver";

export const CANDIDATE_LAYOUT_POSITION_TOLERANCE_MM = 0.001;

type CandidateLabelSide = SolverCandidate["placements"][number]["labelSide"];

type CandidateLayoutFootprint = {
  index: number;
  x: number;
  y: number;
  length: number;
  width: number;
  labelSide: CandidateLabelSide;
};

type CandidateLayoutDescriptor = {
  candidate: SolverCandidate;
  groups: Map<string, CandidateLayoutFootprint[]>;
  exactKey: string;
  coarseKey: string;
  spatialCell: readonly [number, number, number, number];
};

const candidateLayoutSelectionCache = new WeakMap<
  readonly SolverCandidate[],
  Map<string, SolverCandidate[]>
>();

function normalizedNumber(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Candidate layout geometry must be finite.");
  }
  return Object.is(value, -0) ? 0 : value;
}

function compareLabelSides(
  left: CandidateLabelSide,
  right: CandidateLabelSide,
): number {
  const leftValue = left ?? "";
  const rightValue = right ?? "";
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}

function compareFootprints(
  left: CandidateLayoutFootprint,
  right: CandidateLayoutFootprint,
): number {
  return (
    left.y - right.y ||
    left.x - right.x ||
    left.length - right.length ||
    left.width - right.width ||
    compareLabelSides(left.labelSide, right.labelSide) ||
    left.index - right.index
  );
}

function footprintGroupKey({
  length,
  width,
  labelSide,
}: CandidateLayoutFootprint): string {
  return JSON.stringify([length, width, labelSide]);
}

function footprintsBySizeAndLabel(
  candidate: SolverCandidate,
  packageSize: RectangleSizeMm,
): Map<string, CandidateLayoutFootprint[]> {
  const groups = new Map<string, CandidateLayoutFootprint[]>();
  candidate.placements.forEach(({ positionMm, rotation, labelSide }, index) => {
    const footprint = rectangleSizeForRotation(packageSize, rotation);
    const entry: CandidateLayoutFootprint = {
      index,
      x: normalizedNumber(positionMm.x),
      y: normalizedNumber(positionMm.y),
      length: footprint.length,
      width: footprint.width,
      labelSide,
    };
    const key = footprintGroupKey(entry);
    const entries = groups.get(key) ?? [];
    entries.push(entry);
    groups.set(key, entries);
  });
  for (const entries of groups.values()) entries.sort(compareFootprints);
  return groups;
}

function flattenedFootprints(
  groups: Map<string, CandidateLayoutFootprint[]>,
): CandidateLayoutFootprint[] {
  return [...groups.values()].flat().sort(compareFootprints);
}

function candidateLayoutCoarseKey(
  groups: Map<string, CandidateLayoutFootprint[]>,
): string {
  return JSON.stringify(
    [...groups.entries()]
      .map(([key, footprints]) => [key, footprints.length] as const)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}

function candidateLayoutExactKey(
  groups: Map<string, CandidateLayoutFootprint[]>,
): string {
  return JSON.stringify(
    flattenedFootprints(groups).map(({ x, y, length, width, labelSide }) => ({
      x,
      y,
      length,
      width,
      labelSide,
    })),
  );
}

function spatialCell(
  footprints: readonly CandidateLayoutFootprint[],
  toleranceMm: number,
): readonly [number, number, number, number] {
  if (footprints.length === 0) return [0, 0, 0, 0];
  let minX = footprints[0]!.x;
  let minY = footprints[0]!.y;
  let maxX = minX;
  let maxY = minY;
  for (let index = 1; index < footprints.length; index += 1) {
    const footprint = footprints[index]!;
    minX = Math.min(minX, footprint.x);
    minY = Math.min(minY, footprint.y);
    maxX = Math.max(maxX, footprint.x);
    maxY = Math.max(maxY, footprint.y);
  }
  return [minX, minY, maxX, maxY].map((value) =>
    Math.floor(value / toleranceMm),
  ) as [number, number, number, number];
}

function describeCandidateLayout(
  candidate: SolverCandidate,
  packageSize: RectangleSizeMm,
): CandidateLayoutDescriptor {
  const groups = footprintsBySizeAndLabel(candidate, packageSize);
  const footprints = flattenedFootprints(groups);
  return {
    candidate,
    groups,
    exactKey: candidateLayoutExactKey(groups),
    coarseKey: candidateLayoutCoarseKey(groups),
    spatialCell: spatialCell(
      footprints,
      CANDIDATE_LAYOUT_POSITION_TOLERANCE_MM,
    ),
  };
}

function coordinateEpsilon(left: number, right: number): number {
  return Number.EPSILON * Math.max(1, Math.abs(left), Math.abs(right)) * 8;
}

function withinTolerance(
  left: number,
  right: number,
  toleranceMm: number,
): boolean {
  return Math.abs(left - right) <= toleranceMm + coordinateEpsilon(left, right);
}

function positionCellKey(x: number, y: number, toleranceMm: number): string {
  return `${Math.floor(x / toleranceMm)},${Math.floor(y / toleranceMm)}`;
}

function nearbyPositionCellKeys(
  x: number,
  y: number,
  toleranceMm: number,
): string[] {
  const centerX = Math.floor(x / toleranceMm);
  const centerY = Math.floor(y / toleranceMm);
  return [-2, -1, 0, 1, 2].flatMap((offsetX) =>
    [-2, -1, 0, 1, 2].map(
      (offsetY) => `${centerX + offsetX},${centerY + offsetY}`,
    ),
  );
}

function footprintsMatch(
  source: readonly CandidateLayoutFootprint[],
  candidate: readonly CandidateLayoutFootprint[],
  toleranceMm: number,
): boolean {
  if (source.length !== candidate.length) return false;
  const candidateIndicesByCell = new Map<string, number[]>();
  candidate.forEach((footprint, candidateIndex) => {
    const key = positionCellKey(footprint.x, footprint.y, toleranceMm);
    const indices = candidateIndicesByCell.get(key) ?? [];
    indices.push(candidateIndex);
    candidateIndicesByCell.set(key, indices);
  });
  const adjacency = source.map((sourceFootprint) =>
    nearbyPositionCellKeys(sourceFootprint.x, sourceFootprint.y, toleranceMm)
      .flatMap((key) => candidateIndicesByCell.get(key) ?? [])
      .map((candidateIndex) => {
        const candidateFootprint = candidate[candidateIndex]!;
        return {
          candidateIndex,
          deltaX: Math.abs(sourceFootprint.x - candidateFootprint.x),
          deltaY: Math.abs(sourceFootprint.y - candidateFootprint.y),
        };
      })
      .filter(({ candidateIndex }) => {
        const candidateFootprint = candidate[candidateIndex]!;
        return (
          withinTolerance(
            sourceFootprint.x,
            candidateFootprint.x,
            toleranceMm,
          ) &&
          withinTolerance(sourceFootprint.y, candidateFootprint.y, toleranceMm)
        );
      })
      .sort(
        (left, right) =>
          Math.max(left.deltaX, left.deltaY) -
            Math.max(right.deltaX, right.deltaY) ||
          left.deltaX + left.deltaY - (right.deltaX + right.deltaY) ||
          left.candidateIndex - right.candidateIndex,
      ),
  );
  if (adjacency.some((entries) => entries.length === 0)) return false;

  const sourceOrder = source
    .map((_, sourceIndex) => sourceIndex)
    .sort(
      (left, right) =>
        adjacency[left]!.length - adjacency[right]!.length ||
        compareFootprints(source[left]!, source[right]!),
    );
  const sourceForCandidate = Array<number>(candidate.length).fill(-1);

  const assign = (sourceIndex: number, visited: boolean[]): boolean => {
    for (const { candidateIndex } of adjacency[sourceIndex]!) {
      if (visited[candidateIndex]) continue;
      visited[candidateIndex] = true;
      const displacedSource = sourceForCandidate[candidateIndex]!;
      if (displacedSource === -1 || assign(displacedSource, visited)) {
        sourceForCandidate[candidateIndex] = sourceIndex;
        return true;
      }
    }
    return false;
  };

  return sourceOrder.every((sourceIndex) =>
    assign(sourceIndex, Array<boolean>(candidate.length).fill(false)),
  );
}

function descriptorsMatch(
  left: CandidateLayoutDescriptor,
  right: CandidateLayoutDescriptor,
  toleranceMm: number,
): boolean {
  if (left.coarseKey !== right.coarseKey) return false;
  for (const [key, leftGroup] of left.groups) {
    const rightGroup = right.groups.get(key);
    if (!rightGroup || !footprintsMatch(leftGroup, rightGroup, toleranceMm)) {
      return false;
    }
  }
  return true;
}

function spatialIndexKey(coarseKey: string, cell: readonly number[]): string {
  return `${coarseKey}:${cell.join(",")}`;
}

function nearbySpatialIndexKeys(
  coarseKey: string,
  cell: readonly number[],
): string[] {
  let cells: number[][] = [[]];
  for (const coordinate of cell) {
    cells = cells.flatMap((prefix) =>
      [-2, -1, 0, 1, 2].map((offset) => [...prefix, coordinate + offset]),
    );
  }
  return cells.map((neighbor) => spatialIndexKey(coarseKey, neighbor));
}

export function candidateLayoutKey(
  candidate: SolverCandidate,
  packageSize: RectangleSizeMm,
): string {
  return candidateLayoutExactKey(
    footprintsBySizeAndLabel(candidate, packageSize),
  );
}

export function candidateLayoutsMatch(
  left: SolverCandidate,
  right: SolverCandidate,
  packageSize: RectangleSizeMm,
  toleranceMm = CANDIDATE_LAYOUT_POSITION_TOLERANCE_MM,
): boolean {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0) {
    throw new Error(
      "Candidate layout tolerance must be finite and non-negative.",
    );
  }
  if (left.placements.length !== right.placements.length) return false;
  if (toleranceMm === 0) {
    return (
      candidateLayoutKey(left, packageSize) ===
      candidateLayoutKey(right, packageSize)
    );
  }
  return descriptorsMatch(
    describeCandidateLayout(left, packageSize),
    describeCandidateLayout(right, packageSize),
    toleranceMm,
  );
}

export function selectDistinctCandidateLayouts(
  candidates: readonly SolverCandidate[],
  packageSize: RectangleSizeMm,
): SolverCandidate[] {
  const packageSizeKey = `${packageSize.length},${packageSize.width}`;
  const cached = candidateLayoutSelectionCache
    .get(candidates)
    ?.get(packageSizeKey);
  if (cached !== undefined) return cached;

  const rankedCandidates = [...candidates].sort(
    (left, right) =>
      left.rank - right.rank ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
  const exactRepresentativeByKey = new Map<string, CandidateLayoutDescriptor>();
  const representativesBySpatialKey = new Map<
    string,
    CandidateLayoutDescriptor[]
  >();
  const representatives: SolverCandidate[] = [];

  for (const candidate of rankedCandidates) {
    const descriptor = describeCandidateLayout(candidate, packageSize);
    if (exactRepresentativeByKey.has(descriptor.exactKey)) continue;

    const nearbyRepresentatives = new Set<CandidateLayoutDescriptor>();
    for (const key of nearbySpatialIndexKeys(
      descriptor.coarseKey,
      descriptor.spatialCell,
    )) {
      for (const representative of representativesBySpatialKey.get(key) ?? []) {
        nearbyRepresentatives.add(representative);
      }
    }
    if (
      [...nearbyRepresentatives].some((representative) =>
        descriptorsMatch(
          representative,
          descriptor,
          CANDIDATE_LAYOUT_POSITION_TOLERANCE_MM,
        ),
      )
    ) {
      continue;
    }

    exactRepresentativeByKey.set(descriptor.exactKey, descriptor);
    const spatialKey = spatialIndexKey(
      descriptor.coarseKey,
      descriptor.spatialCell,
    );
    const spatialPeers = representativesBySpatialKey.get(spatialKey) ?? [];
    spatialPeers.push(descriptor);
    representativesBySpatialKey.set(spatialKey, spatialPeers);
    representatives.push(candidate);
  }

  const cachedByPackageSize =
    candidateLayoutSelectionCache.get(candidates) ??
    new Map<string, SolverCandidate[]>();
  cachedByPackageSize.set(packageSizeKey, representatives);
  candidateLayoutSelectionCache.set(candidates, cachedByPackageSize);
  return representatives;
}

/**
 * Explains why a candidate ranks above the next one using exactly the score
 * components the deterministic ranker compares, in the same order. Returns
 * null when there is no following candidate to compare against.
 */
export function candidateRankReason(
  candidate: SolverCandidate,
  following: SolverCandidate | null,
): string | null {
  if (!following) return null;
  const current = candidate.score;
  const next = following.score;
  if (current.packageCount !== next.packageCount) {
    return `More packages per layer (${current.packageCount} vs ${next.packageCount})`;
  }
  if (current.utilizationMillionths !== next.utilizationMillionths) {
    return `Higher area utilization (${(current.utilizationMillionths / 10_000).toFixed(1)}% vs ${(next.utilizationMillionths / 10_000).toFixed(1)}%)`;
  }
  if (current.provisionalCycleCount !== next.provisionalCycleCount) {
    return `Fewer robot cycles (${current.provisionalCycleCount} vs ${next.provisionalCycleCount})`;
  }
  if (current.boundingBlockAreaMm2 !== next.boundingBlockAreaMm2) {
    return `Smaller bounding block (${candidate.metrics.boundingBlockLengthMm} × ${candidate.metrics.boundingBlockWidthMm} mm vs ${following.metrics.boundingBlockLengthMm} × ${following.metrics.boundingBlockWidthMm} mm)`;
  }
  if (current.boundingBlockPerimeterMm !== next.boundingBlockPerimeterMm) {
    return `Tighter bounding block perimeter (${current.boundingBlockPerimeterMm} mm vs ${next.boundingBlockPerimeterMm} mm)`;
  }
  return "Equivalent score — ranked ahead by the deterministic identity tie-break";
}
