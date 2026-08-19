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

const buttonClass = "ui-btn h-7 px-2.5 text-[12px]";

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
      <section className="border border-[var(--line)] bg-[var(--surface)]">
        <div
          className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] p-2"
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
          <span className="ml-auto font-mono text-xs text-[var(--muted)]">
            {phase ? `${phaseIndex + 1} / ${flow.phases.length}` : "0 / 0"}
          </span>
        </div>

        <div className="grid items-start xl:grid-cols-[minmax(0,1fr)_280px]">
          <div className="border-b border-[var(--line)] bg-[var(--canvas)] p-3 xl:border-r xl:border-b-0">
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
              <div className="flex min-h-24 items-center justify-center px-4 text-center text-[13px] text-[var(--muted)]">
                No canonical robot cycle is available for this pattern.
              </div>
            )}
          </div>
          <div className="p-3">
            <h3 className="text-sm font-semibold text-[var(--ink)]">
              Current canonical phase
            </h3>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              <dt className="text-[var(--muted)]">Cycle</dt>
              <dd className="font-mono text-[var(--ink)]">
                {cycle
                  ? `${cycle.sequence + 1} / ${materialization.cycles.length}`
                  : "—"}
              </dd>
              <dt className="text-[var(--muted)]">Physical layer</dt>
              <dd className="font-mono text-[var(--ink)]">
                {cycle ? cycle.physicalLayerIndex + 1 : "—"}
              </dd>
              <dt className="text-[var(--muted)]">Group</dt>
              <dd className="font-mono text-[var(--ink)]">
                {cycle ? `G${cycle.groupNumber}` : "—"}
              </dd>
              <dt className="text-[var(--muted)]">Order in layer</dt>
              <dd className="font-mono text-[var(--ink)]">
                {cycle ? cycle.sequenceInLayer + 1 : "—"}
              </dd>
              <dt className="text-[var(--muted)]">Phase</dt>
              <dd className="text-[var(--ink)]">{phase ? phase.phase : "—"}</dd>
              <dt className="text-[var(--muted)]">Status</dt>
              <dd
                className={
                  phase?.status === "blocked"
                    ? "text-[var(--danger)]"
                    : phase?.status === "warning"
                      ? "text-[var(--brand)]"
                      : "text-emerald-300"
                }
              >
                {phase?.status ?? "—"}
              </dd>
              <dt className="text-[var(--muted)]">Frame</dt>
              <dd className="font-mono text-[var(--ink)]">
                {phase?.pose.frame ?? "—"}
              </dd>
              <dt className="text-[var(--muted)]">TCP X</dt>
              <dd className="font-mono text-[var(--ink)]">
                {phase ? numeric(phase.pose.positionMm.x) : "—"}
              </dd>
              <dt className="text-[var(--muted)]">TCP Y</dt>
              <dd className="font-mono text-[var(--ink)]">
                {phase ? numeric(phase.pose.positionMm.y) : "—"}
              </dd>
              <dt className="text-[var(--muted)]">TCP Z</dt>
              <dd className="font-mono text-[var(--ink)]">
                {phase ? numeric(phase.pose.positionMm.z) : "—"}
              </dd>
              <dt className="text-[var(--muted)]">Yaw</dt>
              <dd className="font-mono text-[var(--ink)]">
                {phase ? `${numeric(phase.pose.yawDeg)}°` : "—"}
              </dd>
              <dt className="text-[var(--muted)]">Packages</dt>
              <dd className="font-mono text-[var(--ink)]">
                {cycle?.packageCount ?? "—"}
              </dd>
            </dl>
            {phase && phase.diagnostics.length > 0 ? (
              <ul className="mt-4 space-y-2 border-t border-[var(--line)] pt-3">
                {phase.diagnostics.map((diagnostic, index) => (
                  <li
                    key={`${diagnostic.code}-${index}`}
                    className={
                      diagnostic.severity === "error"
                        ? "text-xs leading-5 text-[var(--danger)]"
                        : "text-xs leading-5 text-[var(--brand)]"
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

      <section className="border border-[var(--line)] bg-[var(--surface)]">
        <header className="border-b border-[var(--line)] px-3 py-2">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            Shared RobotCycle sequence
          </h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            These are references from the exact materialization array consumed
            by project export, simulation, and report generation.
          </p>
        </header>
        <div className="scrollbar-thin overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-xs">
            <thead className="bg-[var(--canvas)] text-[var(--muted)]">
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
                    className="border-b border-[var(--line)] px-2 py-2 font-medium"
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
                        ? "border-b border-[var(--brand)] bg-[var(--plan-fill)] text-[var(--ink)]"
                        : "border-b border-[var(--line)] text-[var(--ink)]"
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
                    className="px-3 py-6 text-center text-[var(--muted)]"
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
