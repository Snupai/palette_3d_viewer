import {
  nextRobotTimelineBoundary,
  previousRobotTimelineBoundary,
  type RobotTimeline,
  type RobotTimelineSegmentKind,
} from "~/domain/robotics";

export type PlaybackDirection = "forward" | "reverse";

export type TimelineCursorAdvance = {
  timeMs: number;
  reachedEnd: boolean;
};

export function clampTimelineCursor(
  timeline: Pick<RobotTimeline, "durationMs">,
  timeMs: number,
): number {
  if (!Number.isFinite(timeMs)) throw new Error("timeMs must be finite.");
  return Math.max(0, Math.min(timeline.durationMs, timeMs));
}

export function advanceTimelineCursor(
  timeline: Pick<RobotTimeline, "durationMs">,
  timeMs: number,
  elapsedRealMs: number,
  speed: number,
  direction: PlaybackDirection,
): TimelineCursorAdvance {
  if (!Number.isFinite(elapsedRealMs) || elapsedRealMs < 0) {
    throw new Error("elapsedRealMs must be finite and non-negative.");
  }
  if (!Number.isFinite(speed) || speed <= 0) {
    throw new Error("speed must be positive and finite.");
  }
  const delta = elapsedRealMs * speed * (direction === "forward" ? 1 : -1);
  const time = clampTimelineCursor(timeline, timeMs + delta);
  return {
    timeMs: time,
    reachedEnd:
      direction === "forward" ? time >= timeline.durationMs : time <= 0,
  };
}

export function stepTimelineCursor(
  timeline: RobotTimeline,
  timeMs: number,
  direction: PlaybackDirection,
): number {
  return direction === "forward"
    ? nextRobotTimelineBoundary(timeline, timeMs)
    : previousRobotTimelineBoundary(timeline, timeMs);
}

export function timelinePhaseLabel(kind: RobotTimelineSegmentKind): string {
  switch (kind) {
    case "pick-dwell":
      return "Pick dwell";
    case "pick-transfer":
      return "Pick → transfer";
    case "transfer-place":
      return "Transfer → place";
    case "place-dwell":
      return "Place dwell";
    case "cycle-transition":
      return "Cycle transition";
    case "between-cycle-dwell":
      return "Between-cycle dwell";
  }
}
