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

const buttonClass =
  "rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400/35 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent";

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
      <section className="border border-zinc-800 bg-zinc-900">
        <div
          className="flex flex-wrap items-center gap-2 border-b border-zinc-800 p-2"
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
          <span className="ml-auto font-mono text-xs text-zinc-500">
            {phase ? `${phaseIndex + 1} / ${flow.phases.length}` : "0 / 0"}
          </span>
        </div>

        <div className="grid min-h-[420px] xl:grid-cols-[minmax(420px,1fr)_360px]">
          <div className="min-h-[420px] border-b border-zinc-800 bg-zinc-950 p-2 xl:border-r xl:border-b-0">
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
              <div className="flex min-h-[400px] items-center justify-center px-4 text-center text-sm text-zinc-600">
                No canonical robot cycle is available for this pattern.
              </div>
            )}
          </div>
          <div className="p-3">
            <h3 className="text-sm font-semibold text-zinc-100">
              Current canonical phase
            </h3>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              <dt className="text-zinc-500">Cycle</dt>
              <dd className="font-mono text-zinc-200">
                {cycle
                  ? `${cycle.sequence + 1} / ${materialization.cycles.length}`
                  : "—"}
              </dd>
              <dt className="text-zinc-500">Physical layer</dt>
              <dd className="font-mono text-zinc-200">
                {cycle ? cycle.physicalLayerIndex + 1 : "—"}
              </dd>
              <dt className="text-zinc-500">Group</dt>
              <dd className="font-mono text-zinc-200">
                {cycle ? `G${cycle.groupNumber}` : "—"}
              </dd>
              <dt className="text-zinc-500">Order in layer</dt>
              <dd className="font-mono text-zinc-200">
                {cycle ? cycle.sequenceInLayer + 1 : "—"}
              </dd>
              <dt className="text-zinc-500">Phase</dt>
              <dd className="text-zinc-200">{phase ? phase.phase : "—"}</dd>
              <dt className="text-zinc-500">Status</dt>
              <dd
                className={
                  phase?.status === "blocked"
                    ? "text-red-300"
                    : phase?.status === "warning"
                      ? "text-amber-300"
                      : "text-emerald-300"
                }
              >
                {phase?.status ?? "—"}
              </dd>
              <dt className="text-zinc-500">Frame</dt>
              <dd className="font-mono text-zinc-200">
                {phase?.pose.frame ?? "—"}
              </dd>
              <dt className="text-zinc-500">TCP X</dt>
              <dd className="font-mono text-zinc-200">
                {phase ? numeric(phase.pose.positionMm.x) : "—"}
              </dd>
              <dt className="text-zinc-500">TCP Y</dt>
              <dd className="font-mono text-zinc-200">
                {phase ? numeric(phase.pose.positionMm.y) : "—"}
              </dd>
              <dt className="text-zinc-500">TCP Z</dt>
              <dd className="font-mono text-zinc-200">
                {phase ? numeric(phase.pose.positionMm.z) : "—"}
              </dd>
              <dt className="text-zinc-500">Yaw</dt>
              <dd className="font-mono text-zinc-200">
                {phase ? `${numeric(phase.pose.yawDeg)}°` : "—"}
              </dd>
              <dt className="text-zinc-500">Packages</dt>
              <dd className="font-mono text-zinc-200">
                {cycle?.packageCount ?? "—"}
              </dd>
            </dl>
            {phase && phase.diagnostics.length > 0 ? (
              <ul className="mt-4 space-y-2 border-t border-zinc-800 pt-3">
                {phase.diagnostics.map((diagnostic, index) => (
                  <li
                    key={`${diagnostic.code}-${index}`}
                    className={
                      diagnostic.severity === "error"
                        ? "text-xs leading-5 text-red-200"
                        : "text-xs leading-5 text-amber-200"
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

      <section className="border border-zinc-800 bg-zinc-900">
        <header className="border-b border-zinc-800 px-3 py-2">
          <h3 className="text-sm font-semibold text-zinc-100">
            Shared RobotCycle sequence
          </h3>
          <p className="mt-0.5 text-xs text-zinc-500">
            These are references from the exact materialization array consumed
            by project export, simulation, and report generation.
          </p>
        </header>
        <div className="scrollbar-thin overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-500">
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
                    className="border-b border-zinc-800 px-2 py-2 font-medium"
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
                        ? "border-b border-amber-500/30 bg-amber-500/5 text-zinc-200"
                        : "border-b border-zinc-800 text-zinc-300"
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
                  <td
                    colSpan={8}
                    className="px-3 py-6 text-center text-zinc-600"
                  >
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
