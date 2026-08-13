import {
  boundingRectangleForPlacements,
  transformPlacement,
  type RectangleBoundsMm,
  type RectangleSizeMm,
} from "~/domain/geometry";
import {
  buildGripDeltaDependencies,
  buildGripVerticalOverlapDependencies,
  deriveGripDeltasForPlacementOrder,
  mergeGripOrderDependencies,
  orderGripsByDependencies,
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

function canonicalVector(x: number, y: number): { x: number; y: number } {
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

function transformVector(
  vector: { x: number; y: number },
  transform: StackLayerTransform,
): { x: number; y: number } {
  switch (transform) {
    case "identity":
      return canonicalVector(vector.x, vector.y);
    case "rotate-90":
      return canonicalVector(-vector.y, vector.x);
    case "rotate-180":
      return canonicalVector(-vector.x, -vector.y);
    case "rotate-270":
      return canonicalVector(vector.y, -vector.x);
    case "mirror-x":
      return canonicalVector(-vector.x, vector.y);
    case "mirror-y":
      return canonicalVector(vector.x, -vector.y);
    case "transpose-main":
      return canonicalVector(vector.y, vector.x);
    case "transpose-anti":
      return canonicalVector(-vector.y, -vector.x);
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

function deltaDependenciesForGrips(
  grips: readonly StackPatternGrip[],
  packageSize: RectangleSizeMm,
  inputDirection: 0 | 1,
): StackPatternOrderDependency[] {
  return buildGripDeltaDependencies(
    grips.map((grip) => ({ ...grip, id: grip.sourceGripId })),
    packageSize.length,
    packageSize.width,
    inputDirection,
  ).flatMap(({ prerequisiteIndex, dependentIndex }) => {
    const beforeGripId = grips[prerequisiteIndex]?.sourceGripId;
    const afterGripId = grips[dependentIndex]?.sourceGripId;
    return beforeGripId && afterGripId
      ? [{ beforeGripId, afterGripId, source: "inferred" as const }]
      : [];
  });
}

function retainedExplicitDependencies(
  pattern: StackPattern,
): StackPatternOrderDependency[] {
  return pattern.orderDependencies.flatMap((dependency) =>
    dependency.source === "inferred" ||
    (dependency.source === undefined &&
      pattern.provenance.kind === "solver-candidate")
      ? []
      : [{ ...dependency, source: dependency.source ?? "explicit" }],
  );
}

function replanGrips(
  pattern: StackPattern,
  transformedPlacements: readonly StackPatternPlacement[],
  transformedGrips: readonly StackPatternGrip[],
  packageSize: RectangleSizeMm,
  inputDirection: 0 | 1,
): Pick<TransformedStackPattern, "grips" | "groupOrder" | "orderDependencies"> {
  const verticalDependencies = buildGripVerticalOverlapDependencies(
    transformedGrips.map(({ sourceGripId }) => sourceGripId),
    transformedPlacements,
    packageSize,
  ).map((dependency) => ({ ...dependency, source: "inferred" as const }));
  const retainedDependencies = retainedExplicitDependencies(pattern);

  if (!pattern.generatedGripPolicy) {
    const orderDependencies = mergeGripOrderDependencies(
      retainedDependencies,
      deltaDependenciesForGrips(transformedGrips, packageSize, inputDirection),
      verticalDependencies,
    );
    const grips = orderGripsByDependencies(
      transformedGrips.map((grip) => ({ ...grip, id: grip.sourceGripId })),
      orderDependencies,
      pattern.groupOrder,
    ).map(({ id: _, ...grip }, sequence) => ({
      ...grip,
      sequence,
      groupNumber: sequence + 1,
    }));
    return {
      grips,
      groupOrder: grips.map(({ sourceGripId }) => sourceGripId),
      orderDependencies,
    };
  }

  const orderedGrips = orderGripsByDependencies(
    transformedGrips.map((grip) => ({ ...grip, id: grip.sourceGripId })),
    verticalDependencies,
  ).map(({ id: _, ...grip }, sequence) => ({
    ...grip,
    sequence,
    groupNumber: sequence + 1,
  }));
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
    inputDirection,
    { maxReferenceGapMm: pattern.generatedGripPolicy.maxReferenceGapMm },
  );
  const grips = orderedGrips.map((grip, index) => ({
    ...grip,
    dx: derived.deltas[index]?.dx ?? 0,
    dy: derived.deltas[index]?.dy ?? 0,
  }));
  const deltaDependencies = derived.dependencies.flatMap(
    ({ prerequisiteIndex, dependentIndex }) => {
      const beforeGripId = grips[prerequisiteIndex]?.sourceGripId;
      const afterGripId = grips[dependentIndex]?.sourceGripId;
      return beforeGripId && afterGripId
        ? [{ beforeGripId, afterGripId, source: "inferred" as const }]
        : [];
    },
  );

  return {
    grips,
    groupOrder: grips.map(({ sourceGripId }) => sourceGripId),
    orderDependencies: mergeGripOrderDependencies(
      retainedDependencies,
      verticalDependencies,
      deltaDependencies,
    ),
  };
}

export function transformStackPattern(
  pattern: StackPattern,
  transform: StackLayerTransform,
  packageSize: RectangleSizeMm,
  inletOrientation: "lengthwise" | "crosswise" = "lengthwise",
): TransformedStackPattern {
  const inputDirection = inletOrientation === "crosswise" ? 1 : 0;
  if (transform === "identity") {
    const placements = pattern.placements.map((placement) => ({
      ...placement,
      positionMm: { ...placement.positionMm },
    }));
    const copiedGrips = pattern.grips.map((grip) => ({ ...grip }));
    const plannedGrips = replanGrips(
      pattern,
      placements,
      copiedGrips,
      packageSize,
      inputDirection,
    );
    return {
      placements,
      ...plannedGrips,
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
  const plannedGrips = replanGrips(
    pattern,
    placements,
    transformedGrips,
    packageSize,
    inputDirection,
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
