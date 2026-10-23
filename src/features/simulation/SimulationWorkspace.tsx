"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  RobViewer,
  type ViewerEquipmentConfig,
  type ViewerSceneCalibrationConfig,
  type ViewerTemporaryCalibrationConfig,
} from "~/components/RobViewer";
import {
  BUNDLED_ROBOT_CELL,
  BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION,
} from "~/components/rob-viewer/bundledRobotCell";
import type { PalletData } from "~/domain/palletTypes";
import type { Project } from "~/domain/project/projectSchema";
import {
  createRobotTimeline,
  seekRobotTimeline,
  stationPointToPallet,
  type RobotCycleMaterialization,
  type RobotTimelineConfig,
} from "~/domain/robotics";
import {
  advanceTimelineCursor,
  createSimulationFrame,
  stepTimelineCursor,
  timelinePhaseLabel,
  type PlaybackDirection,
} from "~/features/simulation/simulationPlayback";
import {
  createViewerSimulationCycles,
  timelinePoseToViewerPose,
} from "~/features/simulation/viewerSimulationPlan";
import { robotPoseToViewerPose } from "~/features/robotics/robotWorkspaceModel";
import { Panel } from "~/components/ui";

const buttonClass = "ui-btn ui-btn-sm";
const inputClass = "ui-input text-micro";

export type SimulationWorkspaceProps = {
  project: Project;
  materialization: RobotCycleMaterialization;
  previewData: PalletData | null;
};

const defaultConfig: RobotTimelineConfig = {
  linearSpeedMmPerSec: 1_000,
  angularSpeedDegPerSec: 180,
  pickDwellMs: 250,
  placeDwellMs: 250,
  betweenCycleDwellMs: 0,
};

function formatTime(timeMs: number): string {
  return `${(timeMs / 1_000).toFixed(3)} s`;
}

function numericInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function SimulationWorkspace({
  project,
  materialization,
  previewData,
}: SimulationWorkspaceProps) {
  const [config, setConfig] = useState<RobotTimelineConfig>(defaultConfig);
  const sceneCalibration = useMemo<ViewerSceneCalibrationConfig | null>(
    () =>
      project.source.kind === "new"
        ? BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION
        : null,
    [project.source.kind],
  );
  const viewerCycles = useMemo(
    () =>
      createViewerSimulationCycles(
        materialization.cycles,
        (pose) => robotPoseToViewerPose(pose, project, materialization),
        sceneCalibration,
      ),
    [materialization, project, sceneCalibration],
  );
  const timeline = useMemo(
    () => createRobotTimeline(viewerCycles, config),
    [config, viewerCycles],
  );
  const [cursorMs, setCursorMs] = useState(0);
  const [direction, setDirection] = useState<PlaybackDirection>("forward");
  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [liftCarriageMm, setLiftCarriageMm] = useState(0);
  const lastFrameRef = useRef<number | null>(null);
  const cursorRef = useRef(0);

  useEffect(() => {
    setPlaying(false);
    cursorRef.current = 0;
    setCursorMs(0);
  }, [timeline]);

  useEffect(() => {
    setLiftCarriageMm(0);
  }, [project.id]);

  useEffect(() => {
    if (!playing || !timeline.valid || timeline.durationMs <= 0) return;
    let frame = 0;
    const tick = (now: number) => {
      const previous = lastFrameRef.current ?? now;
      lastFrameRef.current = now;
      const elapsed = Math.max(0, now - previous);
      const advanced = advanceTimelineCursor(
        timeline,
        cursorRef.current,
        elapsed,
        speed,
        direction,
      );
      cursorRef.current = advanced.timeMs;
      setCursorMs(advanced.timeMs);
      if (advanced.reachedEnd) {
        setPlaying(false);
        lastFrameRef.current = null;
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    lastFrameRef.current = null;
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      lastFrameRef.current = null;
    };
  }, [direction, playing, speed, timeline]);

  const sample = seekRobotTimeline(timeline, cursorMs, direction);
  const cycle = sample
    ? (timeline.cycles[sample.segment.cycleIndex] ?? null)
    : null;
  const simulationFrame = createSimulationFrame(
    timeline,
    cursorMs,
    { cycles: viewerCycles, stack: materialization.stack },
    timelinePoseToViewerPose,
    sceneCalibration?.palletPose,
  );

  const equipment = useMemo<ViewerEquipmentConfig>(() => {
    const firstPick = viewerCycles[0]?.pickPose ?? null;
    const robotHomePose = firstPick
      ? timelinePoseToViewerPose(firstPick)
      : null;
    const conveyorPose = materialization.conveyor
      ? robotPoseToViewerPose(
          {
            frame: materialization.conveyor.frame,
            positionMm: materialization.conveyor.centerMm,
            yawDeg: 0,
          },
          project,
          materialization,
        )
      : null;
    let robotBase = { x: 0, y: 0, z: 0 };
    if (
      project.pallet &&
      materialization.station &&
      materialization.direction
    ) {
      robotBase = stationPointToPallet(
        {
          x: materialization.station.robotCenterMm.x,
          y: materialization.station.robotCenterMm.y,
          z: 0,
        },
        project.pallet,
        materialization.station,
        materialization.direction,
      );
    }
    const armReach = Math.max(
      600,
      (materialization.station?.robotRadiusMm.max ?? 1_400) / 2,
    );
    const envelope = materialization.gripper?.envelopeMm;
    const robotCell = project.source.kind === "new" ? BUNDLED_ROBOT_CELL : null;
    // The CAD cell has no driveable joint chain, so the procedural arm is what
    // moves. Mount it on the measured CAD base and follow the lift carriage so
    // the travel slider keeps its meaning.
    const robotMount = robotCell?.robotMount ?? null;
    return {
      conveyor:
        conveyorPose && materialization.conveyor
          ? {
              centerMm: conveyorPose.positionMm,
              dimensionsMm: materialization.conveyor.dimensionsMm,
              travelAxis: materialization.conveyor.travelAxis,
            }
          : null,
      selectedGripper: materialization.gripper
        ? {
            pose: null,
            envelopeMm: envelope
              ? {
                  ...envelope,
                  belowZ: Math.max(20, project.package.dimensionsMm.height / 2),
                  aboveZ: 100,
                }
              : null,
            showModel: true,
          }
        : null,
      robot: robotMount
        ? {
            baseMm: {
              x: robotMount.baseMm.x,
              y: robotMount.baseMm.y,
              z: robotMount.baseMm.z + liftCarriageMm,
            },
            baseHeightMm: robotMount.baseHeightMm,
            upperArmLengthMm: robotMount.upperArmLengthMm,
            forearmLengthMm: robotMount.forearmLengthMm,
            homePose: robotHomePose,
          }
        : materialization.station
          ? {
              baseMm: robotBase,
              baseHeightMm: 320,
              upperArmLengthMm: armReach,
              forearmLengthMm: armReach,
              homePose: robotHomePose,
            }
          : null,
      robotCell,
    };
  }, [liftCarriageMm, materialization, project, viewerCycles]);

  const temporaryCalibration = useMemo<ViewerTemporaryCalibrationConfig>(() => {
    const firstCycle = viewerCycles[0] ?? null;
    const pickupPose = sceneCalibration
      ? sceneCalibration.pickupPose
      : firstCycle
        ? timelinePoseToViewerPose(firstCycle.pickPose)
        : materialization.conveyor
          ? robotPoseToViewerPose(
              {
                frame: materialization.conveyor.frame,
                positionMm: materialization.conveyor.centerMm,
                yawDeg: 0,
              },
              project,
              materialization,
            )
          : {
              positionMm: {
                x: 0,
                y: 0,
                z: project.package.dimensionsMm.height,
              },
              yawDeg: 0,
            };
    return {
      resetKey: `${project.id}:${firstCycle?.id ?? "no-cycle"}:${sceneCalibration?.robotCellRevision ?? "uncalibrated"}`,
      palletPose: sceneCalibration?.palletPose ?? {
        positionMm: { x: 0, y: 0, z: 0 },
        yawDeg: 0,
      },
      pickupPose,
    };
  }, [materialization, project, sceneCalibration, viewerCycles]);

  const canNavigate = timeline.valid && timeline.segments.length > 0;
  const setBoundary = (next: number) => {
    setPlaying(false);
    cursorRef.current = next;
    setCursorMs(next);
  };

  return (
    <div className="grid gap-3" data-testid="simulation-workspace">
      <Panel
        title="Robot simulation timeline"
        description="Timeline interpolation is deterministic over the canonical RobotCycle array. Cell geometry and external-axis placement are visualization evidence, not verified robot kinematics."
        bodyClassName="grid gap-3 p-3"
      >
        <div
          className="flex flex-wrap items-center gap-2"
          role="toolbar"
          aria-label="Simulation playback controls"
        >
          <button
            type="button"
            disabled={!canNavigate}
            onClick={() => setPlaying((current) => !current)}
            className="ui-btn-primary ui-btn-sm"
          >
            {playing ? "Stop" : "Start"}
          </button>
          <button
            type="button"
            disabled={!canNavigate}
            onClick={() => setBoundary(0)}
            className={buttonClass}
          >
            Beginning
          </button>
          <button
            type="button"
            disabled={!canNavigate}
            onClick={() =>
              setBoundary(stepTimelineCursor(timeline, cursorMs, "reverse"))
            }
            className={buttonClass}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!canNavigate}
            onClick={() =>
              setBoundary(stepTimelineCursor(timeline, cursorMs, "forward"))
            }
            className={buttonClass}
          >
            Next
          </button>
          <button
            type="button"
            disabled={!canNavigate}
            onClick={() => setBoundary(timeline.durationMs)}
            className={buttonClass}
          >
            End
          </button>
          <span className="bg-line mx-1 h-5 w-px" aria-hidden="true" />
          <button
            type="button"
            aria-pressed={direction === "forward"}
            onClick={() => {
              setPlaying(false);
              setDirection("forward");
            }}
            className={
              direction === "forward"
                ? `${buttonClass} border-brand! bg-brand/10! text-brand!`
                : buttonClass
            }
          >
            Forward
          </button>
          <button
            type="button"
            aria-pressed={direction === "reverse"}
            onClick={() => {
              setPlaying(false);
              setDirection("reverse");
            }}
            className={
              direction === "reverse"
                ? `${buttonClass} border-brand! bg-brand/10! text-brand!`
                : buttonClass
            }
          >
            Reverse
          </button>
          <label className="text-muted text-micro ml-auto flex items-center gap-2">
            Speed
            <select
              aria-label="Playback speed"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className={inputClass}
            >
              {[0.25, 0.5, 1, 2, 4].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-1">
          <div className="text-micro text-muted flex justify-between gap-3">
            <span>{formatTime(cursorMs)}</span>
            <span>{formatTime(timeline.durationMs)}</span>
          </div>
          <input
            aria-label="Simulation seek"
            type="range"
            min={0}
            max={Math.max(1, timeline.durationMs)}
            step={1}
            value={Math.min(cursorMs, Math.max(1, timeline.durationMs))}
            disabled={!canNavigate}
            onChange={(event) => setBoundary(Number(event.target.value))}
            className="accent-brand w-full"
          />
          <div
            className="border-line bg-canvas flex h-2 overflow-hidden border"
            aria-label="Deterministic timeline cursor"
          >
            {timeline.segments.map((segment) => (
              <span
                key={segment.id}
                title={`${timelinePhaseLabel(segment.kind)}: ${formatTime(segment.durationMs)}`}
                className={
                  segment.cycleIndex % 2 === 0 ? "bg-muted/60" : "bg-muted/30"
                }
                style={{ flexGrow: Math.max(segment.durationMs, 1) }}
              />
            ))}
          </div>
        </div>

        <dl className="border-line text-micro grid auto-rows-[1.25rem] grid-cols-2 items-center gap-x-4 gap-y-1 border-t pt-3 md:grid-cols-5 xl:grid-cols-10">
          <dt className="text-muted">Cycle</dt>
          <dd className="text-ink font-mono">
            {cycle ? `${cycle.sequence + 1} / ${timeline.cycles.length}` : "—"}
          </dd>
          <dt className="text-muted">Group</dt>
          <dd className="text-ink truncate font-mono" title={cycle?.groupId}>
            {cycle?.groupId ?? "—"}
          </dd>
          <dt className="text-muted">Phase</dt>
          <dd
            className="text-ink min-w-0 truncate whitespace-nowrap"
            title={sample ? timelinePhaseLabel(sample.segment.kind) : undefined}
          >
            {sample ? timelinePhaseLabel(sample.segment.kind) : "—"}
          </dd>
          <dt className="text-muted">Direction</dt>
          <dd className="text-ink">{direction}</dd>
          <dt className="text-muted">Frame</dt>
          <dd className="text-ink font-mono">{sample ? "viewer" : "—"}</dd>
          <dt className="text-muted">X</dt>
          <dd className="text-ink font-mono">
            {sample?.pose.positionMm.x.toFixed(2) ?? "—"}
          </dd>
          <dt className="text-muted">Y</dt>
          <dd className="text-ink font-mono">
            {sample?.pose.positionMm.y.toFixed(2) ?? "—"}
          </dd>
          <dt className="text-muted">Z</dt>
          <dd className="text-ink font-mono">
            {sample?.pose.positionMm.z.toFixed(2) ?? "—"}
          </dd>
          <dt className="text-muted">Yaw</dt>
          <dd className="text-ink font-mono">
            {sample ? `${sample.pose.yawDeg.toFixed(2)}°` : "—"}
          </dd>
          <dt className="text-muted">Boundary</dt>
          <dd className="text-ink">
            {sample?.atBoundary ? "Exact" : "Interpolated"}
          </dd>
        </dl>
      </Panel>

      <section className="border-line bg-surface grid border xl:grid-cols-[280px_minmax(0,1fr)]">
        <div className="border-line border-b p-3 xl:border-r xl:border-b-0">
          <h2 className="text-body text-ink font-semibold">Motion timing</h2>
          <div className="mt-3 grid gap-2">
            {(
              [
                ["Linear speed (mm/s)", "linearSpeedMmPerSec"],
                ["Angular speed (deg/s)", "angularSpeedDegPerSec"],
                ["Pick dwell (ms)", "pickDwellMs"],
                ["Place dwell (ms)", "placeDwellMs"],
                ["Between cycles (ms)", "betweenCycleDwellMs"],
              ] as const
            ).map(([label, field]) => (
              <label key={field} className="text-micro text-muted grid gap-1">
                {label}
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={config[field]}
                  onChange={(event) =>
                    setConfig({
                      ...config,
                      [field]: numericInput(event.target.value, config[field]),
                    })
                  }
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          {project.source.kind === "new" ? (
            <div className="border-line mt-4 grid gap-2 border-t pt-3">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="lift-carriage-mm"
                  className="text-ink text-micro font-medium"
                >
                  Ewellix lift visualization
                </label>
                <output
                  htmlFor="lift-carriage-mm"
                  className="text-brand text-micro font-mono"
                >
                  {liftCarriageMm} mm
                </output>
              </div>
              <input
                id="lift-carriage-mm"
                aria-label="Ewellix lift position"
                type="range"
                min={BUNDLED_ROBOT_CELL.liftTravelMm.min}
                max={BUNDLED_ROBOT_CELL.liftTravelMm.max}
                step={10}
                value={liftCarriageMm}
                onChange={(event) =>
                  setLiftCarriageMm(Number(event.target.value))
                }
                className="accent-brand w-full"
              />
              <div className="text-micro text-muted flex justify-between font-mono">
                <span>0</span>
                <span>450</span>
                <span>900 mm</span>
              </div>
              <p className="text-micro text-muted leading-4">
                {BUNDLED_ROBOT_CELL.evidence.lift}
              </p>
            </div>
          ) : null}
          {timeline.diagnostics.length > 0 ? (
            <ul className="text-danger text-micro mt-3 grid gap-1">
              {timeline.diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${index}`}>
                  {diagnostic.message}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted text-micro mt-3 leading-5">
            {project.source.kind === "new"
              ? `The CAD cell falls back to procedural scene aids if it cannot load. ${BUNDLED_ROBOT_CELL.evidence.limitations}`
              : "Conveyor, gripper envelope, pallet, and articulated arm are scene aids. Reach and collision validity comes only from robotics diagnostics, not from the simplified arm drawing."}
          </p>
        </div>
        <div className="bg-viewport min-h-[560px] overflow-hidden">
          {previewData && previewData.layer_count > 0 ? (
            <RobViewer
              data={previewData}
              cameraResetKey={`simulation:${project.id}`}
              visibleUpToLayer={previewData.layer_count}
              showSceneControls
              equipment={equipment}
              liftCarriageMm={
                project.source.kind === "new" ? liftCarriageMm : null
              }
              simulationPose={simulationFrame.tcpPose}
              simulationState={simulationFrame}
              sceneCalibration={sceneCalibration ?? undefined}
              temporaryCalibration={temporaryCalibration}
            />
          ) : (
            <div className="text-viewport-ink text-body flex min-h-[560px] items-center justify-center px-4 text-center">
              Save a non-empty stack before running the simulation scene.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
