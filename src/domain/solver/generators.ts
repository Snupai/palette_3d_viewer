import {
  boundingRectangleForPlacements,
  canonicalPlacementGeometryKey,
  envelopePreservingSymmetries,
  rectangleBoundsCenter,
  rectangleBoundsLength,
  rectangleBoundsWidth,
  rectangleSizeForRotation,
  transformPlacements,
} from "~/domain/geometry";
import type { RectangleBoundsMm } from "~/domain/geometry";
import {
  normalizeGeneratedCoordinateMm,
  normalizeGeneratedGeometryMetric,
  normalizeGeneratedOffsetMm,
  SOLVER_GEOMETRY_EPSILON_MM,
} from "~/domain/solver/geometryPolicy";
import { selectNearestEdgeLabelYaw } from "~/domain/solver/labelOrientation";
import { placementsUseMixedPackageOrientations } from "~/domain/solver/orientationPolicy";
import {
  assessRectangularBlockPlacements,
  maximumDistributedExtraGapMm,
} from "~/domain/solver/rectangularBlock";
import type { Rotation } from "~/domain/palletTypes";
import type {
  BaseGeneratorFamily,
  GeneratedCandidateDraft,
  GeneratedPlacement,
  GeneratorFamily,
  GeneratorProvenance,
  NormalizedLayerSolverInput,
  SolverDiagnostic,
  SolverExclusion,
} from "~/domain/solver/types";

const ALIGNMENTS = ["start", "center", "end"] as const;
type Alignment = (typeof ALIGNMENTS)[number];

const INLINE_POLICIES = [
  "start",
  "center",
  "end",
  "alternate-start-end",
  "alternate-end-start",
] as const;
type InlinePolicy = (typeof INLINE_POLICIES)[number];

type StripAxis = "horizontal" | "vertical";

const JUSTIFIED_SPACING_POLICIES = [
  "continuous-space-between",
  "integer-balanced-space-between",
] as const;
type JustifiedSpacingPolicy = (typeof JUSTIFIED_SPACING_POLICIES)[number];

export type GeneratorHooks = {
  checkpoint?: (family: GeneratorFamily, generatedCount: number) => boolean;
  shouldCancel?: () => boolean;
};

export type GeneratorOutput = {
  drafts: GeneratedCandidateDraft[];
  diagnostics: SolverDiagnostic[];
  exclusions: SolverExclusion[];
  cancelled: boolean;
};

function stableValue(value: unknown): string {
  return JSON.stringify(value);
}

function draftCollectionGeometryKey(
  input: NormalizedLayerSolverInput,
  placements: readonly GeneratedPlacement[],
): string | null {
  const allowedRotations = new Set(input.constraints.allowedRotations);
  const unrotatedPackageLabelSide = input.constraints.unrotatedPackageLabelSide;
  if (unrotatedPackageLabelSide === null) {
    return placements.every(({ rotation }) => allowedRotations.has(rotation))
      ? canonicalPlacementGeometryKey(placements)
      : null;
  }

  const orientedPlacements: GeneratedPlacement[] = [];
  for (const placement of placements) {
    const selection = selectNearestEdgeLabelYaw(
      placement.positionMm,
      placement.rotation,
      unrotatedPackageLabelSide,
      input.package.dimensionsMm,
      input.physicalPalletBoundsMm!,
      input.constraints.allowedRotations,
    );
    if (selection.status === "infeasible") return null;
    orientedPlacements.push({
      ...placement,
      rotation: selection.rotation,
    });
  }
  return canonicalPlacementGeometryKey(orientedPlacements);
}

function maxCountAlong(span: number, item: number, clearance: number): number {
  if (span < item) return 0;
  return Math.max(
    0,
    Math.floor((span + clearance + 1e-9) / (item + clearance)),
  );
}

function usedSpan(count: number, item: number, clearance: number): number {
  return count <= 0 ? 0 : count * item + (count - 1) * clearance;
}

function alignedStart(
  minimum: number,
  available: number,
  used: number,
  alignment: Alignment,
): number {
  const slack = Math.max(0, available - used);
  if (alignment === "start") return minimum;
  if (alignment === "end") return minimum + slack;
  return minimum + slack / 2;
}

function exactRequestedPackageCount(
  input: NormalizedLayerSolverInput,
): number | null {
  return input.constraints.minimumPackageCount ===
    input.constraints.maximumPackageCount &&
    input.constraints.minimumPackageCount > 0
    ? input.constraints.minimumPackageCount
    : null;
}

function distributedLineCenters(
  minimum: number,
  maximum: number,
  itemSpan: number,
  clearance: number,
  count: number,
  label: string,
): number[] {
  if (count <= 0 || maximum < minimum) return [];
  const available = maximum - minimum;
  const minimumUsed = usedSpan(count, itemSpan, clearance);
  if (minimumUsed > available + SOLVER_GEOMETRY_EPSILON_MM) return [];
  if (count === 1) {
    if (Math.abs(available - itemSpan) > SOLVER_GEOMETRY_EPSILON_MM) {
      return [];
    }
    return [
      normalizeGeneratedCoordinateMm(minimum + available / 2, `${label}[0]`),
    ];
  }

  const additionalGap = (available - minimumUsed) / (count - 1);
  if (
    additionalGap >
    maximumDistributedExtraGapMm(itemSpan) + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return [];
  }
  const step = itemSpan + clearance + additionalGap;
  return Array.from({ length: count }, (_, index) =>
    normalizeGeneratedCoordinateMm(
      minimum + itemSpan / 2 + index * step,
      `${label}[${index}]`,
    ),
  );
}

function compactLineCenters(
  minimum: number,
  maximum: number,
  itemSpan: number,
  clearance: number,
  count: number,
  label: string,
): number[] {
  if (count <= 0 || maximum < minimum) return [];
  if (
    usedSpan(count, itemSpan, clearance) >
    maximum - minimum + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return [];
  }
  return Array.from({ length: count }, (_, index) =>
    normalizeGeneratedCoordinateMm(
      minimum + itemSpan / 2 + index * (itemSpan + clearance),
      `${label}[${index}]`,
    ),
  );
}

function rectangularBlockLineCenters(
  input: NormalizedLayerSolverInput,
  minimum: number,
  maximum: number,
  itemSpan: number,
  count: number,
  label: string,
): number[] {
  return input.constraints.rectangularBlockFootprintPolicy ===
    "compact-centered"
    ? compactLineCenters(
        minimum,
        maximum,
        itemSpan,
        input.package.clearanceMm,
        count,
        label,
      )
    : distributedLineCenters(
        minimum,
        maximum,
        itemSpan,
        input.package.clearanceMm,
        count,
        label,
      );
}

function distributedSequenceCenters(
  minimum: number,
  maximum: number,
  itemSpans: readonly number[],
  clearance: number,
  label: string,
): number[] {
  if (itemSpans.length === 0 || maximum < minimum) return [];
  const available = maximum - minimum;
  const itemTotal = itemSpans.reduce((sum, itemSpan) => sum + itemSpan, 0);
  const gapCount = itemSpans.length - 1;
  const minimumUsed = itemTotal + gapCount * clearance;
  if (minimumUsed > available + SOLVER_GEOMETRY_EPSILON_MM) return [];
  if (gapCount === 0) {
    if (Math.abs(available - itemTotal) > SOLVER_GEOMETRY_EPSILON_MM) {
      return [];
    }
    return [
      normalizeGeneratedCoordinateMm(minimum + available / 2, `${label}[0]`),
    ];
  }

  const additionalGap = (available - minimumUsed) / gapCount;
  for (let index = 0; index < gapCount; index += 1) {
    const leftAllowance = maximumDistributedExtraGapMm(itemSpans[index]!);
    const rightAllowance = maximumDistributedExtraGapMm(itemSpans[index + 1]!);
    if (
      additionalGap >
      (leftAllowance + rightAllowance) / 2 + SOLVER_GEOMETRY_EPSILON_MM
    ) {
      return [];
    }
  }

  const centers: number[] = [];
  let cursor = minimum;
  itemSpans.forEach((itemSpan, index) => {
    centers.push(
      normalizeGeneratedCoordinateMm(
        cursor + itemSpan / 2,
        `${label}[${index}]`,
      ),
    );
    cursor += itemSpan + clearance + additionalGap;
  });
  return centers;
}

function compactSequenceCenters(
  minimum: number,
  maximum: number,
  itemSpans: readonly number[],
  clearance: number,
  label: string,
): number[] {
  if (itemSpans.length === 0 || maximum < minimum) return [];
  const required =
    itemSpans.reduce((sum, itemSpan) => sum + itemSpan, 0) +
    Math.max(0, itemSpans.length - 1) * clearance;
  if (required > maximum - minimum + SOLVER_GEOMETRY_EPSILON_MM) return [];

  const centers: number[] = [];
  let cursor = minimum;
  itemSpans.forEach((itemSpan, index) => {
    centers.push(
      normalizeGeneratedCoordinateMm(
        cursor + itemSpan / 2,
        `${label}[${index}]`,
      ),
    );
    cursor += itemSpan + clearance;
  });
  return centers;
}

function feasibleDistributedCounts(
  available: number,
  itemSpan: number,
  clearance: number,
  maximumCount: number,
): number[] {
  const maximum = Math.min(
    maxCountAlong(available, itemSpan, clearance),
    maximumCount,
  );
  const result: number[] = [];
  for (let count = 1; count <= maximum; count += 1) {
    if (
      distributedLineCenters(
        0,
        available,
        itemSpan,
        clearance,
        count,
        "feasibleCenters",
      ).length > 0
    ) {
      result.push(count);
    }
  }
  return result;
}

function policyAlignment(policy: InlinePolicy, index: number): Alignment {
  if (policy === "start" || policy === "center" || policy === "end") {
    return policy;
  }
  if (policy === "alternate-start-end") {
    return index % 2 === 0 ? "start" : "end";
  }
  return index % 2 === 0 ? "end" : "start";
}

function isProvenanceList(
  input: GeneratorProvenance | readonly GeneratorProvenance[],
): input is readonly GeneratorProvenance[] {
  return Array.isArray(input);
}

function uniqueProvenance(
  values: readonly GeneratorProvenance[],
): GeneratorProvenance[] {
  const byKey = new Map<string, GeneratorProvenance>();
  for (const value of values) byKey.set(stableValue(value), value);
  return [...byKey.values()];
}

type CenteredPlacements = {
  placements: GeneratedPlacement[];
  sourceGeometryKey: string;
  offsetX: number;
  offsetY: number;
};

function centerOccupiedPlacementsInGenerationBounds(
  placements: readonly GeneratedPlacement[],
  input: NormalizedLayerSolverInput,
): CenteredPlacements {
  const occupiedBounds = boundingRectangleForPlacements(
    placements,
    input.package.dimensionsMm,
  );
  if (!occupiedBounds) {
    throw new Error("Cannot center an empty generated candidate.");
  }
  const occupiedCenter = rectangleBoundsCenter(occupiedBounds);
  const targetCenter = rectangleBoundsCenter(input.generationBoundsMm);
  const offsetX = normalizeGeneratedOffsetMm(
    targetCenter.x - occupiedCenter.x,
    "occupiedCenterOffset.x",
  );
  const offsetY = normalizeGeneratedOffsetMm(
    targetCenter.y - occupiedCenter.y,
    "occupiedCenterOffset.y",
  );

  return {
    placements: placements.map((placement, index) => ({
      ...placement,
      positionMm: {
        x: normalizeGeneratedCoordinateMm(
          placement.positionMm.x + offsetX,
          `placements[${index}].positionMm.x`,
        ),
        y: normalizeGeneratedCoordinateMm(
          placement.positionMm.y + offsetY,
          `placements[${index}].positionMm.y`,
        ),
      },
    })),
    sourceGeometryKey: canonicalPlacementGeometryKey(placements),
    offsetX,
    offsetY,
  };
}

