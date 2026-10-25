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
import { useLocale, type MessageKey } from "~/i18n";
import { robotPoseToViewerPose } from "~/features/robotics/robotWorkspaceModel";
import {
  advanceTimelineCursor,
  createSimulationFrame,
  playbackStartCursor,
  stepTimelineCursor,
  timelinePhaseLabel,
  type PlaybackDirection,
} from "~/features/simulation/simulationPlayback";
import {
  createViewerSimulationCycles,
  timelinePoseToViewerPose,
} from "~/features/simulation/viewerSimulationPlan";

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

const timingFields: ReadonlyArray<
  readonly [MessageKey, keyof RobotTimelineConfig]
> = [
  ["simulation.timing.linearSpeed", "linearSpeedMmPerSec"],
  ["simulation.timing.angularSpeed", "angularSpeedDegPerSec"],
  ["simulation.timing.pickDwell", "pickDwellMs"],
  ["simulation.timing.placeDwell", "placeDwellMs"],
  ["simulation.timing.betweenCycles", "betweenCycleDwellMs"],
];

function formatDecimal(value: number, tag: string): string {
  return new Intl.NumberFormat(tag, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    useGrouping: false,
  }).format(value);
}

function formatTime(timeMs: number, tag: string): string {
  return `${formatDecimal(timeMs / 1_000, tag)} s`;
}

function numericInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mm(value: number, tag: string): string {
  return formatDecimal(value, tag);
}

