import {
  boundingRectangleForPlacements,
  transformPlacement,
  type RectangleBoundsMm,
  type RectangleSizeMm,
} from "~/domain/geometry";
import {
  compareGripPositionsRightBottomToLeftTop,
  deriveGripDeltasForPlacementOrder,
} from "~/domain/gripDependencies";
import type { CandidateLabelSide } from "~/domain/solver/candidateIdentity";
import { selectAuthorizedYawForWorldLabel } from "~/domain/solver/labelOrientation";
import type { Side } from "~/domain/palletTypes";
import type {
  MetricProvenance,
  StackLayerTransform,
  StackPattern,
  StackPatternCycle,
  StackPatternGrip,
  StackPatternOrderDependency,
  StackPatternPlacement,
} from "~/domain/stack/types";

export type TransformedStackPattern = {
  placements: StackPatternPlacement[];
  grips: StackPatternGrip[];
  groupOrder: string[];
  orderDependencies: StackPatternOrderDependency[];
  cycles: StackPatternCycle[];
  frameMm: RectangleBoundsMm | null;
  frameProvenance: MetricProvenance;
  usedFallbackFrame: boolean;
  transformResolved: boolean;
};

const identityFrameProvenance: MetricProvenance = {
  status: "derived",
  source: "identity-transform",
  detail: "Identity does not require a transform frame.",
};

const fallbackFrameProvenance: MetricProvenance = {
  status: "unverified",
  source: "pattern-placement-bounds",
  detail:
    "No pallet/source frame was available; the transform used the package bounding rectangle.",
};

const missingFrameProvenance: MetricProvenance = {
  status: "unknown",
  source: "missing-transform-frame",
  detail:
    "The non-identity transform could not be resolved because the pattern has no frame or placements.",
};

function transformVector(
  vector: { x: number; y: number },
  transform: StackLayerTransform,
): { x: number; y: number } {
  switch (transform) {
    case "identity":
      return vector;
    case "rotate-90":
      return { x: -vector.y, y: vector.x };
    case "rotate-180":
      return { x: -vector.x, y: -vector.y };
    case "rotate-270":
      return { x: vector.y, y: -vector.x };
    case "mirror-x":
      return { x: -vector.x, y: vector.y };
    case "mirror-y":
      return { x: vector.x, y: -vector.y };
    case "transpose-main":
      return { x: vector.y, y: vector.x };
    case "transpose-anti":
      return { x: -vector.y, y: -vector.x };
  }
}