class DraftCollector {
  readonly drafts: GeneratedCandidateDraft[] = [];
  readonly diagnostics: SolverDiagnostic[] = [];
  readonly exclusions: SolverExclusion[] = [];
  private readonly draftIndexByGeometry = new Map<string, number>();
  private rejectedExactCount = 0;
  private rejectedMixedOrientation = 0;
  private rejectedRectangularShape = 0;
  private rejectedUnauthorizedYaw = 0;
  cancelled = false;
  limited = false;

  constructor(
    private readonly family: GeneratorFamily,
    private readonly input: NormalizedLayerSolverInput,
    private readonly hooks: GeneratorHooks,
  ) {}

  canContinue(): boolean {
    return !this.cancelled && !this.limited;
  }

  checkCancellation(): boolean {
    if (!this.canContinue()) return false;
    if (this.hooks.shouldCancel?.() !== true) return true;
    this.cancelled = true;
    return false;
  }

  add(
    placements: readonly GeneratedPlacement[],
    provenanceInput: GeneratorProvenance | readonly GeneratorProvenance[],
  ): boolean {
    if (!this.canContinue()) return false;
    if (placements.length === 0) return true;
    if (placements.length > this.input.constraints.maxPlacements) return true;
    const requestedExactCount = exactRequestedPackageCount(this.input);
    if (
      requestedExactCount !== null &&
      placements.length !== requestedExactCount
    ) {
      this.rejectedExactCount += 1;
      return true;
    }
    if (
      !this.input.constraints.allowMixedPackageOrientations &&
      placementsUseMixedPackageOrientations(placements)
    ) {
      this.rejectedMixedOrientation += 1;
      return true;
    }
    const provenance = isProvenanceList(provenanceInput)
      ? [...provenanceInput]
      : [provenanceInput];
    const centered = centerOccupiedPlacementsInGenerationBounds(
      placements,
      this.input,
    );
    if (this.input.constraints.requiredShape === "rectangular-block") {
      const assessment = assessRectangularBlockPlacements(
        this.input,
        centered.placements,
      );
      if (!assessment.valid) {
        this.rejectedRectangularShape += 1;
        return true;
      }
    }
    const centeredProvenance = uniqueProvenance([
      ...provenance,
      {
        family: this.family,
        variant: "occupied-bounds-center-v1",
        sourceGeometryKey: centered.sourceGeometryKey,
        parameters: {
          frame: "generationBoundsMm",
          dxMm: centered.offsetX,
          dyMm: centered.offsetY,
          coordinateResolutionMm: SOLVER_GEOMETRY_EPSILON_MM,
          afterExactCount: true,
        },
      },
    ]);
    const geometryKey = draftCollectionGeometryKey(
      this.input,
      centered.placements,
    );
    if (geometryKey === null) {
      this.rejectedUnauthorizedYaw += 1;
      return true;
    }
    const existingDraftIndex = this.draftIndexByGeometry.get(geometryKey);
    if (existingDraftIndex !== undefined) {
      const existing = this.drafts[existingDraftIndex]!;
      this.drafts[existingDraftIndex] = {
        ...existing,
        provenance: uniqueProvenance([
          ...existing.provenance,
          ...centeredProvenance,
        ]),
      };
      return true;
    }
    if (
      this.drafts.length >= this.input.constraints.maxCandidatesPerGenerator
    ) {
      this.limited = true;
      this.diagnostics.push({
        severity: "warning",
        phase: this.family === "symmetry" ? "symmetry" : "generation",
        code: "generation-limit-reached",
        message: `${this.family} generation reached the configured limit of ${this.input.constraints.maxCandidatesPerGenerator} drafts.`,
        generator: this.family,
        count: this.drafts.length,
      });
      this.exclusions.push({
        reason: "generation-limit",
        provenance: centeredProvenance,
        issues: [],
        message: `Further ${this.family} variants were not generated after the deterministic family limit was reached.`,
      });
      return false;
    }

    const draftIndex = this.drafts.length;
    this.drafts.push({
      placements: centered.placements.map((placement, placementIndex) => ({
        ...placement,
        positionMm: { ...placement.positionMm },
        transientId: `${this.family}-${draftIndex}-${placementIndex}`,
      })),
      provenance: centeredProvenance,
    });
    this.draftIndexByGeometry.set(geometryKey, draftIndex);
    if (this.hooks.checkpoint?.(this.family, this.drafts.length) === false) {
      this.cancelled = true;
      return false;
    }
    return true;
  }

  output(): GeneratorOutput {
    const phase = this.family === "symmetry" ? "symmetry" : "generation";
    const filteredDiagnostics: SolverDiagnostic[] = [];
    if (this.rejectedExactCount > 0) {
      filteredDiagnostics.push({
        severity: "info",
        phase,
        code: "exact-count-source-rejected",
        message: `${this.family} rejected ${this.rejectedExactCount} complete source layouts because their package count did not exactly match the requested count.`,
        generator: this.family,
        count: this.rejectedExactCount,
      });
    }
    if (this.rejectedMixedOrientation > 0) {
      filteredDiagnostics.push({
        severity: "info",
        phase,
        code: "mixed-orientation-source-rejected",
        message: `${this.family} rejected ${this.rejectedMixedOrientation} layouts because mixed package orientations are disabled.`,
        generator: this.family,
        count: this.rejectedMixedOrientation,
      });
    }
    if (this.rejectedRectangularShape > 0) {
      filteredDiagnostics.push({
        severity: "info",
        phase,
        code: "rectangular-shape-source-rejected",
        message: `${this.family} rejected ${this.rejectedRectangularShape} layouts with a missing corner, uncovered area, or excessive distributed spacing.`,
        generator: this.family,
        count: this.rejectedRectangularShape,
      });
    }
    if (this.rejectedUnauthorizedYaw > 0) {
      filteredDiagnostics.push({
        severity: "info",
        phase,
        code: "unauthorized-yaw-source-rejected",
        message: `${this.family} rejected ${this.rejectedUnauthorizedYaw} layouts because at least one placement could not be finalized to an allowed yaw.`,
        generator: this.family,
        count: this.rejectedUnauthorizedYaw,
      });
    }
    return {
      drafts: this.drafts,
      diagnostics: [...this.diagnostics, ...filteredDiagnostics],
      exclusions: this.exclusions,
      cancelled: this.cancelled,
    };
  }
}

function uniformStripPlacements(
  input: NormalizedLayerSolverInput,
  axis: StripAxis,
  rotation: Rotation,
  inlinePolicy: InlinePolicy,
  crossAlignment: Alignment,
): GeneratedPlacement[] {
  const envelope = input.generationBoundsMm;
  const length = rectangleBoundsLength(envelope);
  const width = rectangleBoundsWidth(envelope);
  const clearance = input.package.clearanceMm;
  const footprint = rectangleSizeForRotation(
    input.package.dimensionsMm,
    rotation,
  );
  const horizontal = axis === "horizontal";
  const inlineAvailable = horizontal ? length : width;
  const crossAvailable = horizontal ? width : length;
  const inlineItem = horizontal ? footprint.length : footprint.width;
  const crossItem = horizontal ? footprint.width : footprint.length;
  const inlineCount = maxCountAlong(inlineAvailable, inlineItem, clearance);
  const bandCount = Math.min(
    maxCountAlong(crossAvailable, crossItem, clearance),
    input.constraints.maxBands,
  );
  if (inlineCount === 0 || bandCount === 0) return [];
  if (inlineCount * bandCount > input.constraints.maxPlacements) return [];

  const crossUsed = usedSpan(bandCount, crossItem, clearance);
  const crossMinimum = horizontal ? envelope.minY : envelope.minX;
  const crossStart = alignedStart(
    crossMinimum,
    crossAvailable,
    crossUsed,
    crossAlignment,
  );
  const placements: GeneratedPlacement[] = [];
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const alignment = policyAlignment(inlinePolicy, bandIndex);
    const inlineUsed = usedSpan(inlineCount, inlineItem, clearance);
    const inlineMinimum = horizontal ? envelope.minX : envelope.minY;
    const inlineStart = alignedStart(
      inlineMinimum,
      inlineAvailable,
      inlineUsed,
      alignment,
    );
    for (let itemIndex = 0; itemIndex < inlineCount; itemIndex += 1) {
      const inlineCenter =
        inlineStart + inlineItem / 2 + itemIndex * (inlineItem + clearance);
      const crossCenter =
        crossStart + crossItem / 2 + bandIndex * (crossItem + clearance);
      placements.push({
        positionMm: horizontal
          ? { x: inlineCenter, y: crossCenter }
          : { x: crossCenter, y: inlineCenter },
        rotation,
      });
    }
  }
  return placements;
}

function exactRectangularGridPlacements(
  input: NormalizedLayerSolverInput,
  rotation: Rotation,
  columnCount: number,
  rowCount: number,
): GeneratedPlacement[] {
  if (columnCount <= 0 || rowCount <= 0) return [];
  if (columnCount * rowCount > input.constraints.maxPlacements) return [];
  const footprint = rectangleSizeForRotation(
    input.package.dimensionsMm,
    rotation,
  );
  const xCenters = rectangularBlockLineCenters(
    input,
    input.generationBoundsMm.minX,
    input.generationBoundsMm.maxX,
    footprint.length,
    columnCount,
    "exactGrid.x",
  );
  const yCenters = rectangularBlockLineCenters(
    input,
    input.generationBoundsMm.minY,
    input.generationBoundsMm.maxY,
    footprint.width,
    rowCount,
    "exactGrid.y",
  );
  if (xCenters.length !== columnCount || yCenters.length !== rowCount)
    return [];

  return yCenters.flatMap((y) =>
    xCenters.map((x) => ({ positionMm: { x, y }, rotation })),
  );
}

function exactFactorPairs(count: number): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = [];
  for (let factor = 1; factor * factor <= count; factor += 1) {
    if (count % factor !== 0) continue;
    const complement = count / factor;
    pairs.push([complement, factor]);
    if (factor !== complement) pairs.push([factor, complement]);
  }
  return pairs;
}

type ExactRectangularGridDescriptor = {
  rotation: Rotation;
  columnCount: number;
  rowCount: number;
  occupiedAreaMm2: number;
  occupiedPerimeterMm: number;
};

function compactExactRectangularGridDescriptors(
  input: NormalizedLayerSolverInput,
  count: number,
): ExactRectangularGridDescriptor[] {
  const availableLength = rectangleBoundsLength(input.generationBoundsMm);
  const availableWidth = rectangleBoundsWidth(input.generationBoundsMm);
  const clearance = input.package.clearanceMm;
  const descriptors: ExactRectangularGridDescriptor[] = [];
  for (const rotation of input.constraints.allowedRotations) {
    const footprint = rectangleSizeForRotation(
      input.package.dimensionsMm,
      rotation,
    );
    for (const [columnCount, rowCount] of exactFactorPairs(count)) {
      if (rowCount > input.constraints.maxBands) continue;
      const occupiedLength = usedSpan(columnCount, footprint.length, clearance);
      const occupiedWidth = usedSpan(rowCount, footprint.width, clearance);
      if (
        occupiedLength > availableLength + SOLVER_GEOMETRY_EPSILON_MM ||
        occupiedWidth > availableWidth + SOLVER_GEOMETRY_EPSILON_MM
      ) {
        continue;
      }
      descriptors.push({
        rotation,
        columnCount,
        rowCount,
        occupiedAreaMm2: occupiedLength * occupiedWidth,
        occupiedPerimeterMm: 2 * (occupiedLength + occupiedWidth),
      });
    }
  }
  return descriptors.sort(
    (left, right) =>
      left.occupiedAreaMm2 - right.occupiedAreaMm2 ||
      left.occupiedPerimeterMm - right.occupiedPerimeterMm ||
      left.rotation - right.rotation ||
      left.columnCount - right.columnCount ||
      left.rowCount - right.rowCount,
  );
}

