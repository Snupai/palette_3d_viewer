"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LayerPattern,
  PlanningSolution,
  Project,
} from "~/domain/project/projectSchema";
import type { RobotCycleMaterialization } from "~/domain/robotics";
import { SequenceCanvas } from "~/features/editor/SequenceCanvas";
import {
  activePatternReference,
  createProjectEditorFlow,
  projectEditorEnvelope,
  stepProjectEditorFlow,
} from "~/features/editor/editorModel";

const buttonClass = "ui-btn ui-btn-sm";

export type FlowModeProps = {
  project: Project;
  solution: PlanningSolution;
  pattern: LayerPattern;
  materialization: RobotCycleMaterialization;
};

function numeric(value: number): string {
  return Number(value.toFixed(2)).toString();
}

export function FlowMode({
  project,
  solution,
  pattern,
  materialization,
}: FlowModeProps) {
  const patternRef = activePatternReference(project, solution.id, pattern.id);
  const flow = useMemo(
    () => createProjectEditorFlow(materialization, patternRef),
    [materialization, patternRef],
  );
  const flowIdentity = `${solution.id}:${pattern.id}:${patternRef}`;
  const previousFlowIdentity = useRef(flowIdentity);
  const [phaseIndex, setPhaseIndex] = useState(0);
  useEffect(() => {
    const identityChanged = previousFlowIdentity.current !== flowIdentity;
    previousFlowIdentity.current = flowIdentity;
    setPhaseIndex((current) =>
      identityChanged
        ? 0
        : flow.phases.length === 0
          ? 0
          : Math.min(current, flow.phases.length - 1),
    );
  }, [flow.phases.length, flowIdentity]);
  const phase = flow.phases[phaseIndex] ?? null;
  const cycle = phase?.cycle ?? null;
  const layer = cycle
    ? (materialization.stack?.packageLayers.find(
        ({ id }) => id === cycle.physicalLayerId,
      ) ?? null)
    : null;
  const layerCycles = cycle
    ? flow.cycles
        .filter(
          ({ physicalLayerId }) => physicalLayerId === cycle.physicalLayerId,
        )
        .sort((left, right) => left.sequenceInLayer - right.sequenceInLayer)
    : [];
  const groupByPlacement = new Map(
    layerCycles.flatMap((item) =>
      item.placementIds.map(
        (placementId) =>
          [
            placementId,
            {
              groupNumber: item.groupNumber,
              order: item.sequenceInLayer + 1,
            },
          ] as const,
      ),
    ),
  );
  const envelope = projectEditorEnvelope(project) ?? {
    minX: 0,
    minY: 0,
    maxX: project.pallet?.dimensionsMm.length ?? 1_200,
    maxY: project.pallet?.dimensionsMm.width ?? 800,
  };
  const currentPlacementIds = new Set(cycle?.placementIds ?? []);
  const completedPlacementIds = new Set(
    layerCycles
      .filter((item) => cycle && item.sequenceInLayer < cycle.sequenceInLayer)
      .flatMap(({ placementIds }) => placementIds),
  );
  const sequencePlacements =
    layer?.placements.map((placement) => {
      const group = groupByPlacement.get(placement.id);
      return {
        id: placement.id,
        positionMm: placement.positionMm,
        rotation: placement.rotation,
        label: group ? String(group.order) : "—",
        detail: group
          ? `Layer ${layer.packageLayerIndex + 1}; group ${group.groupNumber}; order ${group.order}`
          : `Layer ${layer.packageLayerIndex + 1}; unassigned package`,
      };
    }) ?? [];
  const canStep = flow.phases.length > 0;
  const step = (direction: "begin" | "previous" | "next" | "end") =>
    setPhaseIndex((current) =>
      stepProjectEditorFlow(current, flow.phases.length, direction),
    );

  return (
    <div className="grid gap-3">
      <section className="border-line bg-surface border">
        <div
          className="border-line flex flex-wrap items-center gap-2 border-b p-2"
          role="toolbar"
          aria-label="Flow stepping controls"
        >
          <button
            type="button"
            disabled={!canStep || phaseIndex === 0}
            onClick={() => step("begin")}
            className={buttonClass}
          >
            Beginning
          </button>
          <button
            type="button"
            disabled={!canStep || phaseIndex === 0}
            onClick={() => step("previous")}
            className={buttonClass}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!canStep || phaseIndex >= flow.phases.length - 1}
            onClick={() => step("next")}
            className={buttonClass}
          >
            Next
          </button>
          <button
            type="button"
            disabled={!canStep || phaseIndex >= flow.phases.length - 1}
            onClick={() => step("end")}
            className={buttonClass}
          >
            End
          </button>
          <span className="text-micro text-muted ml-auto font-mono">
            {phase ? `${phaseIndex + 1} / ${flow.phases.length}` : "0 / 0"}
          </span>
        </div>

        <div className="grid items-start xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="border-line bg-canvas border-b p-3 xl:border-r xl:border-b-0">
            {layer ? (
              <SequenceCanvas
                ariaLabel={`Robot sequence for physical layer ${layer.packageLayerIndex + 1}`}
                envelope={envelope}
                pallet={
                  project.pallet
                    ? {
                        length: project.pallet.dimensionsMm.length,
                        width: project.pallet.dimensionsMm.width,
                      }
                    : null
                }
                packageDimensions={project.package.dimensionsMm}
                placements={sequencePlacements}
                currentPlacementIds={currentPlacementIds}
                completedPlacementIds={completedPlacementIds}
              />
            ) : (
              <div className="text-body text-muted flex min-h-24 items-center justify-center px-4 text-center">
                No canonical robot cycle is available for this pattern.
              </div>
            )}
          </div>
          <div className="p-3">
            <h3 className="text-body text-ink font-semibold">
              Current canonical phase
            </h3>
            <dl className="text-micro mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="text-muted">Cycle</dt>
              <dd className="text-ink font-mono">
                {cycle
                  ? `${cycle.sequence + 1} / ${materialization.cycles.length}`
                  : "—"}
              </dd>
              <dt className="text-muted">Physical layer</dt>
              <dd className="text-ink font-mono">
                {cycle ? cycle.physicalLayerIndex + 1 : "—"}
              </dd>
              <dt className="text-muted">Group</dt>
              <dd className="text-ink font-mono">
                {cycle ? `G${cycle.groupNumber}` : "—"}
              </dd>
              <dt className="text-muted">Order in layer</dt>
              <dd className="text-ink font-mono">
                {cycle ? cycle.sequenceInLayer + 1 : "—"}
              </dd>
              <dt className="text-muted">Phase</dt>
              <dd className="text-ink">{phase ? phase.phase : "—"}</dd>
              <dt className="text-muted">Status</dt>
              <dd
                className={
                  phase?.status === "blocked"
                    ? "text-danger"
                    : phase?.status === "warning"
                      ? "text-brand"
                      : "text-ok"
                }
              >
                {phase?.status ?? "—"}
              </dd>
              <dt className="text-muted">Frame</dt>
              <dd className="text-ink font-mono">{phase?.pose.frame ?? "—"}</dd>
              <dt className="text-muted">TCP X</dt>
              <dd className="text-ink font-mono">
                {phase ? numeric(phase.pose.positionMm.x) : "—"}
              </dd>
              <dt className="text-muted">TCP Y</dt>
              <dd className="text-ink font-mono">
                {phase ? numeric(phase.pose.positionMm.y) : "—"}
              </dd>
              <dt className="text-muted">TCP Z</dt>
              <dd className="text-ink font-mono">
                {phase ? numeric(phase.pose.positionMm.z) : "—"}
              </dd>
              <dt className="text-muted">Yaw</dt>
              <dd className="text-ink font-mono">
                {phase ? `${numeric(phase.pose.yawDeg)}°` : "—"}
              </dd>
              <dt className="text-muted">Packages</dt>
              <dd className="text-ink font-mono">
                {cycle?.packageCount ?? "—"}
              </dd>
            </dl>
            {phase && phase.diagnostics.length > 0 ? (
              <ul className="border-line mt-4 space-y-2 border-t pt-3">
                {phase.diagnostics.map((diagnostic, index) => (
                  <li
                    key={`${diagnostic.code}-${index}`}
                    className={
                      diagnostic.severity === "error"
                        ? "text-micro text-danger leading-5"
                        : "text-micro text-brand leading-5"
                    }
                  >
                    {diagnostic.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </section>

      <section className="border-line bg-surface border">
        <header className="border-line border-b px-3 py-2">
          <h3 className="text-body text-ink font-semibold">
            Shared RobotCycle sequence
          </h3>
          <p className="text-micro text-muted mt-0.5">
            These are references from the exact materialization array consumed
            by project export, simulation, and report generation.
          </p>
        </header>
        <div className="scrollbar-thin overflow-auto">
          <table className="text-micro w-full min-w-[980px] border-collapse text-left">
            <thead className="bg-canvas text-muted">
              <tr>
                {[
                  "Cycle",
                  "Layer",
                  "Group",
                  "Order",
                  "Status",
                  "Pick X/Y/Z/Yaw",
                  "Transfer X/Y/Z/Yaw",
                  "Place X/Y/Z/Yaw",
                ].map((label) => (
                  <th
                    key={label}
                    className="border-line border-b px-2 py-2 font-medium"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {flow.cycles.map((item) => {
                const cyclePhases = flow.phases.filter(
                  ({ cycle: phaseCycle }) => phaseCycle === item,
                );
                const status = cyclePhases[0]?.status ?? "ready";
                const tuple = (pose: typeof item.pickPose) =>
                  `${numeric(pose.positionMm.x)} / ${numeric(pose.positionMm.y)} / ${numeric(pose.positionMm.z)} / ${numeric(pose.yawDeg)}°`;
                return (
                  <tr
                    key={item.id}
                    className={
                      cycle?.id === item.id
                        ? "border-brand bg-plan-fill text-ink border-b"
                        : "border-line text-ink border-b"
                    }
                  >
                    <td className="px-2 py-2 font-mono">{item.sequence + 1}</td>
                    <td className="px-2 py-2 font-mono">
                      {item.physicalLayerIndex + 1}
                    </td>
                    <td className="px-2 py-2 font-mono">G{item.groupNumber}</td>
                    <td className="px-2 py-2 font-mono">
                      {item.sequenceInLayer + 1}
                    </td>
                    <td className="px-2 py-2">{status}</td>
                    <td className="px-2 py-2 font-mono">
                      {tuple(item.pickPose)}
                    </td>
                    <td className="px-2 py-2 font-mono">
                      {tuple(item.transferPose)}
                    </td>
                    <td className="px-2 py-2 font-mono">
                      {tuple(item.placePose)}
                    </td>
                  </tr>
                );
              })}
              {flow.cycles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-muted px-3 py-6 text-center">
                    No RobotCycle rows are available for this pattern.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
