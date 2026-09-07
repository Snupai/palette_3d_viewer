import {
  createRegionTopologyId,
  createRegionRealizationKey,
} from "~/domain/solver/region-topology/identity";
import type {
  RegionFramePolicy,
  RegionRealizationKey,
  RegionTopologyFamily,
  SpacedRegionGraph,
  StructuralRegionNode,
  TopologyFingerprint,
  TopologyId,
} from "~/domain/solver/region-topology/model";
import type {
  RegionSearchStopReason,
  RegionWorkLedger,
} from "~/domain/solver/region-topology/workBudget";
import type {
  BaseGeneratorFamily,
  CandidateValidation,
  GeneratedCandidateDraft,
  GeneratedPlacement,
  GeneratorProvenance,
  NormalizedLayerSolverInput,
} from "~/domain/solver/types";
import { validateCandidatePlacements } from "~/domain/solver/validation";
import type { Rotation } from "~/domain/palletTypes";

export type MaterializedRegionTopologyDraft = GeneratedCandidateDraft &
  Readonly<{
    topologyFingerprint: TopologyFingerprint;
    topologyId: TopologyId;
    realizationKey: RegionRealizationKey;
    regionFramePolicy: RegionFramePolicy;
  }>;

export type RegionMaterializationResult =
  | Readonly<{
      status: "completed";
      draft: MaterializedRegionTopologyDraft;
      validation: CandidateValidation;
    }>
  | Readonly<{
      status: "infeasible";
      reason: string;
      validation: CandidateValidation;
    }>
  | Readonly<{ status: "invalid"; reason: string }>
  | Readonly<{ status: "stopped"; reason: RegionSearchStopReason }>;

const generatorFamilyByTopologyOwner: Readonly<
  Record<RegionTopologyFamily, BaseGeneratorFamily>
> = Object.freeze({
  guillotine: "block",
  pinwheel: "pinwheel",
  "bridge-chain": "nested-side",
  "spine-corridor": "nested-side",
  "boundary-walk": "edge-ring",
});

function regionTopologyProvenance(
  ownerFamily: RegionTopologyFamily,
  framePolicy: RegionFramePolicy,
): GeneratorProvenance {
  return Object.freeze({
    family: generatorFamilyByTopologyOwner[ownerFamily],
    variant: `region-topology-${ownerFamily}-v1`,
    parameters: Object.freeze({
      source: "region-topology-v1",
      ownerFamily,
      framePolicy,
    }),
  });
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function representativeRotation(
  input: NormalizedLayerSolverInput,
  node: StructuralRegionNode,
): Rotation | null {
  if (node.footprintClass === "square") {
    return input.constraints.allowedRotations[0] ?? null;
  }
  return (
    input.constraints.allowedRotations.find((rotation) =>
      node.footprintClass === "lengthwise"
        ? rotation === 0 || rotation === 180
        : rotation === 90 || rotation === 270,
    ) ?? null
  );
}

export function materializeRegionTopologyDraft(
  input: NormalizedLayerSolverInput,
  graph: SpacedRegionGraph,
  ledger: RegionWorkLedger,
): RegionMaterializationResult {
  if (typeof graph !== "object" || graph === null) {
    return Object.freeze({
      status: "invalid",
      reason: "Spaced region graph must be an object.",
    });
  }
  const nodes = graph.topology.nodes;
  if (
    graph.regionBoundsMm.length !== nodes.length ||
    graph.spacingByRegion.length !== nodes.length
  ) {
    return Object.freeze({
      status: "invalid",
      reason: "Region bounds and spacing must match the structural node count.",
    });
  }

  let totalPlacementCount = 0;
  const rotations: Rotation[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    const spacing = graph.spacingByRegion[index]!;
    if (
      !isPositiveSafeInteger(node.columns) ||
      !isPositiveSafeInteger(node.rows) ||
      !isPositiveSafeInteger(node.packageCount) ||
      node.columns * node.rows !== node.packageCount
    ) {
      return Object.freeze({
        status: "invalid",
        reason: `Region ${node.canonicalIndex} has invalid package counts.`,
      });
    }
    if (
      spacing.xCentersMm.length !== node.columns ||
      spacing.yCentersMm.length !== node.rows
    ) {
      return Object.freeze({
        status: "invalid",
        reason: `Region ${node.canonicalIndex} center counts do not match its grid counts.`,
      });
    }
    const rotation = representativeRotation(input, node);
    if (rotation === null) {
      return Object.freeze({
        status: "invalid",
        reason: `Region ${node.canonicalIndex} has no allowed representative rotation.`,
      });
    }
    rotations.push(rotation);

    totalPlacementCount += node.packageCount;
    if (!Number.isSafeInteger(totalPlacementCount)) {
      return Object.freeze({
        status: "invalid",
        reason: "Materialized placement count exceeds safe integer range.",
      });
    }
  }
  if (
    totalPlacementCount <= 0 ||
    totalPlacementCount !== graph.topology.targetCount
  ) {
    return Object.freeze({
      status: "invalid",
      reason:
        "Structural region package counts must equal the positive topology target count.",
    });
  }

  const reservation = ledger.debit(
    "materialize-placement",
    totalPlacementCount,
  );
  if (reservation !== "continue") {
    return Object.freeze({ status: "stopped", reason: reservation });
  }

  const placements: GeneratedPlacement[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const spacing = graph.spacingByRegion[index]!;
    const rotation = rotations[index]!;

    for (const centerY of spacing.yCentersMm) {
      for (const centerX of spacing.xCentersMm) {
        const checkpoint = ledger.checkpoint();
        if (checkpoint !== "continue") {
          return Object.freeze({ status: "stopped", reason: checkpoint });
        }
        placements.push(
          Object.freeze({
            positionMm: Object.freeze({ x: centerX, y: centerY }),
            rotation,
          }),
        );
      }
    }
  }
  if (placements.length !== totalPlacementCount) {
    return Object.freeze({
      status: "invalid",
      reason: "Materialization did not produce the reserved placement count.",
    });
  }

  const beforeValidation = ledger.checkpoint();
  if (beforeValidation !== "continue") {
    return Object.freeze({ status: "stopped", reason: beforeValidation });
  }
  const validation = validateCandidatePlacements(input, placements);
  const afterValidation = ledger.checkpoint();
  if (afterValidation !== "continue") {
    return Object.freeze({ status: "stopped", reason: afterValidation });
  }
  if (!validation.valid) {
    return Object.freeze({
      status: "infeasible",
      reason: "Materialized region topology failed candidate validation.",
      validation,
    });
  }

  const realizationKey = createRegionRealizationKey(graph);
  const draft: MaterializedRegionTopologyDraft = Object.freeze({
    placements: Object.freeze(placements),
    provenance: Object.freeze([
      regionTopologyProvenance(graph.topology.ownerFamily, graph.framePolicy),
    ]),
    topologyFingerprint: graph.topology.topologyFingerprint,
    topologyId: createRegionTopologyId(graph.topology.topologyFingerprint),
    realizationKey,
    regionFramePolicy: graph.framePolicy,
  });
  return Object.freeze({ status: "completed", draft, validation });
}