function generateRows(
  input: NormalizedLayerSolverInput,
  hooks: GeneratorHooks,
): GeneratorOutput {
  const collector = new DraftCollector("row", input, hooks);
  const exactCount = exactRequestedPackageCount(input);
  if (
    exactCount !== null &&
    input.constraints.requiredShape === "rectangular-block"
  ) {
    if (
      input.constraints.rectangularBlockFootprintPolicy === "compact-centered"
    ) {
      for (const descriptor of compactExactRectangularGridDescriptors(
        input,
        exactCount,
      )) {
        if (!collector.canContinue()) return collector.output();
        collector.add(
          exactRectangularGridPlacements(
            input,
            descriptor.rotation,
            descriptor.columnCount,
            descriptor.rowCount,
          ),
          {
            family: "row",
            variant: "exact-rectangular-grid-compact",
            parameters: {
              rotation: descriptor.rotation,
              columnCount: descriptor.columnCount,
              rowCount: descriptor.rowCount,
              requestedCount: exactCount,
              spacingPolicy: "clearance-only",
            },
          },
        );
      }
      return collector.output();
    } else {
      for (const rotation of input.constraints.allowedRotations) {
        for (const [columnCount, rowCount] of exactFactorPairs(exactCount)) {
          if (rowCount > input.constraints.maxBands) continue;
          if (!collector.canContinue()) return collector.output();
          collector.add(
            exactRectangularGridPlacements(
              input,
              rotation,
              columnCount,
              rowCount,
            ),
            {
              family: "row",
              variant: "exact-rectangular-grid-space-between",
              parameters: {
                rotation,
                columnCount,
                rowCount,
                requestedCount: exactCount,
                spacingPolicy: "bounded-space-between",
              },
            },
          );
        }
      }
    }
  }
  for (const rotation of input.constraints.allowedRotations) {
    for (const axis of ["horizontal", "vertical"] as const) {
      for (const inlinePolicy of INLINE_POLICIES) {
        for (const crossAlignment of ALIGNMENTS) {
          if (!collector.canContinue()) return collector.output();
          collector.add(
            uniformStripPlacements(
              input,
              axis,
              rotation,
              inlinePolicy,
              crossAlignment,
            ),
            {
              family: "row",
              variant: `${axis}-${inlinePolicy}-${crossAlignment}`,
              parameters: { axis, rotation, inlinePolicy, crossAlignment },
            },
          );
        }
      }
    }
  }
  return collector.output();
}

function footprintRepresentatives(
  rotations: readonly Rotation[],
): [Rotation, Rotation] | null {
  const lengthwise = rotations.find(
    (rotation) => rotation === 0 || rotation === 180,
  );
  const crosswise = rotations.find(
    (rotation) => rotation === 90 || rotation === 270,
  );
  return lengthwise === undefined || crosswise === undefined
    ? null
    : [lengthwise, crosswise];
}

function alternatingOrder(
  first: Rotation,
  firstCount: number,
  second: Rotation,
  secondCount: number,
): Rotation[] {
  const result: Rotation[] = [];
  let remainingFirst = firstCount;
  let remainingSecond = secondCount;
  while (remainingFirst > 0 || remainingSecond > 0) {
    if (remainingFirst > 0) {
      result.push(first);
      remainingFirst -= 1;
    }
    if (remainingSecond > 0) {
      result.push(second);
      remainingSecond -= 1;
    }
  }
  return result;
}