const labelVector: Record<CandidateLabelSide, { x: number; y: number }> = {
  top: { x: 0, y: 1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  top_right: { x: 1, y: 1 },
  bottom_right: { x: 1, y: -1 },
  bottom_left: { x: -1, y: -1 },
  top_left: { x: -1, y: 1 },
};

const labelForVector = new Map(
  Object.entries(labelVector).map(([label, vector]) => [
    `${vector.x},${vector.y}`,
    label as CandidateLabelSide,
  ]),
);
const packageLabelSides = new Set<CandidateLabelSide>([
  "top",
  "right",
  "bottom",
  "left",
]);

function isPackageLabelSide(label: CandidateLabelSide): label is Side {
  return packageLabelSides.has(label);
}

export function transformLabelSide(
  label: CandidateLabelSide | null,
  transform: StackLayerTransform,
): CandidateLabelSide | null {
  if (label === null || transform === "identity") return label;
  const transformed = transformVector(labelVector[label], transform);
  return labelForVector.get(`${transformed.x},${transformed.y}`) ?? label;
}

function transformGrip(
  grip: StackPatternGrip,
  frame: RectangleBoundsMm,
  transform: StackLayerTransform,
): StackPatternGrip {
  const place = transformPlacement(
    {
      positionMm: { x: grip.x, y: grip.y },
      rotation: grip.rotation,
    },
    frame,
    transform,
  );
  const labelOffset = transformVector({ x: grip.dx, y: grip.dy }, transform);
  return {
    ...grip,
    x: place.positionMm.x,
    y: place.positionMm.y,
    rotation: place.rotation,
    dx: labelOffset.x,
    dy: labelOffset.y,
  };
}

function transformCycle(
  cycle: StackPatternCycle,
  frame: RectangleBoundsMm,
  transform: StackLayerTransform,
): StackPatternCycle {
  const place = transformPlacement(
    {
      positionMm: { x: cycle.placePose.x, y: cycle.placePose.y },
      rotation: cycle.placePose.rotation,
    },
    frame,
    transform,
  );
  return {
    ...cycle,
    placePose: {
      ...cycle.placePose,
      x: place.positionMm.x,
      y: place.positionMm.y,
      rotation: place.rotation,
    },
    labelOffset: transformVector(cycle.labelOffset, transform),
  };
}

function replanGeneratedGrips(
  pattern: StackPattern,
  transformedGrips: readonly StackPatternGrip[],
  packageSize: RectangleSizeMm,
): Pick<TransformedStackPattern, "grips" | "groupOrder" | "orderDependencies"> {
  if (
    pattern.provenance.kind !== "solver-candidate" ||
    !pattern.generatedGripPolicy
  ) {
    return {
      grips: transformedGrips.map((grip) => ({ ...grip })),
      groupOrder: [...pattern.groupOrder],
      orderDependencies: pattern.orderDependencies.map((dependency) => ({
        ...dependency,
      })),
    };
  }

  const orderedGrips = [...transformedGrips]
    .sort(
      (left, right) =>
        compareGripPositionsRightBottomToLeftTop(left, right) ||
        left.sourceGripId.localeCompare(right.sourceGripId),
    )
    .map((grip, sequence) => ({ ...grip, sequence }));
  const derived = deriveGripDeltasForPlacementOrder(
    orderedGrips.map((grip) => ({
      id: grip.sourceGripId,
      pickX: grip.pickX,
      pickY: grip.pickY,
      pickRotation: grip.pickRotation,
      x: grip.x,
      y: grip.y,
      rotation: grip.rotation,
      numPackages: grip.numPackages,
      dx: grip.dx,
      dy: grip.dy,
    })),
    packageSize.length,
    packageSize.width,
    0,
    { maxReferenceGapMm: pattern.generatedGripPolicy.maxReferenceGapMm },
  );
  const grips = orderedGrips.map((grip, index) => ({
    ...grip,
    dx: derived.deltas[index]?.dx ?? 0,
    dy: derived.deltas[index]?.dy ?? 0,
  }));
  const orderDependencies = derived.dependencies
    .flatMap(({ prerequisiteIndex, dependentIndex }) => {
      const beforeGripId = grips[prerequisiteIndex]?.sourceGripId;
      const afterGripId = grips[dependentIndex]?.sourceGripId;
      return beforeGripId && afterGripId
        ? [{ beforeGripId, afterGripId }]
        : [];
    })
    .sort(
      (left, right) =>
        left.beforeGripId.localeCompare(right.beforeGripId) ||
        left.afterGripId.localeCompare(right.afterGripId),
    );

  return {
    grips,
    groupOrder: grips.map(({ sourceGripId }) => sourceGripId),
    orderDependencies,
  };
}

export function transformStackPattern(
  pattern: StackPattern,
  transform: StackLayerTransform,
  packageSize: RectangleSizeMm,
): TransformedStackPattern {
  if (transform === "identity") {
    return {
      placements: pattern.placements.map((placement) => ({
        ...placement,
        positionMm: { ...placement.positionMm },
      })),
      grips: pattern.grips.map((grip) => ({ ...grip })),
      groupOrder: [...pattern.groupOrder],
      orderDependencies: pattern.orderDependencies.map((dependency) => ({
        ...dependency,
      })),
      cycles: pattern.cycles.map((cycle) => ({
        ...cycle,
        placementIds: [...cycle.placementIds],
        pickPose: { ...cycle.pickPose },
        placePose: { ...cycle.placePose },
        labelOffset: { ...cycle.labelOffset },
      })),
      frameMm: pattern.transformFrameMm,
      frameProvenance:
        pattern.transformFrameMm === null
          ? identityFrameProvenance
          : pattern.transformFrameProvenance,
      usedFallbackFrame: false,
      transformResolved: true,
    };
  }

  const fallbackFrame =
    pattern.transformFrameMm === null
      ? boundingRectangleForPlacements(pattern.placements, packageSize)
      : null;
  const frame = pattern.transformFrameMm ?? fallbackFrame;
  if (frame === null) {
    return {
      placements: pattern.placements.map((placement) => ({
        ...placement,
        positionMm: { ...placement.positionMm },
      })),
      grips: pattern.grips.map((grip) => ({ ...grip })),
      groupOrder: [...pattern.groupOrder],
      orderDependencies: pattern.orderDependencies.map((dependency) => ({
        ...dependency,
      })),
      cycles: pattern.cycles.map((cycle) => ({
        ...cycle,
        placementIds: [...cycle.placementIds],
        pickPose: { ...cycle.pickPose },
        placePose: { ...cycle.placePose },
        labelOffset: { ...cycle.labelOffset },
      })),
      frameMm: null,
      frameProvenance: missingFrameProvenance,
      usedFallbackFrame: false,
      transformResolved: false,
    };
  }

  const placements = pattern.placements.map((placement) => {
    const transformed = transformPlacement(placement, frame, transform);
    const labelSide = transformLabelSide(placement.labelSide, transform);
    let rotation = transformed.rotation;
    if (
      pattern.labelOrientationPolicy &&
      labelSide !== null &&
      isPackageLabelSide(labelSide)
    ) {
      const authorizedRotation = selectAuthorizedYawForWorldLabel(
        transformed.rotation,
        pattern.labelOrientationPolicy.unrotatedPackageLabelSide,
        labelSide,
        pattern.labelOrientationPolicy.allowedRotations,
      );
      if (authorizedRotation === null) {
        throw new Error(
          `The ${transform} stack transform cannot preserve the selected physical label face with an allowed yaw in the transformed footprint orientation.`,
        );
      }
      rotation = authorizedRotation;
    }
    return {
      ...placement,
      positionMm: transformed.positionMm,
      rotation,
      labelSide,
    };
  });
  const transformedGrips = pattern.grips.map((grip) => {
    const transformed = transformGrip(grip, frame, transform);
    if (!pattern.labelOrientationPolicy) return transformed;
    const assigned = placements.filter(
      (placement) => placement.gripId === grip.sourceGripId,
    );
    const memberRotation = assigned[0]?.rotation;
    if (memberRotation === undefined) return transformed;
    if (assigned.some(({ rotation }) => rotation !== memberRotation)) {
      throw new Error(
        `The ${transform} stack transform produced inconsistent package yaws inside generated grip "${grip.sourceGripId}".`,
      );
    }
    return { ...transformed, rotation: memberRotation };
  });
  const plannedGrips = replanGeneratedGrips(
    pattern,
    transformedGrips,
    packageSize,
  );

  return {
    placements,
    ...plannedGrips,
    cycles: pattern.cycles.map((cycle) =>
      transformCycle(cycle, frame, transform),
    ),
    frameMm: frame,
    frameProvenance:
      pattern.transformFrameMm === null
        ? fallbackFrameProvenance
        : pattern.transformFrameProvenance,
    usedFallbackFrame: pattern.transformFrameMm === null,
    transformResolved: true,
  };
}
