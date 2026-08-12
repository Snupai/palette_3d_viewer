import {
  boundingRectangleForPlacements,
  type PlacementGeometry,
  type RectangleBoundsMm,
} from "~/domain/geometry";
import { gripsToBoxes } from "~/domain/palletGeometry";
import type { Box, Grip, PalletData, Rotation } from "~/domain/palletTypes";
import {
  candidateGeometryFingerprint,
  createCandidateGeometryId,
} from "~/domain/solver/candidateIdentity";
import { physicalFootprintOrientationHistogram } from "~/lib/parity/physicalGeometry";
import type {
  OrientationHistogram,
  RobEncodedInputSummary,
  SourceCharacterization,
  SourceCharacterizationReport,
  SourceFamily,
  SourcePatternCharacterization,
} from "~/lib/parity/types";

function solverRotation(
  sourceRotation: Rotation,
  inputDirection: 0 | 1,
): Rotation {
  return ((sourceRotation + inputDirection * 90) % 360) as Rotation;
}

function placementsFromBoxes(
  boxes: readonly Box[],
  inputDirection: 0 | 1,
): PlacementGeometry[] {
  return boxes.map((box) => ({
    positionMm: { x: box.rect.x, y: box.rect.y },
    rotation: solverRotation(box.rotation, inputDirection),
  }));
}

export function orientationHistogram(
  placements: readonly PlacementGeometry[],
): OrientationHistogram {
  const histogram: OrientationHistogram = {
    0: 0,
    90: 0,
    180: 0,
    270: 0,
  };
  for (const placement of placements) {
    histogram[`${placement.rotation}`] += 1;
  }
  return histogram;
}

function placeOrientationHistogram(
  grips: readonly Grip[],
): OrientationHistogram {
  const histogram: OrientationHistogram = { 0: 0, 90: 0, 180: 0, 270: 0 };
  for (const grip of grips) {
    histogram[`${grip.rotation}`] += grip.numPackages;
  }
  return histogram;
}

function unionBounds(
  boundsValues: readonly (RectangleBoundsMm | null)[],
): RectangleBoundsMm | null {
  const present = boundsValues.filter(
    (value): value is RectangleBoundsMm => value !== null,
  );
  if (present.length === 0) return null;
  return present.slice(1).reduce(
    (combined, bounds) => ({
      minX: Math.min(combined.minX, bounds.minX),
      minY: Math.min(combined.minY, bounds.minY),
      maxX: Math.max(combined.maxX, bounds.maxX),
      maxY: Math.max(combined.maxY, bounds.maxY),
    }),
    { ...present[0]! },
  );
}

function encodedInputSummary(data: PalletData): RobEncodedInputSummary {
  const sourceFeasiblePackageCount = Math.max(
    0,
    ...Object.values(data.uniqueLayers).map((grips) =>
      grips.reduce((count, grip) => count + grip.numPackages, 0),
    ),
  );
  return {
    packageDimensionsMm: {
      // Legacy .rob X/Y names map width to planner length and length to width.
      length: data.package.width,
      width: data.package.length,
      height: data.package.height,
    },
    palletDimensionsMm: data.pallet
      ? {
          length: data.pallet.width,
          width: data.pallet.length,
          height: data.pallet.height,
        }
      : null,
    inputDirection: {
      value: data.inputDirection,
      explicit: data.inputDirectionExplicit ?? false,
    },
    sourceFeasiblePackageCount,
    sourceFeasibleCountRole: "feasible-reference-not-asserted-maximum",
    fieldsNotEncoded: [
      "clearance",
      "allowed-overhang",
      "multipick-eligibility",
      "gripper",
      "station",
    ],
  };
}

function sourceFamily(encodedInput: RobEncodedInputSummary): SourceFamily {
  const packageDimensions = encodedInput.packageDimensionsMm;
  const palletDimensions = encodedInput.palletDimensionsMm;
  const palletPart = palletDimensions
    ? `${palletDimensions.length}x${palletDimensions.width}x${palletDimensions.height}`
    : "unknown";
  const directionPart = encodedInput.inputDirection.explicit
    ? `explicit-${encodedInput.inputDirection.value}`
    : `implicit-default-${encodedInput.inputDirection.value}`;
  return {
    id: `package-${packageDimensions.length}x${packageDimensions.width}x${packageDimensions.height}__pallet-${palletPart}__input-${directionPart}`,
    packageDimensionsMm: { ...packageDimensions },
    palletDimensionsMm: palletDimensions ? { ...palletDimensions } : null,
    inputDirection: { ...encodedInput.inputDirection },
  };
}