function mixedOrderVariants(
  first: Rotation,
  firstCount: number,
  second: Rotation,
  secondCount: number,
): Array<{ name: string; rotations: Rotation[] }> {
  const groupedFirst = [
    ...Array<Rotation>(firstCount).fill(first),
    ...Array<Rotation>(secondCount).fill(second),
  ];
  const groupedSecond = [
    ...Array<Rotation>(secondCount).fill(second),
    ...Array<Rotation>(firstCount).fill(first),
  ];
  const variants = [
    { name: "grouped-lengthwise-first", rotations: groupedFirst },
    { name: "grouped-crosswise-first", rotations: groupedSecond },
    {
      name: "alternating-lengthwise-first",
      rotations: alternatingOrder(first, firstCount, second, secondCount),
    },
    {
      name: "alternating-crosswise-first",
      rotations: alternatingOrder(second, secondCount, first, firstCount),
    },
  ];
  const seen = new Set<string>();
  return variants.filter(({ rotations: orderedRotations }) => {
    const key = orderedRotations.join(",");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const COMPACT_MIXED_ORDER_NAMES = [
  "grouped-lengthwise-first",
  "grouped-crosswise-first",
  "alternating-lengthwise-first",
  "alternating-crosswise-first",
] as const;
type CompactMixedOrderName = (typeof COMPACT_MIXED_ORDER_NAMES)[number];

type CompactMixedDescriptor = {
  axis: StripAxis;
  lengthwiseBandCount: number;
  crosswiseBandCount: number;
  inlineCounts: readonly number[];
  orderName: CompactMixedOrderName;
  orderRank: number;
  occupiedAreaMm2: number;
  occupiedPerimeterMm: number;
};

type CompactInlineCountRange = {
  minimum: number;
  maximum: number;
};

function compactMixedOrderNames(
  lengthwiseBandCount: number,
  crosswiseBandCount: number,
): CompactMixedOrderName[] {
  const names: CompactMixedOrderName[] = [
    "grouped-lengthwise-first",
    "grouped-crosswise-first",
  ];
  if (lengthwiseBandCount > 1) {
    names.push("alternating-lengthwise-first");
  }
  if (crosswiseBandCount > 1) {
    names.push("alternating-crosswise-first");
  }
  return names;
}

function compactMixedOrderRotations(
  orderName: CompactMixedOrderName,
  lengthwise: Rotation,
  lengthwiseBandCount: number,
  crosswise: Rotation,
  crosswiseBandCount: number,
): Rotation[] {
  if (orderName === "grouped-lengthwise-first") {
    return [
      ...Array<Rotation>(lengthwiseBandCount).fill(lengthwise),
      ...Array<Rotation>(crosswiseBandCount).fill(crosswise),
    ];
  }
  if (orderName === "grouped-crosswise-first") {
    return [
      ...Array<Rotation>(crosswiseBandCount).fill(crosswise),
      ...Array<Rotation>(lengthwiseBandCount).fill(lengthwise),
    ];
  }
  return orderName === "alternating-lengthwise-first"
    ? alternatingOrder(
        lengthwise,
        lengthwiseBandCount,
        crosswise,
        crosswiseBandCount,
      )
    : alternatingOrder(
        crosswise,
        crosswiseBandCount,
        lengthwise,
        lengthwiseBandCount,
      );
}

function compactInlineCountRange(
  sharedSpan: number,
  itemSpan: number,
  clearance: number,
  maximumCount: number,
): CompactInlineCountRange | null {
  const maximum = Math.min(
    maxCountAlong(sharedSpan, itemSpan, clearance),
    maximumCount,
  );
  if (maximum <= 0) return null;

  const maximumExtraGap = maximumDistributedExtraGapMm(itemSpan);
  let minimum =
    Math.abs(sharedSpan - itemSpan) <= SOLVER_GEOMETRY_EPSILON_MM
      ? 1
      : Math.max(
          2,
          Math.ceil(
            (sharedSpan +
              clearance +
              maximumExtraGap -
              SOLVER_GEOMETRY_EPSILON_MM) /
              (itemSpan + clearance + maximumExtraGap),
          ),
        );
  while (
    minimum <= maximum &&
    !distributedInlineSpanIsFeasible(sharedSpan, itemSpan, clearance, minimum)
  ) {
    minimum += 1;
  }
  while (
    minimum > 1 &&
    distributedInlineSpanIsFeasible(
      sharedSpan,
      itemSpan,
      clearance,
      minimum - 1,
    )
  ) {
    minimum -= 1;
  }
  return minimum <= maximum ? { minimum, maximum } : null;
}

function maximumCompactMixedPackageCountAtSpan(
  sharedSpan: number,
  lengthwiseBandCount: number,
  crosswiseBandCount: number,
  lengthwiseInlineSpan: number,
  crosswiseInlineSpan: number,
  clearance: number,
  requestedCount: number,
): number {
  return (
    lengthwiseBandCount *
      Math.min(
        maxCountAlong(sharedSpan, lengthwiseInlineSpan, clearance),
        requestedCount,
      ) +
    crosswiseBandCount *
      Math.min(
        maxCountAlong(sharedSpan, crosswiseInlineSpan, clearance),
        requestedCount,
      )
  );
}

function compactNaturalSpanCandidates(
  thresholds: readonly number[],
  itemSpan: number,
  clearance: number,
  maximumCount: number,
): number[] {
  const candidates: number[] = [];
  for (const threshold of thresholds) {
    const approximateCount = (threshold + clearance) / (itemSpan + clearance);
    const firstCount = Math.max(1, Math.floor(approximateCount) - 3);
    const lastCount = Math.min(
      maximumCount,
      Math.max(firstCount, Math.ceil(approximateCount) + 3),
    );
    for (let count = firstCount; count <= lastCount; count += 1) {
      candidates.push(usedSpan(count, itemSpan, clearance));
    }
  }
  return candidates;
}

function minimumCompactMixedSharedInlineSpan(
  requestedCount: number,
  lengthwiseBandCount: number,
  crosswiseBandCount: number,
  lengthwiseInlineSpan: number,
  crosswiseInlineSpan: number,
  clearance: number,
  inlineAvailable: number,
): {
  sharedSpan: number;
  lengthwiseRange: CompactInlineCountRange;
  crosswiseRange: CompactInlineCountRange;
} | null {
  const minimumSharedSpan = Math.max(lengthwiseInlineSpan, crosswiseInlineSpan);
  if (
    minimumSharedSpan > inlineAvailable + SOLVER_GEOMETRY_EPSILON_MM ||
    maximumCompactMixedPackageCountAtSpan(
      inlineAvailable,
      lengthwiseBandCount,
      crosswiseBandCount,
      lengthwiseInlineSpan,
      crosswiseInlineSpan,
      clearance,
      requestedCount,
    ) < requestedCount
  ) {
    return null;
  }

  let lower = minimumSharedSpan;
  let upper = inlineAvailable;
  for (let iteration = 0; iteration < 64; iteration += 1) {
    const middle = lower + (upper - lower) / 2;
    if (
      maximumCompactMixedPackageCountAtSpan(
        middle,
        lengthwiseBandCount,
        crosswiseBandCount,
        lengthwiseInlineSpan,
        crosswiseInlineSpan,
        clearance,
        requestedCount,
      ) >= requestedCount
    ) {
      upper = middle;
    } else {
      lower = middle;
    }
  }

  const candidates = [
    minimumSharedSpan,
    ...compactNaturalSpanCandidates(
      [lower, upper],
      lengthwiseInlineSpan,
      clearance,
      requestedCount,
    ),
    ...compactNaturalSpanCandidates(
      [lower, upper],
      crosswiseInlineSpan,
      clearance,
      requestedCount,
    ),
  ].sort((left, right) => left - right);
  let previous: number | null = null;
  for (const rawCandidate of candidates) {
    if (
      (previous !== null &&
        Math.abs(rawCandidate - previous) <= SOLVER_GEOMETRY_EPSILON_MM) ||
      rawCandidate < minimumSharedSpan - SOLVER_GEOMETRY_EPSILON_MM ||
      rawCandidate > inlineAvailable + SOLVER_GEOMETRY_EPSILON_MM
    ) {
      continue;
    }
    previous = rawCandidate;
    const sharedSpan = normalizeGeneratedGeometryMetric(
      rawCandidate,
      "compactMixed.sharedInlineSpan",
    );
    const lengthwiseRange = compactInlineCountRange(
      sharedSpan,
      lengthwiseInlineSpan,
      clearance,
      requestedCount,
    );
    const crosswiseRange = compactInlineCountRange(
      sharedSpan,
      crosswiseInlineSpan,
      clearance,
      requestedCount,
    );
    if (!lengthwiseRange || !crosswiseRange) continue;
    const minimumPackageCount =
      lengthwiseBandCount * lengthwiseRange.minimum +
      crosswiseBandCount * crosswiseRange.minimum;
    const maximumPackageCount =
      lengthwiseBandCount * lengthwiseRange.maximum +
      crosswiseBandCount * crosswiseRange.maximum;
    if (
      requestedCount >= minimumPackageCount &&
      requestedCount <= maximumPackageCount
    ) {
      return { sharedSpan, lengthwiseRange, crosswiseRange };
    }
  }
  return null;
}

function compactMixedInlineCounts(
  rotations: readonly Rotation[],
  lengthwise: Rotation,
  lengthwiseRange: CompactInlineCountRange,
  crosswiseRange: CompactInlineCountRange,
  lengthwiseInlineSpan: number,
  crosswiseInlineSpan: number,
  sharedSpan: number,
  clearance: number,
  requestedCount: number,
): number[] | null {
  const ranges = rotations.map((rotation) =>
    rotation === lengthwise ? lengthwiseRange : crosswiseRange,
  );
  const itemSpans = rotations.map((rotation) =>
    rotation === lengthwise ? lengthwiseInlineSpan : crosswiseInlineSpan,
  );
  const anchorIndices = ranges.flatMap((range, index) =>
    Math.abs(
      usedSpan(range.maximum, itemSpans[index]!, clearance) - sharedSpan,
    ) <= SOLVER_GEOMETRY_EPSILON_MM
      ? [index]
      : [],
  );

  for (const anchorIndex of anchorIndices) {
    const counts = ranges.map(({ minimum }) => minimum);
    counts[anchorIndex] = ranges[anchorIndex]!.maximum;
    let remaining =
      requestedCount - counts.reduce((sum, count) => sum + count, 0);
    if (remaining < 0) continue;
    const capacities = ranges.map(
      ({ maximum }, index) => maximum - counts[index]!,
    );
    const suffixCapacity = Array<number>(capacities.length + 1).fill(0);
    for (let index = capacities.length - 1; index >= 0; index -= 1) {
      suffixCapacity[index] = suffixCapacity[index + 1]! + capacities[index]!;
    }
    if (remaining > suffixCapacity[0]!) continue;

    for (let index = 0; index < counts.length && remaining > 0; index += 1) {
      const capacity = capacities[index]!;
      const minimumAddition = Math.max(
        0,
        remaining - suffixCapacity[index + 1]!,
      );
      const preferredAddition = Math.min(
        capacity,
        Math.ceil(remaining / (counts.length - index)),
      );
      const addition = Math.max(minimumAddition, preferredAddition);
      counts[index] = counts[index]! + addition;
      remaining -= addition;
    }
    if (remaining !== 0) continue;
    if (
      counts.every((count, index) =>
        distributedInlineSpanIsFeasible(
          sharedSpan,
          itemSpans[index]!,
          clearance,
          count,
        ),
      )
    ) {
      return counts;
    }
  }
  return null;
}

function distributedInlineSpanIsFeasible(
  sharedSpan: number,
  itemSpan: number,
  clearance: number,
  count: number,
): boolean {
  const naturalSpan = usedSpan(count, itemSpan, clearance);
  if (naturalSpan > sharedSpan + SOLVER_GEOMETRY_EPSILON_MM) return false;
  if (count === 1) {
    return Math.abs(sharedSpan - itemSpan) <= SOLVER_GEOMETRY_EPSILON_MM;
  }
  return (
    (sharedSpan - naturalSpan) / (count - 1) <=
    maximumDistributedExtraGapMm(itemSpan) + SOLVER_GEOMETRY_EPSILON_MM
  );
}

function compareNumberArrays(
  left: readonly number[],
  right: readonly number[],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function compareCompactMixedDescriptors(
  left: CompactMixedDescriptor,
  right: CompactMixedDescriptor,
): number {
  return (
    left.occupiedAreaMm2 - right.occupiedAreaMm2 ||
    left.occupiedPerimeterMm - right.occupiedPerimeterMm ||
    (left.axis === right.axis ? 0 : left.axis === "horizontal" ? -1 : 1) ||
    left.lengthwiseBandCount - right.lengthwiseBandCount ||
    left.crosswiseBandCount - right.crosswiseBandCount ||
    left.orderRank - right.orderRank ||
    compareNumberArrays(left.inlineCounts, right.inlineCounts)
  );
}

function siftCompactMixedDescriptorUp(
  heap: CompactMixedDescriptor[],
  startIndex: number,
): void {
  let index = startIndex;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (compareCompactMixedDescriptors(heap[parentIndex]!, heap[index]!) >= 0) {
      return;
    }
    [heap[parentIndex], heap[index]] = [heap[index]!, heap[parentIndex]!];
    index = parentIndex;
  }
}

function siftCompactMixedDescriptorDown(
  heap: CompactMixedDescriptor[],
  startIndex: number,
): void {
  let index = startIndex;
  while (true) {
    const leftIndex = index * 2 + 1;
    const rightIndex = leftIndex + 1;
    let worseIndex = index;
    if (
      leftIndex < heap.length &&
      compareCompactMixedDescriptors(heap[leftIndex]!, heap[worseIndex]!) > 0
    ) {
      worseIndex = leftIndex;
    }
    if (
      rightIndex < heap.length &&
      compareCompactMixedDescriptors(heap[rightIndex]!, heap[worseIndex]!) > 0
    ) {
      worseIndex = rightIndex;
    }
    if (worseIndex === index) return;
    [heap[index], heap[worseIndex]] = [heap[worseIndex]!, heap[index]!];
    index = worseIndex;
  }
}

function retainCompactMixedDescriptor(
  heap: CompactMixedDescriptor[],
  descriptor: CompactMixedDescriptor,
  capacity: number,
): void {
  if (heap.length < capacity) {
    heap.push(descriptor);
    siftCompactMixedDescriptorUp(heap, heap.length - 1);
    return;
  }
  if (compareCompactMixedDescriptors(descriptor, heap[0]!) >= 0) return;
  heap[0] = descriptor;
  siftCompactMixedDescriptorDown(heap, 0);
}

function mixedStripPlacements(
  input: NormalizedLayerSolverInput,
  axis: StripAxis,
  rotations: readonly Rotation[],
  inlinePolicy: InlinePolicy,
  crossAlignment: Alignment,
): GeneratedPlacement[] {
  const envelope = input.generationBoundsMm;
  const length = rectangleBoundsLength(envelope);
  const width = rectangleBoundsWidth(envelope);
  const clearance = input.package.clearanceMm;
  const horizontal = axis === "horizontal";
  const inlineAvailable = horizontal ? length : width;
  const crossAvailable = horizontal ? width : length;
  const crossSizes = rotations.map((rotation) => {
    const footprint = rectangleSizeForRotation(
      input.package.dimensionsMm,
      rotation,
    );
    return horizontal ? footprint.width : footprint.length;
  });
  const crossUsed =
    crossSizes.reduce((sum, size) => sum + size, 0) +
    Math.max(0, rotations.length - 1) * clearance;
  const crossMinimum = horizontal ? envelope.minY : envelope.minX;
  const crossStart = alignedStart(
    crossMinimum,
    crossAvailable,
    crossUsed,
    crossAlignment,
  );
  const placements: GeneratedPlacement[] = [];
  let crossCursor = crossStart;

  for (let bandIndex = 0; bandIndex < rotations.length; bandIndex += 1) {
    const rotation = rotations[bandIndex]!;
    const footprint = rectangleSizeForRotation(
      input.package.dimensionsMm,
      rotation,
    );
    const inlineItem = horizontal ? footprint.length : footprint.width;
    const crossItem = horizontal ? footprint.width : footprint.length;
    const inlineCount = maxCountAlong(inlineAvailable, inlineItem, clearance);
    if (inlineCount === 0) return [];
    const inlineUsed = usedSpan(inlineCount, inlineItem, clearance);
    const inlineMinimum = horizontal ? envelope.minX : envelope.minY;
    const inlineStart = alignedStart(
      inlineMinimum,
      inlineAvailable,
      inlineUsed,
      policyAlignment(inlinePolicy, bandIndex),
    );
    for (let itemIndex = 0; itemIndex < inlineCount; itemIndex += 1) {
      const inlineCenter =
        inlineStart + inlineItem / 2 + itemIndex * (inlineItem + clearance);
      const crossCenter = crossCursor + crossItem / 2;
      placements.push({
        positionMm: horizontal
          ? { x: inlineCenter, y: crossCenter }
          : { x: crossCenter, y: inlineCenter },
        rotation,
      });
      if (placements.length > input.constraints.maxPlacements) return [];
    }
    crossCursor += crossItem + clearance;
  }
  return placements;
}

function rectangularMixedStripPlacements(
  input: NormalizedLayerSolverInput,
  axis: StripAxis,
  rotations: readonly Rotation[],
  inlineCounts: readonly number[],
): GeneratedPlacement[] {
  if (inlineCounts.length !== rotations.length) return [];
  const horizontal = axis === "horizontal";
  const envelope = input.generationBoundsMm;
  const generationInlineMinimum = horizontal ? envelope.minX : envelope.minY;
  const generationInlineMaximum = horizontal ? envelope.maxX : envelope.maxY;
  const generationCrossMinimum = horizontal ? envelope.minY : envelope.minX;
  const generationCrossMaximum = horizontal ? envelope.maxY : envelope.maxX;
  const footprints = rotations.map((rotation) =>
    rectangleSizeForRotation(input.package.dimensionsMm, rotation),
  );
  const inlineSpans = footprints.map((footprint) =>
    horizontal ? footprint.length : footprint.width,
  );
  const crossSpans = footprints.map((footprint) =>
    horizontal ? footprint.width : footprint.length,
  );
  const compactCentered =
    input.constraints.rectangularBlockFootprintPolicy === "compact-centered";
  const compactInlineSpan = Math.max(
    ...inlineCounts.map((count, index) =>
      usedSpan(count, inlineSpans[index]!, input.package.clearanceMm),
    ),
  );
  const compactCrossSpan =
    crossSpans.reduce((sum, span) => sum + span, 0) +
    Math.max(0, crossSpans.length - 1) * input.package.clearanceMm;
  const inlineMinimum = generationInlineMinimum;
  const inlineMaximum = compactCentered
    ? inlineMinimum + compactInlineSpan
    : generationInlineMaximum;
  const crossMinimum = generationCrossMinimum;
  const crossMaximum = compactCentered
    ? crossMinimum + compactCrossSpan
    : generationCrossMaximum;
  if (
    inlineMaximum > generationInlineMaximum + SOLVER_GEOMETRY_EPSILON_MM ||
    crossMaximum > generationCrossMaximum + SOLVER_GEOMETRY_EPSILON_MM
  ) {
    return [];
  }
  const crossCenters = compactCentered
    ? compactSequenceCenters(
        crossMinimum,
        crossMaximum,
        crossSpans,
        input.package.clearanceMm,
        "rectangularMixed.cross",
      )
    : distributedSequenceCenters(
        crossMinimum,
        crossMaximum,
        crossSpans,
        input.package.clearanceMm,
        "rectangularMixed.cross",
      );
  if (crossCenters.length !== rotations.length) return [];

  const placements: GeneratedPlacement[] = [];
  for (let bandIndex = 0; bandIndex < rotations.length; bandIndex += 1) {
    const rotation = rotations[bandIndex]!;
    const inlineCount = inlineCounts[bandIndex]!;
    const inlineCenters = distributedLineCenters(
      inlineMinimum,
      inlineMaximum,
      inlineSpans[bandIndex]!,
      input.package.clearanceMm,
      inlineCount,
      `rectangularMixed.inline[${bandIndex}]`,
    );
    if (inlineCenters.length !== inlineCount) return [];
    for (const inlineCenter of inlineCenters) {
      placements.push({
        positionMm: horizontal
          ? { x: inlineCenter, y: crossCenters[bandIndex]! }
          : { x: crossCenters[bandIndex]!, y: inlineCenter },
        rotation,
      });
      if (placements.length > input.constraints.maxPlacements) return [];
    }
  }
  return placements;
}

function generateCompactExactRectangularMixedOrientation(
  input: NormalizedLayerSolverInput,
  collector: DraftCollector,
  lengthwise: Rotation,
  crosswise: Rotation,
): GeneratorOutput {
  if (!collector.checkCancellation()) return collector.output();
  const requestedCount = exactRequestedPackageCount(input)!;
  const clearance = input.package.clearanceMm;
  const retainedDescriptors: CompactMixedDescriptor[] = [];
  const descriptorCapacity = input.constraints.maxCandidatesPerGenerator + 1;
  const lengthwiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    lengthwise,
  );
  const crosswiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    crosswise,
  );

  for (const axis of ["horizontal", "vertical"] as const) {
    const horizontal = axis === "horizontal";
    const inlineAvailable = horizontal
      ? rectangleBoundsLength(input.generationBoundsMm)
      : rectangleBoundsWidth(input.generationBoundsMm);
    const crossAvailable = horizontal
      ? rectangleBoundsWidth(input.generationBoundsMm)
      : rectangleBoundsLength(input.generationBoundsMm);
    const lengthwiseInline = horizontal
      ? lengthwiseSize.length
      : lengthwiseSize.width;
    const crosswiseInline = horizontal
      ? crosswiseSize.length
      : crosswiseSize.width;
    const lengthwiseCross = horizontal
      ? lengthwiseSize.width
      : lengthwiseSize.length;
    const crosswiseCross = horizontal
      ? crosswiseSize.width
      : crosswiseSize.length;
    const maximumLengthwiseBandCount = Math.min(
      maxCountAlong(crossAvailable, lengthwiseCross, clearance),
      input.constraints.maxBands - 1,
    );
    const maximumCrosswiseBandCount = Math.min(
      maxCountAlong(crossAvailable, crosswiseCross, clearance),
      input.constraints.maxBands - 1,
    );

    for (
      let lengthwiseBandCount = 1;
      lengthwiseBandCount <= maximumLengthwiseBandCount;
      lengthwiseBandCount += 1
    ) {
      for (
        let crosswiseBandCount = 1;
        crosswiseBandCount <= maximumCrosswiseBandCount;
        crosswiseBandCount += 1
      ) {
        if (!collector.checkCancellation()) return collector.output();
        const bandCount = lengthwiseBandCount + crosswiseBandCount;
        if (bandCount > input.constraints.maxBands) continue;
        const occupiedCrossSpan =
          lengthwiseBandCount * lengthwiseCross +
          crosswiseBandCount * crosswiseCross +
          (bandCount - 1) * clearance;
        if (occupiedCrossSpan > crossAvailable + SOLVER_GEOMETRY_EPSILON_MM) {
          continue;
        }
        const sharedInline = minimumCompactMixedSharedInlineSpan(
          requestedCount,
          lengthwiseBandCount,
          crosswiseBandCount,
          lengthwiseInline,
          crosswiseInline,
          clearance,
          inlineAvailable,
        );
        if (!sharedInline) continue;

        for (const orderName of compactMixedOrderNames(
          lengthwiseBandCount,
          crosswiseBandCount,
        )) {
          const rotations = compactMixedOrderRotations(
            orderName,
            lengthwise,
            lengthwiseBandCount,
            crosswise,
            crosswiseBandCount,
          );
          const inlineCounts = compactMixedInlineCounts(
            rotations,
            lengthwise,
            sharedInline.lengthwiseRange,
            sharedInline.crosswiseRange,
            lengthwiseInline,
            crosswiseInline,
            sharedInline.sharedSpan,
            clearance,
            requestedCount,
          );
          if (!inlineCounts) continue;
          retainCompactMixedDescriptor(
            retainedDescriptors,
            {
              axis,
              lengthwiseBandCount,
              crosswiseBandCount,
              inlineCounts,
              orderName,
              orderRank: COMPACT_MIXED_ORDER_NAMES.indexOf(orderName),
              occupiedAreaMm2: normalizeGeneratedGeometryMetric(
                sharedInline.sharedSpan * occupiedCrossSpan,
                "compactMixed.occupiedAreaMm2",
              ),
              occupiedPerimeterMm: normalizeGeneratedGeometryMetric(
                2 * (sharedInline.sharedSpan + occupiedCrossSpan),
                "compactMixed.occupiedPerimeterMm",
              ),
            },
            descriptorCapacity,
          );
        }
      }
    }
  }

  if (!collector.checkCancellation()) return collector.output();
  retainedDescriptors.sort(compareCompactMixedDescriptors);
  for (const descriptor of retainedDescriptors) {
    if (!collector.checkCancellation()) return collector.output();
    const rotations = compactMixedOrderRotations(
      descriptor.orderName,
      lengthwise,
      descriptor.lengthwiseBandCount,
      crosswise,
      descriptor.crosswiseBandCount,
    );
    collector.add(
      rectangularMixedStripPlacements(
        input,
        descriptor.axis,
        rotations,
        descriptor.inlineCounts,
      ),
      {
        family: "mixed-orientation",
        variant: `${descriptor.axis}-${descriptor.orderName}-exact-rectangular-compact`,
        parameters: {
          axis: descriptor.axis,
          lengthwiseRotation: lengthwise,
          crosswiseRotation: crosswise,
          lengthwiseBandCount: descriptor.lengthwiseBandCount,
          crosswiseBandCount: descriptor.crosswiseBandCount,
          lengthwiseInlineCounts: rotations
            .flatMap((rotation, index) =>
              rotation === lengthwise ? [descriptor.inlineCounts[index]!] : [],
            )
            .join(","),
          crosswiseInlineCounts: rotations
            .flatMap((rotation, index) =>
              rotation === crosswise ? [descriptor.inlineCounts[index]!] : [],
            )
            .join(","),
          requestedCount,
          order: descriptor.orderName,
          spacingPolicy: "clearance-only-cross-bands",
        },
      },
    );
  }
  return collector.output();
}

function generateExactRectangularMixedOrientation(
  input: NormalizedLayerSolverInput,
  collector: DraftCollector,
  lengthwise: Rotation,
  crosswise: Rotation,
): GeneratorOutput {
  if (
    input.constraints.rectangularBlockFootprintPolicy === "compact-centered"
  ) {
    return generateCompactExactRectangularMixedOrientation(
      input,
      collector,
      lengthwise,
      crosswise,
    );
  }

  const requestedCount = exactRequestedPackageCount(input)!;
  const clearance = input.package.clearanceMm;
  const lengthwiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    lengthwise,
  );
  const crosswiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    crosswise,
  );

  for (const axis of ["horizontal", "vertical"] as const) {
    const horizontal = axis === "horizontal";
    const inlineAvailable = horizontal
      ? rectangleBoundsLength(input.generationBoundsMm)
      : rectangleBoundsWidth(input.generationBoundsMm);
    const crossAvailable = horizontal
      ? rectangleBoundsWidth(input.generationBoundsMm)
      : rectangleBoundsLength(input.generationBoundsMm);
    const lengthwiseInline = horizontal
      ? lengthwiseSize.length
      : lengthwiseSize.width;
    const crosswiseInline = horizontal
      ? crosswiseSize.length
      : crosswiseSize.width;
    const lengthwiseCross = horizontal
      ? lengthwiseSize.width
      : lengthwiseSize.length;
    const crosswiseCross = horizontal
      ? crosswiseSize.width
      : crosswiseSize.length;
    const lengthwiseInlineCounts = feasibleDistributedCounts(
      inlineAvailable,
      lengthwiseInline,
      clearance,
      requestedCount,
    );
    const crosswiseInlineCounts = feasibleDistributedCounts(
      inlineAvailable,
      crosswiseInline,
      clearance,
      requestedCount,
    );
    const maxLengthwiseBands = Math.min(
      maxCountAlong(crossAvailable, lengthwiseCross, clearance),
      input.constraints.maxBands - 1,
    );
    const maxCrosswiseBands = Math.min(
      maxCountAlong(crossAvailable, crosswiseCross, clearance),
      input.constraints.maxBands - 1,
    );

    for (const lengthwiseInlineCount of lengthwiseInlineCounts) {
      for (const crosswiseInlineCount of crosswiseInlineCounts) {
        for (
          let lengthwiseBandCount = 1;
          lengthwiseBandCount <= maxLengthwiseBands;
          lengthwiseBandCount += 1
        ) {
          const remaining =
            requestedCount - lengthwiseBandCount * lengthwiseInlineCount;
          if (remaining <= 0 || remaining % crosswiseInlineCount !== 0) {
            continue;
          }
          const crosswiseBandCount = remaining / crosswiseInlineCount;
          if (
            crosswiseBandCount < 1 ||
            crosswiseBandCount > maxCrosswiseBands ||
            lengthwiseBandCount + crosswiseBandCount >
              input.constraints.maxBands
          ) {
            continue;
          }
          for (const order of mixedOrderVariants(
            lengthwise,
            lengthwiseBandCount,
            crosswise,
            crosswiseBandCount,
          )) {
            if (!collector.canContinue()) return collector.output();
            collector.add(
              rectangularMixedStripPlacements(
                input,
                axis,
                order.rotations,
                order.rotations.map((rotation) =>
                  rotation === lengthwise
                    ? lengthwiseInlineCount
                    : crosswiseInlineCount,
                ),
              ),
              {
                family: "mixed-orientation",
                variant: `${axis}-${order.name}-exact-rectangular-space-between`,
                parameters: {
                  axis,
                  lengthwiseRotation: lengthwise,
                  crosswiseRotation: crosswise,
                  lengthwiseBandCount,
                  crosswiseBandCount,
                  lengthwiseInlineCount,
                  crosswiseInlineCount,
                  requestedCount,
                  order: order.name,
                  spacingPolicy: "bounded-space-between",
                },
              },
            );
          }
        }
      }
    }
  }
  return collector.output();
}