export function SimulationWorkspace({
  project,
  materialization,
  previewData,
}: SimulationWorkspaceProps) {
  const { t, tag } = useLocale();
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
  const phaseText = sample ? timelinePhaseLabel(sample.segment.kind, t) : "–";

  return (
    <div className="ed" data-testid="simulation-workspace">
      <div className="ed-bar">
        <div className="ed-bar-title">
          <h2>Simulation</h2>
          <p>
            {timeline.cycles.length > 0
              ? `${t("simulation.cycleCount", { count: timeline.cycles.length })} · ${t("simulation.duration", { time: formatTime(timeline.durationMs, tag) })}`
              : t("simulation.noCycles")}
          </p>
        </div>
        <div
          className="ed-bar-actions"
          role="toolbar"
          aria-label={t("simulation.playback")}
          style={{ marginLeft: 0 }}
        >
          <button
            type="button"
            className="ui-btn-primary"
            disabled={!canNavigate}
            onClick={() => {
              if (!playing) {
                const start = playbackStartCursor(
                  timeline,
                  cursorRef.current,
                  direction,
                );
                cursorRef.current = start;
                setCursorMs(start);
              }
              setPlaying(!playing);
            }}
          >
            {playing ? t("simulation.stop") : t("simulation.start")}
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={!canNavigate}
            onClick={() => setBoundary(0)}
          >
            {t("simulation.toStart")}
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={!canNavigate}
            onClick={() =>
              setBoundary(stepTimelineCursor(timeline, cursorMs, "reverse"))
            }
          >
            {t("simulation.back")}
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={!canNavigate}
            onClick={() =>
              setBoundary(stepTimelineCursor(timeline, cursorMs, "forward"))
            }
          >
            {t("simulation.next")}
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={!canNavigate}
            onClick={() => setBoundary(timeline.durationMs)}
          >
            {t("simulation.toEnd")}
          </button>
        </div>
        <div className="ed-bar-actions">
          <fieldset className="fw-seg-field">
            <legend className="sr-only">{t("simulation.direction")}</legend>
            <div className="fw-seg">
              {(
                [
                  ["forward", t("simulation.forward")],
                  ["reverse", t("simulation.reverse")],
                ] as const
              ).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="simulation-direction"
                    value={value}
                    checked={direction === value}
                    onChange={() => {
                      setPlaying(false);
                      setDirection(value);
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="ed-bar-select">
            {t("simulation.speed")}
            <select
              aria-label={t("simulation.speed")}
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="ui-input"
              style={{ minWidth: 100 }}
            >
              {[0.25, 0.5, 1, 2, 4].map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="ed-alerts">
        {timeline.diagnostics.map((diagnostic, index) => (
          <div
            key={`${diagnostic.code}-${index}`}
            role="alert"
            className="fw-alert"
          >
            {diagnostic.message}
          </div>
        ))}
      </div>

      <div className="ed-layout">
        <div className="ed-stage">
          <div className="ed-toolbar">
            <span className="ed-status">{formatTime(cursorMs, tag)}</span>
            <input
              aria-label={t("simulation.timePosition")}
              type="range"
              min={0}
              max={Math.max(1, timeline.durationMs)}
              step={1}
              value={Math.min(cursorMs, Math.max(1, timeline.durationMs))}
              disabled={!canNavigate}
              onChange={(event) => setBoundary(Number(event.target.value))}
              className="accent-brand"
              style={{ flex: "1 1 240px" }}
            />
            <span className="ed-status">
              {formatTime(timeline.durationMs, tag)}
            </span>
            <span className="ed-toolbar-count">
              {cycle
                ? `${t("simulation.cycle")} ${cycle.sequence + 1} / ${timeline.cycles.length} · ${phaseText}`
                : "–"}
            </span>
          </div>
          <div className="bg-viewport" style={{ minHeight: 560 }}>
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
              <div className="ed-empty" style={{ minHeight: 560 }}>
                {t("simulation.emptyPreview")}
              </div>
            )}
          </div>
        </div>

        <aside className="ed-side">
          {project.source.kind === "new" ? (
            <section className="ed-panel" aria-labelledby="sim-lift-title">
              <div className="ed-panel-head">
                <h3 id="sim-lift-title">{t("simulation.lift.title")}</h3>
                <output htmlFor="lift-carriage-mm" className="ed-status">
                  {liftCarriageMm} mm
                </output>
              </div>
              <input
                id="lift-carriage-mm"
                aria-label={t("simulation.lift.position")}
                type="range"
                min={BUNDLED_ROBOT_CELL.liftTravelMm.min}
                max={BUNDLED_ROBOT_CELL.liftTravelMm.max}
                step={10}
                value={liftCarriageMm}
                onChange={(event) =>
                  setLiftCarriageMm(Number(event.target.value))
                }
                className="accent-brand"
              />
            </section>
          ) : null}

          <details className="ed-panel-details">
            <summary>{t("simulation.timing.title")}</summary>
            <div>
              {timingFields.map(([label, field]) => (
                <label key={field} className="ed-field">
                  {t(label)}
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={config[field]}
                    onChange={(event) =>
                      setConfig({
                        ...config,
                        [field]: numericInput(
                          event.target.value,
                          config[field],
                        ),
                      })
                    }
                    className="ui-input"
                  />
                </label>
              ))}
            </div>
          </details>

          <details className="ed-panel-details">
            <summary>{t("simulation.tcp.title")}</summary>
            <div>
              <table className="ed-table">
                <tbody>
                  <tr>
                    <td>{t("simulation.cycle")}</td>
                    <td className="num">
                      {cycle
                        ? `${cycle.sequence + 1} / ${timeline.cycles.length}`
                        : "–"}
                    </td>
                  </tr>
                  <tr>
                    <td>{t("simulation.tcp.phase")}</td>
                    <td className="num">{phaseText}</td>
                  </tr>
                  <tr>
                    <td>X</td>
                    <td className="num">
                      {sample ? mm(sample.pose.positionMm.x, tag) : "–"}
                    </td>
                  </tr>
                  <tr>
                    <td>Y</td>
                    <td className="num">
                      {sample ? mm(sample.pose.positionMm.y, tag) : "–"}
                    </td>
                  </tr>
                  <tr>
                    <td>Z</td>
                    <td className="num">
                      {sample ? mm(sample.pose.positionMm.z, tag) : "–"}
                    </td>
                  </tr>
                  <tr>
                    <td>{t("simulation.tcp.rotation")}</td>
                    <td className="num">
                      {sample ? `${mm(sample.pose.yawDeg, tag)}°` : "–"}
                    </td>
                  </tr>
                  <tr>
                    <td>{t("simulation.tcp.keyPoint")}</td>
                    <td className="num">
                      {sample
                        ? sample.atBoundary
                          ? t("simulation.tcp.exact")
                          : t("simulation.tcp.interpolated")
                        : "–"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
