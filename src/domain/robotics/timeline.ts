import {
  interpolateRobotPose,
  shortestYawDeltaDeg,
} from "~/domain/robotics/frames";
import type {
  RobotCycle,
  RobotDiagnostic,
  RobotPose,
} from "~/domain/robotics/types";

export type RobotTimelineConfig = {
  linearSpeedMmPerSec: number;
  angularSpeedDegPerSec: number;
  pickDwellMs: number;
  placeDwellMs: number;
  betweenCycleDwellMs: number;
};

export const DEFAULT_ROBOT_TIMELINE_CONFIG: RobotTimelineConfig = {
  linearSpeedMmPerSec: 1_000,
  angularSpeedDegPerSec: 180,
  pickDwellMs: 250,
  placeDwellMs: 250,
  betweenCycleDwellMs: 0,
};

export type RobotTimelineSegmentKind =
  | "cycle-transition"
  | "pick-dwell"
  | "pick-transfer"
  | "transfer-place"
  | "place-dwell"
  | "between-cycle-dwell";

export type RobotTimelineSegment = {
  id: string;
  index: number;
  kind: RobotTimelineSegmentKind;
  cycleId: string;
  cycleIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  fromPose: RobotPose;
  toPose: RobotPose;
};

export type RobotTimeline = {
  kind: "robot-timeline";
  cycles: readonly RobotCycle[];
  config: RobotTimelineConfig;
  segments: readonly RobotTimelineSegment[];
  boundariesMs: readonly number[];
  durationMs: number;
  diagnostics: readonly RobotDiagnostic[];
  valid: boolean;
};

export type RobotTimelineSample = {
  requestedTimeMs: number;
  timeMs: number;
  direction: "forward" | "reverse";
  atBoundary: boolean;
  segment: RobotTimelineSegment;
  segmentProgress: number;
  pose: RobotPose;
};

function validatedConfig(input: Partial<RobotTimelineConfig>): {
  config: RobotTimelineConfig;
  diagnostics: RobotDiagnostic[];
} {
  const config = { ...DEFAULT_ROBOT_TIMELINE_CONFIG, ...input };
  const diagnostics: RobotDiagnostic[] = [];
  for (const field of [
    "linearSpeedMmPerSec",
    "angularSpeedDegPerSec",
  ] as const) {
    if (Number.isFinite(config[field]) && config[field] > 0) continue;
    diagnostics.push({
      severity: "error",
      phase: "timeline",
      code: "invalid-timeline-config",
      message: `${field} must be positive and finite.`,
      path: ["timeline", field],
    });
  }
  for (const field of [
    "pickDwellMs",
    "placeDwellMs",
    "betweenCycleDwellMs",
  ] as const) {
    if (Number.isFinite(config[field]) && config[field] >= 0) continue;
    diagnostics.push({
      severity: "error",
      phase: "timeline",
      code: "invalid-timeline-config",
      message: `${field} must be finite and non-negative.`,
      path: ["timeline", field],
    });
  }
  return { config, diagnostics };
}

function movementDurationMs(
  from: RobotPose,
  to: RobotPose,
  config: RobotTimelineConfig,
): number {
  if (from.frame !== to.frame) return 0;
  const distanceMm = Math.hypot(
    to.positionMm.x - from.positionMm.x,
    to.positionMm.y - from.positionMm.y,
    to.positionMm.z - from.positionMm.z,
  );
  const linearMs = (distanceMm / config.linearSpeedMmPerSec) * 1_000;
  const angularMs =
    (Math.abs(shortestYawDeltaDeg(from.yawDeg, to.yawDeg)) /
      config.angularSpeedDegPerSec) *
    1_000;
  return Math.max(linearMs, angularMs);
}