function generateMixedOrientation(
  input: NormalizedLayerSolverInput,
  hooks: GeneratorHooks,
): GeneratorOutput {
  const collector = new DraftCollector("mixed-orientation", input, hooks);
  if (!input.constraints.allowMixedPackageOrientations) {
    collector.diagnostics.push({
      severity: "info",
      phase: "generation",
      code: "mixed-orientation-disabled",
      message: "Mixed-orientation generation is disabled for this run.",
      generator: "mixed-orientation",
    });
    return collector.output();
  }
  const representatives = footprintRepresentatives(
    input.constraints.allowedRotations,
  );
  if (!representatives) {
    collector.diagnostics.push({
      severity: "info",
      phase: "generation",
      code: "mixed-orientation-unavailable",
      message:
        "Mixed-orientation generation requires at least one allowed rotation from each footprint class.",
      generator: "mixed-orientation",
    });
    return collector.output();
  }
  const [lengthwise, crosswise] = representatives;
  if (
    exactRequestedPackageCount(input) !== null &&
    input.constraints.requiredShape === "rectangular-block"
  ) {
    return generateExactRectangularMixedOrientation(
      input,
      collector,
      lengthwise,
      crosswise,
    );
  }
  const lengthwiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    lengthwise,
  );
  const crosswiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    crosswise,
  );
  const clearance = input.package.clearanceMm;

  for (const axis of ["horizontal", "vertical"] as const) {
    const crossAvailable =
      axis === "horizontal"
        ? rectangleBoundsWidth(input.generationBoundsMm)
        : rectangleBoundsLength(input.generationBoundsMm);
    const lengthwiseBand =
      axis === "horizontal" ? lengthwiseSize.width : lengthwiseSize.length;
    const crosswiseBand =
      axis === "horizontal" ? crosswiseSize.width : crosswiseSize.length;
    const maxLengthwise = Math.min(
      maxCountAlong(crossAvailable, lengthwiseBand, clearance),
      input.constraints.maxBands - 1,
    );
    const maxCrosswise = Math.min(
      maxCountAlong(crossAvailable, crosswiseBand, clearance),
      input.constraints.maxBands - 1,
    );

    for (
      let lengthwiseCount = 1;
      lengthwiseCount <= maxLengthwise;
      lengthwiseCount += 1
    ) {
      for (
        let crosswiseCount = 1;
        crosswiseCount <= maxCrosswise;
        crosswiseCount += 1
      ) {
        if (!collector.canContinue()) return collector.output();
        const bandCount = lengthwiseCount + crosswiseCount;
        if (bandCount > input.constraints.maxBands) continue;
        const crossUsed =
          lengthwiseCount * lengthwiseBand +
          crosswiseCount * crosswiseBand +
          (bandCount - 1) * clearance;
        if (crossUsed > crossAvailable + 1e-9) continue;
        const canAppend =
          crossUsed + clearance + Math.min(lengthwiseBand, crosswiseBand) <=
          crossAvailable + 1e-9;
        if (canAppend) continue;

        for (const order of mixedOrderVariants(
          lengthwise,
          lengthwiseCount,
          crosswise,
          crosswiseCount,
        )) {
          for (const inlinePolicy of INLINE_POLICIES) {
            for (const crossAlignment of ALIGNMENTS) {
              if (!collector.canContinue()) return collector.output();
              collector.add(
                mixedStripPlacements(
                  input,
                  axis,
                  order.rotations,
                  inlinePolicy,
                  crossAlignment,
                ),
                {
                  family: "mixed-orientation",
                  variant: `${axis}-${order.name}-${inlinePolicy}-${crossAlignment}`,
                  parameters: {
                    axis,
                    lengthwiseRotation: lengthwise,
                    crosswiseRotation: crosswise,
                    lengthwiseCount,
                    crosswiseCount,
                    order: order.name,
                    inlinePolicy,
                    crossAlignment,
                  },
                },
              );
            }
          }
        }
      }
    }
  }
  return collector.output();
}

