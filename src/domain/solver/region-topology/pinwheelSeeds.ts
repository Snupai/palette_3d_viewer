import { SOLVER_GEOMETRY_EPSILON_MM } from "~/domain/solver/geometryPolicy";
import type { RegionShapeAssignment } from "~/domain/solver/region-topology/identity";
import type {
  RegionGraphTemplate,
  RegionShape,
} from "~/domain/solver/region-topology/model";
import type {
  RegionSearchStopReason,
  RegionWorkLedger,
} from "~/domain/solver/region-topology/workBudget";
import type { NormalizedLayerSolverInput } from "~/domain/solver/types";

type SeedResult = Readonly<{
  assignments: readonly (readonly RegionShapeAssignment[])[];
  attempts: number;
  stopReason: RegionSearchStopReason | null;
}>;

function groupsByThickness(
  shapes: readonly RegionShape[],
  axis: "length" | "width",
): readonly (readonly RegionShape[])[] {
  const groups = new Map<number, RegionShape[]>();
  for (const shape of shapes) {
    const thickness = shape.naturalSizeMm[axis];
    const group = groups.get(thickness) ?? [];
    group.push(shape);
    groups.set(thickness, group);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, shapes]) =>
      shapes.sort(
        (left, right) =>
          right.packageCount - left.packageCount ||
          (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
      ),
    );
}

/**
 * Seed the ordinary search with maximal arms around a grid core. Enumerating
 * four arm thicknesses avoids independently guessing all eight grid counts.
 * The exhaustive frontier remains intact for non-maximal arm arrangements.
 */
export function seedGridCorePinwheels(
  input: NormalizedLayerSolverInput,
  template: RegionGraphTemplate,
  slotIds: readonly string[],
  domains: readonly (readonly RegionShape[])[],
  targetCount: number,
  ledger: RegionWorkLedger,
  maximumAttempts: number,
  maximumAssignments: number,
): SeedResult {
  const assignments: Array<readonly RegionShapeAssignment[]> = [];
  let attempts = 0;
  const result = (
    stopReason: RegionSearchStopReason | null = null,
  ): SeedResult => ({ assignments, attempts, stopReason });
  if (
    maximumAttempts <= 0 ||
    maximumAssignments <= 0 ||
    template.witness.kind !== "four-arm-cycle" ||
    template.witness.root.core.kind !== "grid" ||
    domains.some((domain) => domain.length === 0) ||
    domains.reduce((sum, domain) => sum + domain[0]!.packageCount, 0) >
      targetCount
  ) {
    return result();
  }

  const cycle = template.witness.root;
  const core = cycle.core;
  if (core.kind !== "grid") return result();
  const bySlotId = new Map(
    slotIds.map((slotId, index) => [slotId, domains[index]!]),
  );
  const [bottomId, rightId, topId, leftId] = cycle.armSlotIds;
  const bottomGroups = groupsByThickness(bySlotId.get(bottomId)!, "width");
  const topGroups = groupsByThickness(bySlotId.get(topId)!, "width");
  const leftGroups = groupsByThickness(bySlotId.get(leftId)!, "length");
  const rightGroups = groupsByThickness(bySlotId.get(rightId)!, "length");
  const coresByCount = new Map<number, RegionShape[]>();
  for (const shape of bySlotId.get(core.slotId)!) {
    const shapes = coresByCount.get(shape.packageCount) ?? [];
    shapes.push(shape);
    coresByCount.set(shape.packageCount, shapes);
  }
  const length = input.generationBoundsMm.maxX - input.generationBoundsMm.minX;
  const width = input.generationBoundsMm.maxY - input.generationBoundsMm.minY;
  const clearance = input.package.clearanceMm;
  const clockwise = cycle.chirality === "clockwise";
  const longestFitting = (
    shapes: readonly RegionShape[],
    axis: "length" | "width",
    span: number,
  ) =>
    shapes.find(
      (shape) => shape.naturalSizeMm[axis] <= span + SOLVER_GEOMETRY_EPSILON_MM,
    );

  for (const bottomGroup of bottomGroups) {
    const bottomHeight = bottomGroup[0]!.naturalSizeMm.width;
    for (const topGroup of topGroups) {
      const topHeight = topGroup[0]!.naturalSizeMm.width;
      const coreHeight = width - bottomHeight - topHeight - 2 * clearance;
      if (coreHeight <= 0) continue;
      for (const leftGroup of leftGroups) {
        const leftWidth = leftGroup[0]!.naturalSizeMm.length;
        for (const rightGroup of rightGroups) {
          if (attempts >= maximumAttempts) return result();
          const decision = ledger.debit("template-expansion");
          if (decision !== "continue") return result(decision);
          attempts += 1;
          const rightWidth = rightGroup[0]!.naturalSizeMm.length;
          const coreWidth = length - leftWidth - rightWidth - 2 * clearance;
          if (coreWidth <= 0) continue;

          const bottom = longestFitting(
            bottomGroup,
            "length",
            length - (clockwise ? leftWidth : rightWidth) - clearance,
          );
          const top = longestFitting(
            topGroup,
            "length",
            length - (clockwise ? rightWidth : leftWidth) - clearance,
          );
          const left = longestFitting(
            leftGroup,
            "width",
            width - (clockwise ? topHeight : bottomHeight) - clearance,
          );
          const right = longestFitting(
            rightGroup,
            "width",
            width - (clockwise ? bottomHeight : topHeight) - clearance,
          );
          if (!bottom || !top || !left || !right) continue;
          const remainingCount =
            targetCount -
            bottom.packageCount -
            top.packageCount -
            left.packageCount -
            right.packageCount;
          for (const center of coresByCount.get(remainingCount) ?? []) {
            if (
              center.naturalSizeMm.length >
                coreWidth + SOLVER_GEOMETRY_EPSILON_MM ||
              center.naturalSizeMm.width >
                coreHeight + SOLVER_GEOMETRY_EPSILON_MM
            )
              continue;
            const selected = new Map([
              [bottomId, bottom],
              [rightId, right],
              [topId, top],
              [leftId, left],
              [core.slotId, center],
            ]);
            assignments.push(
              slotIds.map((slotId) => ({
                slotId,
                shape: selected.get(slotId)!,
              })),
            );
            if (assignments.length >= maximumAssignments) return result();
          }
        }
      }
    }
  }
  return result();
}