export function createRobotTimeline(
  cycles: readonly RobotCycle[],
  configInput: Partial<RobotTimelineConfig> = {},
): RobotTimeline {
  const { config, diagnostics } = validatedConfig(configInput);
  const segments: RobotTimelineSegment[] = [];
  let cursorMs = 0;

  const append = (
    kind: RobotTimelineSegmentKind,
    cycle: RobotCycle,
    cycleIndex: number,
    fromPose: RobotPose,
    toPose: RobotPose,
    durationMs: number,
  ): void => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return;
    const segment: RobotTimelineSegment = {
      id: `${cycle.id}:${kind}`,
      index: segments.length,
      kind,
      cycleId: cycle.id,
      cycleIndex,
      startMs: cursorMs,
      endMs: cursorMs + durationMs,
      durationMs,
      fromPose,
      toPose,
    };
    cursorMs = segment.endMs;
    segments.push(segment);
  };

  if (!diagnostics.some(({ severity }) => severity === "error")) {
    for (let cycleIndex = 0; cycleIndex < cycles.length; cycleIndex += 1) {
      const cycle = cycles[cycleIndex]!;
      const previous = cycles[cycleIndex - 1];
      if (previous) {
        if (previous.placePose.frame !== cycle.pickPose.frame) {
          diagnostics.push({
            severity: "error",
            phase: "timeline",
            code: "timeline-frame-mismatch",
            message: `Cannot connect cycle "${previous.id}" (${previous.placePose.frame}) to "${cycle.id}" (${cycle.pickPose.frame}).`,
            cycleId: cycle.id,
          });
          break;
        }
        append(
          "cycle-transition",
          cycle,
          cycleIndex,
          previous.placePose,
          cycle.pickPose,
          movementDurationMs(previous.placePose, cycle.pickPose, config),
        );
      }
      append(
        "pick-dwell",
        cycle,
        cycleIndex,
        cycle.pickPose,
        cycle.pickPose,
        config.pickDwellMs,
      );
      if (cycle.pickPose.frame !== cycle.transferPose.frame) {
        diagnostics.push({
          severity: "error",
          phase: "timeline",
          code: "timeline-frame-mismatch",
          message: `Cycle "${cycle.id}" pick and transfer poses use different frames.`,
          cycleId: cycle.id,
        });
        break;
      }
      append(
        "pick-transfer",
        cycle,
        cycleIndex,
        cycle.pickPose,
        cycle.transferPose,
        movementDurationMs(cycle.pickPose, cycle.transferPose, config),
      );
      if (cycle.transferPose.frame !== cycle.placePose.frame) {
        diagnostics.push({
          severity: "error",
          phase: "timeline",
          code: "timeline-frame-mismatch",
          message: `Cycle "${cycle.id}" transfer and place poses use different frames.`,
          cycleId: cycle.id,
        });
        break;
      }
      append(
        "transfer-place",
        cycle,
        cycleIndex,
        cycle.transferPose,
        cycle.placePose,
        movementDurationMs(cycle.transferPose, cycle.placePose, config),
      );
      append(
        "place-dwell",
        cycle,
        cycleIndex,
        cycle.placePose,
        cycle.placePose,
        config.placeDwellMs,
      );
      if (cycleIndex < cycles.length - 1) {
        append(
          "between-cycle-dwell",
          cycle,
          cycleIndex,
          cycle.placePose,
          cycle.placePose,
          config.betweenCycleDwellMs,
        );
      }
    }
  }

  const boundariesMs = [0, ...segments.map(({ endMs }) => endMs)].filter(
    (value, index, values) => index === 0 || value !== values[index - 1],
  );
  return {
    kind: "robot-timeline",
    cycles,
    config,
    segments,
    boundariesMs,
    durationMs: cursorMs,
    diagnostics,
    valid: !diagnostics.some(({ severity }) => severity === "error"),
  };
}

function forwardSegment(
  timeline: RobotTimeline,
  timeMs: number,
): RobotTimelineSegment | null {
  if (timeline.segments.length === 0) return null;
  if (timeMs >= timeline.durationMs) return timeline.segments.at(-1) ?? null;
  return (
    timeline.segments.find(
      ({ startMs, endMs }) => timeMs >= startMs && timeMs < endMs,
    ) ?? null
  );
}

function reverseSegment(
  timeline: RobotTimeline,
  timeMs: number,
): RobotTimelineSegment | null {
  if (timeline.segments.length === 0) return null;
  if (timeMs <= 0) return timeline.segments[0] ?? null;
  for (let index = timeline.segments.length - 1; index >= 0; index -= 1) {
    const segment = timeline.segments[index]!;
    if (timeMs > segment.startMs && timeMs <= segment.endMs) return segment;
  }
  return null;
}

/**
 * Exact boundary rule: forward seeks select the segment starting at a boundary;
 * reverse seeks select the segment ending there. Both return the same boundary pose.
 */
export function seekRobotTimeline(
  timeline: RobotTimeline,
  requestedTimeMs: number,
  direction: "forward" | "reverse" = "forward",
): RobotTimelineSample | null {
  if (!Number.isFinite(requestedTimeMs)) {
    throw new Error("requestedTimeMs must be finite.");
  }
  const timeMs = Math.max(0, Math.min(timeline.durationMs, requestedTimeMs));
  const segment =
    direction === "forward"
      ? forwardSegment(timeline, timeMs)
      : reverseSegment(timeline, timeMs);
  if (!segment) return null;
  const progress =
    segment.durationMs === 0
      ? direction === "forward"
        ? 0
        : 1
      : Math.max(
          0,
          Math.min(1, (timeMs - segment.startMs) / segment.durationMs),
        );
  return {
    requestedTimeMs,
    timeMs,
    direction,
    atBoundary: timeline.boundariesMs.includes(timeMs),
    segment,
    segmentProgress: progress,
    pose: interpolateRobotPose(segment.fromPose, segment.toPose, progress),
  };
}

export function nextRobotTimelineBoundary(
  timeline: RobotTimeline,
  timeMs: number,
): number {
  const clamped = Math.max(0, Math.min(timeline.durationMs, timeMs));
  return (
    timeline.boundariesMs.find((boundary) => boundary > clamped) ??
    timeline.durationMs
  );
}

export function previousRobotTimelineBoundary(
  timeline: RobotTimeline,
  timeMs: number,
): number {
  const clamped = Math.max(0, Math.min(timeline.durationMs, timeMs));
  for (let index = timeline.boundariesMs.length - 1; index >= 0; index -= 1) {
    const boundary = timeline.boundariesMs[index]!;
    if (boundary < clamped) return boundary;
  }
  return 0;
}