function gridPlacements(
  input: NormalizedLayerSolverInput,
  bounds: RectangleBoundsMm,
  rotation: Rotation,
  columnCount: number,
  rowCount: number,
  alignmentX: Alignment,
  alignmentY: Alignment,
): GeneratedPlacement[] {
  if (columnCount <= 0 || rowCount <= 0) return [];
  if (columnCount * rowCount > input.constraints.maxPlacements) return [];
  const footprint = rectangleSizeForRotation(
    input.package.dimensionsMm,
    rotation,
  );
  const clearance = input.package.clearanceMm;
  const availableLength = rectangleBoundsLength(bounds);
  const availableWidth = rectangleBoundsWidth(bounds);
  const usedLength = usedSpan(columnCount, footprint.length, clearance);
  const usedWidth = usedSpan(rowCount, footprint.width, clearance);
  if (
    usedLength > availableLength + 1e-9 ||
    usedWidth > availableWidth + 1e-9
  ) {
    return [];
  }
  const startX = alignedStart(
    bounds.minX,
    availableLength,
    usedLength,
    alignmentX,
  );
  const startY = alignedStart(
    bounds.minY,
    availableWidth,
    usedWidth,
    alignmentY,
  );
  const placements: GeneratedPlacement[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      placements.push({
        positionMm: {
          x:
            startX +
            footprint.length / 2 +
            column * (footprint.length + clearance),
          y: startY + footprint.width / 2 + row * (footprint.width + clearance),
        },
        rotation,
      });
    }
  }
  return placements;
}

function roundHalfTowardZero(value: number): number {
  const sign = Math.sign(value);
  const absolute = Math.abs(value);
  const whole = Math.floor(absolute);
  const fraction = absolute - whole;
  const roundedAbsolute = fraction > 0.5 + 1e-9 ? whole + 1 : whole;
  return sign * roundedAbsolute;
}

function justifiedLineCenters(
  minimum: number,
  maximum: number,
  item: number,
  clearance: number,
  count: number,
  policy: JustifiedSpacingPolicy,
): number[] {
  if (count <= 0 || maximum < minimum) return [];
  const available = maximum - minimum;
  if (usedSpan(count, item, clearance) > available + 1e-9) return [];
  if (count === 1) {
    const center = minimum + available / 2;
    return [
      policy === "integer-balanced-space-between"
        ? roundHalfTowardZero(center)
        : center,
    ];
  }

  let first = minimum + item / 2;
  let last = maximum - item / 2;
  if (policy === "integer-balanced-space-between") {
    // Legacy integer layouts repeatedly use truncated endpoints with residual
    // millimeters balanced across the interior gaps. This is a general spacing
    // policy; no source coordinates or layouts are fed into generation.
    first = Math.trunc(first);
    last = Math.trunc(last);
  }
  const step = (last - first) / (count - 1);
  if (step + 1e-9 < item + clearance) return [];
  return Array.from({ length: count }, (_, index) => {
    const center = first + index * step;
    return policy === "integer-balanced-space-between"
      ? roundHalfTowardZero(center)
      : center;
  });
}

function generateJustifiedGrids(
  input: NormalizedLayerSolverInput,
  hooks: GeneratorHooks,
): GeneratorOutput {
  const collector = new DraftCollector("justified-grid", input, hooks);
  const representatives = footprintRepresentatives(
    input.constraints.allowedRotations,
  );
  if (!representatives) {
    collector.diagnostics.push({
      severity: "info",
      phase: "generation",
      code: "justified-grid-orientation-unavailable",
      message:
        "Justified split-grid generation requires at least one allowed rotation from each footprint class.",
      generator: "justified-grid",
    });
    return collector.output();
  }

  const envelope = input.generationBoundsMm;
  const totalLength = rectangleBoundsLength(envelope);
  const totalWidth = rectangleBoundsWidth(envelope);
  const clearance = input.package.clearanceMm;
  const orientationOrders: Array<readonly [Rotation, Rotation]> = [
    representatives,
    [representatives[1], representatives[0]],
  ];

  for (const [denseRotation, sparseRotation] of orientationOrders) {
    const denseSize = rectangleSizeForRotation(
      input.package.dimensionsMm,
      denseRotation,
    );
    const sparseSize = rectangleSizeForRotation(
      input.package.dimensionsMm,
      sparseRotation,
    );

    const maxDenseColumns = Math.min(
      maxCountAlong(totalLength, denseSize.length, clearance),
      input.constraints.maxBands,
    );
    for (
      let denseColumns = 1;
      denseColumns <= maxDenseColumns;
      denseColumns += 1
    ) {
      const denseLength = usedSpan(denseColumns, denseSize.length, clearance);
      const compositeLength = denseLength + clearance + sparseSize.length;
      if (compositeLength > totalLength + 1e-9) continue;
      const compositeMinX = alignedStart(
        envelope.minX,
        totalLength,
        compositeLength,
        "center",
      );
      const denseRows = maxCountAlong(totalWidth, denseSize.width, clearance);
      const denseBounds = {
        minX: compositeMinX,
        minY: envelope.minY,
        maxX: compositeMinX + denseLength,
        maxY: envelope.maxY,
      };
      const densePlacements = gridPlacements(
        input,
        denseBounds,
        denseRotation,
        denseColumns,
        denseRows,
        "start",
        "center",
      );
      const denseOccupiedBounds = boundingRectangleForPlacements(
        densePlacements,
        input.package.dimensionsMm,
      );
      if (!denseOccupiedBounds) continue;
      const sparseX =
        compositeMinX + denseLength + clearance + sparseSize.length / 2;
      const maximumSparseCount = Math.min(
        maxCountAlong(
          rectangleBoundsWidth(denseOccupiedBounds),
          sparseSize.width,
          clearance,
        ),
        input.constraints.maxBands,
      );
      for (
        let sparseCount = 1;
        sparseCount <= maximumSparseCount;
        sparseCount += 1
      ) {
        for (const spacingPolicy of JUSTIFIED_SPACING_POLICIES) {
          if (!collector.canContinue()) return collector.output();
          const sparseCenters = justifiedLineCenters(
            denseOccupiedBounds.minY,
            denseOccupiedBounds.maxY,
            sparseSize.width,
            clearance,
            sparseCount,
            spacingPolicy,
          );
          collector.add(
            [
              ...densePlacements,
              ...sparseCenters.map((y) => ({
                positionMm: { x: sparseX, y },
                rotation: sparseRotation,
              })),
            ],
            {
              family: "justified-grid",
              variant: `vertical-side-strip-${spacingPolicy}`,
              parameters: {
                splitAxis: "x",
                denseRotation,
                sparseRotation,
                denseColumns,
                denseRows,
                sparseCount,
                spacingPolicy,
              },
            },
          );
        }
      }
    }

    const maxDenseRows = Math.min(
      maxCountAlong(totalWidth, denseSize.width, clearance),
      input.constraints.maxBands,
    );
    for (let denseRows = 1; denseRows <= maxDenseRows; denseRows += 1) {
      const denseWidth = usedSpan(denseRows, denseSize.width, clearance);
      const compositeWidth = denseWidth + clearance + sparseSize.width;
      if (compositeWidth > totalWidth + 1e-9) continue;
      const compositeMinY = alignedStart(
        envelope.minY,
        totalWidth,
        compositeWidth,
        "center",
      );
      const denseColumns = maxCountAlong(
        totalLength,
        denseSize.length,
        clearance,
      );
      const denseBounds = {
        minX: envelope.minX,
        minY: compositeMinY,
        maxX: envelope.maxX,
        maxY: compositeMinY + denseWidth,
      };
      const densePlacements = gridPlacements(
        input,
        denseBounds,
        denseRotation,
        denseColumns,
        denseRows,
        "center",
        "start",
      );
      const denseOccupiedBounds = boundingRectangleForPlacements(
        densePlacements,
        input.package.dimensionsMm,
      );
      if (!denseOccupiedBounds) continue;
      const sparseY =
        compositeMinY + denseWidth + clearance + sparseSize.width / 2;
      const maximumSparseCount = Math.min(
        maxCountAlong(
          rectangleBoundsLength(denseOccupiedBounds),
          sparseSize.length,
          clearance,
        ),
        input.constraints.maxBands,
      );
      for (
        let sparseCount = 1;
        sparseCount <= maximumSparseCount;
        sparseCount += 1
      ) {
        for (const spacingPolicy of JUSTIFIED_SPACING_POLICIES) {
          if (!collector.canContinue()) return collector.output();
          const sparseCenters = justifiedLineCenters(
            denseOccupiedBounds.minX,
            denseOccupiedBounds.maxX,
            sparseSize.length,
            clearance,
            sparseCount,
            spacingPolicy,
          );
          collector.add(
            [
              ...densePlacements,
              ...sparseCenters.map((x) => ({
                positionMm: { x, y: sparseY },
                rotation: sparseRotation,
              })),
            ],
            {
              family: "justified-grid",
              variant: `horizontal-end-cap-${spacingPolicy}`,
              parameters: {
                splitAxis: "y",
                denseRotation,
                sparseRotation,
                denseColumns,
                denseRows,
                sparseCount,
                spacingPolicy,
              },
            },
          );
        }
      }
    }
  }
  return collector.output();
}

type MixedCountPair = {
  firstCount: number;
  secondCount: number;
  firstSpan: number;
  secondSpan: number;
  totalSpan: number;
};