function characterizePattern(
  data: PalletData,
  sourceUniqueLayerId: number,
  ordinal: number,
): SourcePatternCharacterization {
  const grips = data.uniqueLayers[sourceUniqueLayerId] ?? [];
  const boxes = gripsToBoxes(
    grips,
    data.package.width,
    data.package.length,
    data.package.height,
    data.inputDirection,
  );
  const placements = placementsFromBoxes(boxes, data.inputDirection);
  const identityInput = { placements };
  const packageSize = {
    length: data.package.width,
    width: data.package.length,
  };
  return {
    ordinal,
    sourceUniqueLayerId,
    packageCount: placements.length,
    gripCount: grips.length,
    placements,
    geometryId: createCandidateGeometryId(identityInput),
    geometryFingerprint: candidateGeometryFingerprint(identityInput),
    boundsMm: boundingRectangleForPlacements(placements, packageSize),
    orientations: orientationHistogram(placements),
    placeOrientations: placeOrientationHistogram(grips),
    physicalFootprintOrientations: physicalFootprintOrientationHistogram(
      placements,
      packageSize,
    ),
  };
}

export function characterizeRobSource(
  data: PalletData,
): SourceCharacterization {
  const encodedInput = encodedInputSummary(data);
  const sourceUniqueLayerIds = Object.keys(data.uniqueLayers)
    .map(Number)
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
  const patterns = sourceUniqueLayerIds.map((sourceUniqueLayerId, index) =>
    characterizePattern(data, sourceUniqueLayerId, index + 1),
  );
  const patternBySourceId = new Map(
    patterns.map((pattern) => [pattern.sourceUniqueLayerId, pattern]),
  );
  const patternByFingerprint = new Map<string, SourcePatternCharacterization>();
  for (const pattern of patterns) {
    if (!patternByFingerprint.has(pattern.geometryFingerprint)) {
      patternByFingerprint.set(pattern.geometryFingerprint, pattern);
    }
  }

  const equalityIdByFingerprint = new Map<string, string>();
  const equalityId = (fingerprint: string): string => {
    const existing = equalityIdByFingerprint.get(fingerprint);
    if (existing) return existing;
    const created = `pattern-equality-${equalityIdByFingerprint.size + 1}`;
    equalityIdByFingerprint.set(fingerprint, created);
    return created;
  };
  for (const pattern of patterns) equalityId(pattern.geometryFingerprint);

  const packageSize = {
    length: data.package.width,
    width: data.package.length,
  };
  const physicalLayers = data.layers.map((layer, physicalLayerIndex) => {
    const placements = placementsFromBoxes(layer.boxes, data.inputDirection);
    const identityInput = { placements };
    const geometryFingerprint = candidateGeometryFingerprint(identityInput);
    const matchedPattern =
      patternBySourceId.get(layer.unique_layer_id) ??
      patternByFingerprint.get(geometryFingerprint) ??
      null;
    return {
      physicalLayerIndex,
      sourceUniqueLayerId: layer.unique_layer_id,
      sourcePatternOrdinal: matchedPattern?.ordinal ?? null,
      patternEqualityId: equalityId(geometryFingerprint),
      geometryId: createCandidateGeometryId(identityInput),
      packageCount: placements.length,
      cycleCount: new Set(layer.boxes.map((box) => box.blueNumber)).size,
      interlayerBefore: layer.zwischenlage,
      boundsMm: boundingRectangleForPlacements(placements, packageSize),
    };
  });

  return {
    encodedInput,
    family: sourceFamily(encodedInput),
    patterns,
    observedEnvelopeMm: unionBounds([
      ...patterns.map(({ boundsMm }) => boundsMm),
      ...physicalLayers.map(({ boundsMm }) => boundsMm),
    ]),
    stack: {
      physicalLayerCount: physicalLayers.length,
      sourcePatternIdentitySequence: physicalLayers.map(
        ({ sourceUniqueLayerId }) => sourceUniqueLayerId,
      ),
      patternEqualitySequence: physicalLayers.map(
        ({ patternEqualityId }) => patternEqualityId,
      ),
      physicalLayers: physicalLayers.map(
        ({ boundsMm: _boundsMm, ...layer }) => layer,
      ),
      packagesPerPhysicalLayer: physicalLayers.map(
        ({ packageCount }) => packageCount,
      ),
      cyclesPerPhysicalLayer: physicalLayers.map(
        ({ cycleCount }) => cycleCount,
      ),
      interlayersBeforePhysicalLayers: physicalLayers.map(
        ({ interlayerBefore }) => interlayerBefore,
      ),
      trailingInterlayer: data.trailingZwischenlage ?? 0,
    },
    robotics: {
      sourceGripCountsByPattern: patterns.map(({ gripCount }) => gripCount),
      sourceCyclesPerPhysicalLayer: physicalLayers.map(
        ({ cycleCount }) => cycleCount,
      ),
      parityScope: "Open",
      generatedComparison: "blocked-until-group-planning",
    },
  };
}

export function sourceCharacterizationReport(
  source: SourceCharacterization,
): SourceCharacterizationReport {
  return {
    ...source,
    patterns: source.patterns.map(
      ({
        placements: _placements,
        geometryFingerprint: _fingerprint,
        ...pattern
      }) => pattern,
    ),
  };
}