function maximalMixedCountPairs(
  available: number,
  firstItem: number,
  secondItem: number,
  clearance: number,
  maxBands: number,
): MixedCountPair[] {
  const pairs: MixedCountPair[] = [];
  const maxFirst = Math.min(
    maxCountAlong(available, firstItem, clearance),
    maxBands,
  );
  const maxSecond = Math.min(
    maxCountAlong(available, secondItem, clearance),
    maxBands,
  );
  for (let firstCount = 1; firstCount <= maxFirst; firstCount += 1) {
    const firstSpan = usedSpan(firstCount, firstItem, clearance);
    for (let secondCount = 1; secondCount <= maxSecond; secondCount += 1) {
      const secondSpan = usedSpan(secondCount, secondItem, clearance);
      const totalSpan = firstSpan + clearance + secondSpan;
      if (totalSpan > available + 1e-9) continue;
      if (
        totalSpan + clearance + Math.min(firstItem, secondItem) <=
        available + 1e-9
      ) {
        continue;
      }
      pairs.push({
        firstCount,
        secondCount,
        firstSpan,
        secondSpan,
        totalSpan,
      });
    }
  }
  return pairs.sort(
    (left, right) =>
      right.totalSpan - left.totalSpan ||
      right.firstCount +
        right.secondCount -
        (left.firstCount + left.secondCount) ||
      left.firstCount - right.firstCount ||
      left.secondCount - right.secondCount,
  );
}

function pinwheelPlacements(
  input: NormalizedLayerSolverInput,
  lengthwiseRotation: Rotation,
  crosswiseRotation: Rotation,
  widthPair: MixedCountPair,
  heightPair: MixedCountPair,
  chirality: "cross-bottom-left" | "lengthwise-bottom-left",
): GeneratedPlacement[] {
  const clearance = input.package.clearanceMm;
  const startX = alignedStart(
    input.generationBoundsMm.minX,
    rectangleBoundsLength(input.generationBoundsMm),
    widthPair.totalSpan,
    "center",
  );
  const startY = alignedStart(
    input.generationBoundsMm.minY,
    rectangleBoundsWidth(input.generationBoundsMm),
    heightPair.totalSpan,
    "center",
  );
  const endX = startX + widthPair.totalSpan;
  const endY = startY + heightPair.totalSpan;
  const lengthwiseWidth = widthPair.firstSpan;
  const crosswiseWidth = widthPair.secondSpan;
  const lengthwiseHeight = heightPair.firstSpan;
  const crosswiseHeight = heightPair.secondSpan;
  const lengthwiseColumns = widthPair.firstCount;
  const crosswiseColumns = widthPair.secondCount;
  const lengthwiseRows = heightPair.firstCount;
  const crosswiseRows = heightPair.secondCount;

  const grid = (
    bounds: RectangleBoundsMm,
    rotation: Rotation,
    columns: number,
    rows: number,
  ): GeneratedPlacement[] =>
    gridPlacements(input, bounds, rotation, columns, rows, "start", "start");

  if (chirality === "cross-bottom-left") {
    return [
      ...grid(
        {
          minX: startX,
          minY: startY,
          maxX: startX + crosswiseWidth,
          maxY: startY + crosswiseHeight,
        },
        crosswiseRotation,
        crosswiseColumns,
        crosswiseRows,
      ),
      ...grid(
        {
          minX: startX + crosswiseWidth + clearance,
          minY: startY,
          maxX: endX,
          maxY: startY + lengthwiseHeight,
        },
        lengthwiseRotation,
        lengthwiseColumns,
        lengthwiseRows,
      ),
      ...grid(
        {
          minX: startX,
          minY: startY + crosswiseHeight + clearance,
          maxX: startX + lengthwiseWidth,
          maxY: endY,
        },
        lengthwiseRotation,
        lengthwiseColumns,
        lengthwiseRows,
      ),
      ...grid(
        {
          minX: startX + lengthwiseWidth + clearance,
          minY: startY + lengthwiseHeight + clearance,
          maxX: endX,
          maxY: endY,
        },
        crosswiseRotation,
        crosswiseColumns,
        crosswiseRows,
      ),
    ];
  }

  return [
    ...grid(
      {
        minX: startX,
        minY: startY,
        maxX: startX + lengthwiseWidth,
        maxY: startY + lengthwiseHeight,
      },
      lengthwiseRotation,
      lengthwiseColumns,
      lengthwiseRows,
    ),
    ...grid(
      {
        minX: startX + lengthwiseWidth + clearance,
        minY: startY,
        maxX: endX,
        maxY: startY + crosswiseHeight,
      },
      crosswiseRotation,
      crosswiseColumns,
      crosswiseRows,
    ),
    ...grid(
      {
        minX: startX,
        minY: startY + lengthwiseHeight + clearance,
        maxX: startX + crosswiseWidth,
        maxY: endY,
      },
      crosswiseRotation,
      crosswiseColumns,
      crosswiseRows,
    ),
    ...grid(
      {
        minX: startX + crosswiseWidth + clearance,
        minY: startY + crosswiseHeight + clearance,
        maxX: endX,
        maxY: endY,
      },
      lengthwiseRotation,
      lengthwiseColumns,
      lengthwiseRows,
    ),
  ];
}

function generatePinwheels(
  input: NormalizedLayerSolverInput,
  hooks: GeneratorHooks,
): GeneratorOutput {
  const collector = new DraftCollector("pinwheel", input, hooks);
  const representatives = footprintRepresentatives(
    input.constraints.allowedRotations,
  );
  if (!representatives) {
    collector.diagnostics.push({
      severity: "info",
      phase: "generation",
      code: "pinwheel-orientation-unavailable",
      message:
        "Pinwheel generation requires at least one allowed rotation from each footprint class.",
      generator: "pinwheel",
    });
    return collector.output();
  }
  const [lengthwiseRotation, crosswiseRotation] = representatives;
  const lengthwiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    lengthwiseRotation,
  );
  const crosswiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    crosswiseRotation,
  );
  const widthPairs = maximalMixedCountPairs(
    rectangleBoundsLength(input.generationBoundsMm),
    lengthwiseSize.length,
    crosswiseSize.length,
    input.package.clearanceMm,
    input.constraints.maxBands,
  );
  const heightPairs = maximalMixedCountPairs(
    rectangleBoundsWidth(input.generationBoundsMm),
    lengthwiseSize.width,
    crosswiseSize.width,
    input.package.clearanceMm,
    input.constraints.maxBands,
  );

  for (const widthPair of widthPairs) {
    for (const heightPair of heightPairs) {
      for (const chirality of [
        "cross-bottom-left",
        "lengthwise-bottom-left",
      ] as const) {
        if (!collector.canContinue()) return collector.output();
        collector.add(
          pinwheelPlacements(
            input,
            lengthwiseRotation,
            crosswiseRotation,
            widthPair,
            heightPair,
            chirality,
          ),
          {
            family: "pinwheel",
            variant: chirality,
            parameters: {
              lengthwiseRotation,
              crosswiseRotation,
              lengthwiseColumns: widthPair.firstCount,
              crosswiseColumns: widthPair.secondCount,
              lengthwiseRows: heightPair.firstCount,
              crosswiseRows: heightPair.secondCount,
              chirality,
            },
          },
        );
      }
    }
  }
  return collector.output();
}

function generateNestedSides(
  input: NormalizedLayerSolverInput,
  hooks: GeneratorHooks,
): GeneratorOutput {
  const collector = new DraftCollector("nested-side", input, hooks);
  const representatives = footprintRepresentatives(
    input.constraints.allowedRotations,
  );
  if (!representatives) {
    collector.diagnostics.push({
      severity: "info",
      phase: "generation",
      code: "nested-side-orientation-unavailable",
      message:
        "Nested-side generation requires at least one allowed rotation from each footprint class.",
      generator: "nested-side",
    });
    return collector.output();
  }
  const [lengthwiseRotation, crosswiseRotation] = representatives;
  const lengthwiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    lengthwiseRotation,
  );
  const crosswiseSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    crosswiseRotation,
  );
  const envelope = input.generationBoundsMm;
  const totalLength = rectangleBoundsLength(envelope);
  const totalWidth = rectangleBoundsWidth(envelope);
  const clearance = input.package.clearanceMm;
  const mainRows = Math.min(
    maxCountAlong(totalWidth, lengthwiseSize.width, clearance),
    input.constraints.maxBands,
  );
  const mainHeight = usedSpan(mainRows, lengthwiseSize.width, clearance);
  const maximumMainColumns = Math.min(
    maxCountAlong(totalLength, lengthwiseSize.length, clearance),
    input.constraints.maxBands,
  );

  for (
    let mainColumns = 1;
    mainColumns < maximumMainColumns;
    mainColumns += 1
  ) {
    const mainWidth = usedSpan(mainColumns, lengthwiseSize.length, clearance);
    const sideAvailableWidth = totalLength - mainWidth - clearance;
    if (sideAvailableWidth <= 0) continue;
    const crosswiseColumns = Math.min(
      maxCountAlong(sideAvailableWidth, crosswiseSize.length, clearance),
      input.constraints.maxBands,
    );
    const coreColumns = Math.min(
      maxCountAlong(sideAvailableWidth, lengthwiseSize.length, clearance),
      input.constraints.maxBands,
    );
    const coreAvailableHeight =
      mainHeight - 2 * crosswiseSize.width - 2 * clearance;
    const coreRows = Math.min(
      maxCountAlong(coreAvailableHeight, lengthwiseSize.width, clearance),
      input.constraints.maxBands,
    );
    if (crosswiseColumns === 0 || coreColumns === 0 || coreRows === 0) {
      continue;
    }

    const crosswiseWidth = usedSpan(
      crosswiseColumns,
      crosswiseSize.length,
      clearance,
    );
    const coreWidth = usedSpan(coreColumns, lengthwiseSize.length, clearance);
    const sideWidth = Math.max(crosswiseWidth, coreWidth);
    const compositeWidth = mainWidth + clearance + sideWidth;
    if (compositeWidth > totalLength + 1e-9) continue;
    const compositeMinX = alignedStart(
      envelope.minX,
      totalLength,
      compositeWidth,
      "center",
    );
    const compositeMinY = alignedStart(
      envelope.minY,
      totalWidth,
      mainHeight,
      "center",
    );
    const sideMinX = compositeMinX + mainWidth + clearance;
    const sideMaxX = sideMinX + sideWidth;
    const bottomBandMaxY = compositeMinY + crosswiseSize.width;
    const topBandMinY = compositeMinY + mainHeight - crosswiseSize.width;
    const placements = [
      ...gridPlacements(
        input,
        {
          minX: compositeMinX,
          minY: compositeMinY,
          maxX: compositeMinX + mainWidth,
          maxY: compositeMinY + mainHeight,
        },
        lengthwiseRotation,
        mainColumns,
        mainRows,
        "start",
        "start",
      ),
      ...gridPlacements(
        input,
        {
          minX: sideMinX,
          minY: compositeMinY,
          maxX: sideMaxX,
          maxY: bottomBandMaxY,
        },
        crosswiseRotation,
        crosswiseColumns,
        1,
        "center",
        "start",
      ),
      ...gridPlacements(
        input,
        {
          minX: sideMinX,
          minY: bottomBandMaxY + clearance,
          maxX: sideMaxX,
          maxY: topBandMinY - clearance,
        },
        lengthwiseRotation,
        coreColumns,
        coreRows,
        "center",
        "center",
      ),
      ...gridPlacements(
        input,
        {
          minX: sideMinX,
          minY: topBandMinY,
          maxX: sideMaxX,
          maxY: compositeMinY + mainHeight,
        },
        crosswiseRotation,
        crosswiseColumns,
        1,
        "center",
        "start",
      ),
    ];
    if (!collector.canContinue()) return collector.output();
    collector.add(placements, {
      family: "nested-side",
      variant: "main-grid-with-banded-side-core",
      parameters: {
        lengthwiseRotation,
        crosswiseRotation,
        mainColumns,
        mainRows,
        crosswiseColumns,
        coreColumns,
        coreRows,
      },
    });
  }
  return collector.output();
}

function generateBlocks(
  input: NormalizedLayerSolverInput,
  hooks: GeneratorHooks,
): GeneratorOutput {
  const collector = new DraftCollector("block", input, hooks);
  const representatives = footprintRepresentatives(
    input.constraints.allowedRotations,
  );
  if (!representatives) {
    collector.diagnostics.push({
      severity: "info",
      phase: "generation",
      code: "block-orientation-unavailable",
      message:
        "Two-orientation block generation requires both footprint classes.",
      generator: "block",
    });
    return collector.output();
  }

  const envelope = input.generationBoundsMm;
  const totalLength = rectangleBoundsLength(envelope);
  const totalWidth = rectangleBoundsWidth(envelope);
  const clearance = input.package.clearanceMm;
  const orientationOrders: Array<readonly [Rotation, Rotation]> = [
    representatives,
    [representatives[1], representatives[0]],
  ];

  for (const [firstRotation, secondRotation] of orientationOrders) {
    const firstSize = rectangleSizeForRotation(
      input.package.dimensionsMm,
      firstRotation,
    );
    const secondSize = rectangleSizeForRotation(
      input.package.dimensionsMm,
      secondRotation,
    );

    const maxFirstColumns = Math.min(
      maxCountAlong(totalLength, firstSize.length, clearance),
      input.constraints.maxBands,
    );
    for (
      let firstColumns = 1;
      firstColumns < maxFirstColumns;
      firstColumns += 1
    ) {
      const firstLength = usedSpan(firstColumns, firstSize.length, clearance);
      const secondMinX = envelope.minX + firstLength + clearance;
      if (secondMinX + secondSize.length > envelope.maxX + 1e-9) continue;
      const firstBounds = {
        minX: envelope.minX,
        minY: envelope.minY,
        maxX: envelope.minX + firstLength,
        maxY: envelope.maxY,
      };
      const secondBounds = {
        minX: secondMinX,
        minY: envelope.minY,
        maxX: envelope.maxX,
        maxY: envelope.maxY,
      };
      const firstRows = maxCountAlong(totalWidth, firstSize.width, clearance);
      const secondColumns = maxCountAlong(
        rectangleBoundsLength(secondBounds),
        secondSize.length,
        clearance,
      );
      const secondRows = maxCountAlong(totalWidth, secondSize.width, clearance);
      for (const alignment of ALIGNMENTS) {
        if (!collector.canContinue()) return collector.output();
        collector.add(
          [
            ...gridPlacements(
              input,
              firstBounds,
              firstRotation,
              firstColumns,
              firstRows,
              "start",
              alignment,
            ),
            ...gridPlacements(
              input,
              secondBounds,
              secondRotation,
              secondColumns,
              secondRows,
              alignment,
              alignment,
            ),
          ],
          {
            family: "block",
            variant: `vertical-split-${alignment}`,
            parameters: {
              splitAxis: "x",
              firstRotation,
              secondRotation,
              firstColumns,
              alignment,
            },
          },
        );
      }
    }

    const maxFirstRows = Math.min(
      maxCountAlong(totalWidth, firstSize.width, clearance),
      input.constraints.maxBands,
    );
    for (let firstRows = 1; firstRows < maxFirstRows; firstRows += 1) {
      const firstWidth = usedSpan(firstRows, firstSize.width, clearance);
      const secondMinY = envelope.minY + firstWidth + clearance;
      if (secondMinY + secondSize.width > envelope.maxY + 1e-9) continue;
      const firstBounds = {
        minX: envelope.minX,
        minY: envelope.minY,
        maxX: envelope.maxX,
        maxY: envelope.minY + firstWidth,
      };
      const secondBounds = {
        minX: envelope.minX,
        minY: secondMinY,
        maxX: envelope.maxX,
        maxY: envelope.maxY,
      };
      const firstColumns = maxCountAlong(
        totalLength,
        firstSize.length,
        clearance,
      );
      const secondColumns = maxCountAlong(
        totalLength,
        secondSize.length,
        clearance,
      );
      const secondRows = maxCountAlong(
        rectangleBoundsWidth(secondBounds),
        secondSize.width,
        clearance,
      );
      for (const alignment of ALIGNMENTS) {
        if (!collector.canContinue()) return collector.output();
        collector.add(
          [
            ...gridPlacements(
              input,
              firstBounds,
              firstRotation,
              firstColumns,
              firstRows,
              alignment,
              "start",
            ),
            ...gridPlacements(
              input,
              secondBounds,
              secondRotation,
              secondColumns,
              secondRows,
              alignment,
              alignment,
            ),
          ],
          {
            family: "block",
            variant: `horizontal-split-${alignment}`,
            parameters: {
              splitAxis: "y",
              firstRotation,
              secondRotation,
              firstRows,
              alignment,
            },
          },
        );
      }
    }
  }
  return collector.output();
}

function lineCenters(
  minimum: number,
  available: number,
  item: number,
  clearance: number,
  alignment: Alignment,
): number[] {
  const count = maxCountAlong(available, item, clearance);
  if (count === 0) return [];
  const start = alignedStart(
    minimum,
    available,
    usedSpan(count, item, clearance),
    alignment,
  );
  return Array.from(
    { length: count },
    (_, index) => start + item / 2 + index * (item + clearance),
  );
}

function edgeRingPlacements(
  input: NormalizedLayerSolverInput,
  edgeRotation: Rotation,
  sideRotation: Rotation,
  centerRotation: Rotation | null,
  edgeAlignment: Alignment,
  sideAlignment: Alignment,
): GeneratedPlacement[] {
  const envelope = input.generationBoundsMm;
  const clearance = input.package.clearanceMm;
  const length = rectangleBoundsLength(envelope);
  const width = rectangleBoundsWidth(envelope);
  const edgeSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    edgeRotation,
  );
  const sideSize = rectangleSizeForRotation(
    input.package.dimensionsMm,
    sideRotation,
  );
  if (2 * edgeSize.width + clearance > width + 1e-9) return [];
  if (2 * sideSize.length + clearance > length + 1e-9) return [];

  const edgeXs = lineCenters(
    envelope.minX,
    length,
    edgeSize.length,
    clearance,
    edgeAlignment,
  );
  const interiorMinY = envelope.minY + edgeSize.width + clearance;
  const interiorMaxY = envelope.maxY - edgeSize.width - clearance;
  const interiorHeight = interiorMaxY - interiorMinY;
  if (edgeXs.length === 0 || interiorHeight < sideSize.width - 1e-9) {
    return [];
  }
  const sideYs = lineCenters(
    interiorMinY,
    interiorHeight,
    sideSize.width,
    clearance,
    sideAlignment,
  );
  if (sideYs.length === 0) return [];

  const placements: GeneratedPlacement[] = [];
  for (const x of edgeXs) {
    placements.push({
      positionMm: { x, y: envelope.minY + edgeSize.width / 2 },
      rotation: edgeRotation,
    });
    placements.push({
      positionMm: { x, y: envelope.maxY - edgeSize.width / 2 },
      rotation: edgeRotation,
    });
  }
  for (const y of sideYs) {
    placements.push({
      positionMm: { x: envelope.minX + sideSize.length / 2, y },
      rotation: sideRotation,
    });
    placements.push({
      positionMm: { x: envelope.maxX - sideSize.length / 2, y },
      rotation: sideRotation,
    });
  }

  if (centerRotation !== null) {
    const centerBounds = {
      minX: envelope.minX + sideSize.length + clearance,
      minY: interiorMinY,
      maxX: envelope.maxX - sideSize.length - clearance,
      maxY: interiorMaxY,
    };
    if (
      centerBounds.maxX > centerBounds.minX &&
      centerBounds.maxY > centerBounds.minY
    ) {
      const centerSize = rectangleSizeForRotation(
        input.package.dimensionsMm,
        centerRotation,
      );
      const columns = maxCountAlong(
        rectangleBoundsLength(centerBounds),
        centerSize.length,
        clearance,
      );
      const rows = maxCountAlong(
        rectangleBoundsWidth(centerBounds),
        centerSize.width,
        clearance,
      );
      placements.push(
        ...gridPlacements(
          input,
          centerBounds,
          centerRotation,
          columns,
          rows,
          "center",
          "center",
        ),
      );
    }
  }
  return placements.length <= input.constraints.maxPlacements ? placements : [];
}

function generateEdgeRings(
  input: NormalizedLayerSolverInput,
  hooks: GeneratorHooks,
): GeneratorOutput {
  const collector = new DraftCollector("edge-ring", input, hooks);
  const representatives = footprintRepresentatives(
    input.constraints.allowedRotations,
  );
  const rotations = representatives
    ? [...representatives]
    : [...input.constraints.allowedRotations];
  for (const edgeRotation of rotations) {
    for (const sideRotation of rotations) {
      for (const centerRotation of [null, ...rotations] as const) {
        for (const edgeAlignment of ALIGNMENTS) {
          for (const sideAlignment of ALIGNMENTS) {
            if (!collector.canContinue()) return collector.output();
            collector.add(
              edgeRingPlacements(
                input,
                edgeRotation,
                sideRotation,
                centerRotation,
                edgeAlignment,
                sideAlignment,
              ),
              {
                family: "edge-ring",
                variant: `${edgeAlignment}-${sideAlignment}-${centerRotation ?? "empty-center"}`,
                parameters: {
                  edgeRotation,
                  sideRotation,
                  centerRotation,
                  edgeAlignment,
                  sideAlignment,
                },
              },
            );
          }
        }
      }
    }
  }
  return collector.output();
}

export function generateCandidateFamily(
  input: NormalizedLayerSolverInput,
  family: BaseGeneratorFamily,
  hooks: GeneratorHooks = {},
): GeneratorOutput {
  if (
    input.constraints.rectangularBlockFootprintPolicy === "compact-centered" &&
    input.constraints.requiredShape === "rectangular-block" &&
    exactRequestedPackageCount(input) !== null &&
    family !== "row" &&
    family !== "mixed-orientation"
  ) {
    return { drafts: [], diagnostics: [], exclusions: [], cancelled: false };
  }
  if (family === "row") return generateRows(input, hooks);
  if (family === "block") return generateBlocks(input, hooks);
  if (family === "justified-grid") return generateJustifiedGrids(input, hooks);
  if (family === "pinwheel") return generatePinwheels(input, hooks);
  if (family === "nested-side") return generateNestedSides(input, hooks);
  if (family === "edge-ring") return generateEdgeRings(input, hooks);
  return generateMixedOrientation(input, hooks);
}

export function generateSymmetryCandidateDrafts(
  input: NormalizedLayerSolverInput,
  baseDrafts: readonly GeneratedCandidateDraft[],
  hooks: GeneratorHooks = {},
): GeneratorOutput {
  const collector = new DraftCollector("symmetry", input, hooks);
  const symmetries = envelopePreservingSymmetries(
    input.generationBoundsMm,
    false,
  );
  const orderedDrafts = [...baseDrafts].sort((left, right) => {
    const leftKey = `${canonicalPlacementGeometryKey(left.placements)}:${stableValue(left.provenance)}`;
    const rightKey = `${canonicalPlacementGeometryKey(right.placements)}:${stableValue(right.provenance)}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });

  for (const draft of orderedDrafts) {
    const sourceGeometryKey = canonicalPlacementGeometryKey(draft.placements);
    for (const symmetry of symmetries) {
      if (!collector.canContinue()) return collector.output();
      const transformed = transformPlacements(
        draft.placements,
        input.generationBoundsMm,
        symmetry,
      );
      collector.add(transformed, [
        ...draft.provenance,
        {
          family: "symmetry",
          variant: symmetry,
          symmetry,
          sourceGeometryKey,
          parameters: {
            sourceFamilies: draft.provenance
              .map(({ family }) => family)
              .sort()
              .join(","),
            frame: "generationBoundsMm",
          },
        },
      ]);
    }
  }
  return collector.output();
}
