import {
  nextRobotTimelineBoundary,
  normalizeYawDeg,
  previousRobotTimelineBoundary,
  rotateVector2,
  seekRobotTimeline,
  type RobotCycleMaterialization,
  type RobotTimeline,
  type RobotTimelineSegmentKind,
} from "~/domain/robotics";
import type {
  ViewerScenePose,
  ViewerSimulationPackage,
  ViewerSimulationState,
} from "~/components/rob-viewer/viewerTypes";

export type PlaybackDirection = "forward" | "reverse";

export type TimelineCursorAdvance = {
  timeMs: number;
  reachedEnd: boolean;
};

export type SimulationFrame = ViewerSimulationState & {
  cycleId: string | null;
  phase: RobotTimelineSegmentKind | null;
  tcpPose: ViewerScenePose | null;
  completedPlacementIds: ReadonlySet<string>;
  feedPlacementIds: readonly string[];
  attachedPlacementIds: readonly string[];
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

function carriedPackagePose(
  finalPose: ViewerScenePose,
  finalTcpPose: ViewerScenePose,
  currentTcpPose: ViewerScenePose,
): ViewerScenePose {
  const localPosition = rotateVector2(
    {
      x: finalPose.positionMm.x - finalTcpPose.positionMm.x,
      y: finalPose.positionMm.y - finalTcpPose.positionMm.y,
    },
    -finalTcpPose.yawDeg,
  );
  const currentOffset = rotateVector2(localPosition, currentTcpPose.yawDeg);
  return {
    positionMm: {
      x: currentTcpPose.positionMm.x + currentOffset.x,
      y: currentTcpPose.positionMm.y + currentOffset.y,
      z:
        currentTcpPose.positionMm.z +
        (finalPose.positionMm.z - finalTcpPose.positionMm.z),
    },
    yawDeg: normalizeYawDeg(
      currentTcpPose.yawDeg +
        normalizeYawDeg(finalPose.yawDeg - finalTcpPose.yawDeg),
    ),
  };
}

/**
 * Derives package state only from the absolute cursor timestamp. Playback
 * direction never changes the physical state returned for the same time.
 */
export function createSimulationFrame(
  timeline: RobotTimeline,
  requestedTimeMs: number,
  materialization: Pick<RobotCycleMaterialization, "cycles" | "stack">,
  toViewerPose: (
    pose: RobotCycleMaterialization["cycles"][number]["pickPose"],
  ) => ViewerScenePose,
): SimulationFrame {
  const timeMs = clampTimelineCursor(timeline, requestedTimeMs);
  const sample = seekRobotTimeline(timeline, timeMs, "forward");
  const activeWindow = timeline.cycleWindows.find(
    ({ startMs, endMs }) => timeMs >= startMs && timeMs < endMs,
  );
  const activeCycle = activeWindow
    ? (materialization.cycles[activeWindow.cycleIndex] ?? null)
    : null;
  const completedPlacementIds = new Set<string>();
  for (const window of timeline.cycleWindows) {
    if (timeMs < window.placeMs) continue;
    const cycle = materialization.cycles[window.cycleIndex];
    cycle?.placementIds.forEach((placementId) =>
      completedPlacementIds.add(placementId),
    );
  }

  const completedPackageLayerIndexes = (
    materialization.stack?.packageLayers ?? []
  ).flatMap((layer) =>
    layer.placements.length > 0 &&
    layer.placements.every(({ id }) => completedPlacementIds.has(id))
      ? [layer.packageLayerIndex]
      : [],
  );
  const feedPlacementIds =
    activeCycle && activeWindow && timeMs < activeWindow.pickupMs
      ? [...activeCycle.placementIds]
      : [];
  const attachedPlacementIds =
    activeCycle &&
    activeWindow &&
    timeMs >= activeWindow.pickupMs &&
    timeMs < activeWindow.placeMs
      ? [...activeCycle.placementIds]
      : [];
  const feedSet = new Set(feedPlacementIds);
  const attachedSet = new Set(attachedPlacementIds);
  const currentTcpPose = sample ? toViewerPose(sample.pose) : null;
  const finalTcpPose = activeCycle ? toViewerPose(activeCycle.placePose) : null;
  const feedTcpPose = activeCycle ? toViewerPose(activeCycle.pickPose) : null;
  const packages: ViewerSimulationPackage[] = [];

  for (const layer of materialization.stack?.packageLayers ?? []) {
    for (const placement of layer.placements) {
      const finalPose: ViewerScenePose = {
        positionMm: {
          x: placement.positionMm.x,
          y: placement.positionMm.y,
          z: (layer.zBottomMm + layer.zTopMm) / 2,
        },
        yawDeg: placement.rotation,
      };
      if (completedPlacementIds.has(placement.id)) {
        packages.push({
          placementId: placement.id,
          phase: "placed",
          pose: finalPose,
        });
      } else if (feedSet.has(placement.id) && finalTcpPose && feedTcpPose) {
        packages.push({
          placementId: placement.id,
          phase: "feed",
          pose: carriedPackagePose(finalPose, finalTcpPose, feedTcpPose),
        });
      } else if (
        attachedSet.has(placement.id) &&
        finalTcpPose &&
        currentTcpPose
      ) {
        packages.push({
          placementId: placement.id,
          phase: "attached",
          pose: carriedPackagePose(finalPose, finalTcpPose, currentTcpPose),
        });
      }
    }
  }

  return {
    cycleId: activeCycle?.id ?? sample?.segment.cycleId ?? null,
    phase: sample?.segment.kind ?? null,
    tcpPose: currentTcpPose,
    completedPlacementIds,
    feedPlacementIds,
    attachedPlacementIds,
    packages,
    completedPackageLayerIndexes,
  };
}

export function timelinePhaseLabel(kind: RobotTimelineSegmentKind): string {
  switch (kind) {
    case "cycle-retract":
      return "Retract from pallet";
    case "cycle-traverse":
      return "Travel above feed";
    case "pick-approach":
      return "Approach pickup";
    case "pick-dwell":
      return "Pick dwell";
    case "pick-lift":
      return "Lift package";
    case "pick-traverse":
      return "Travel from pickup";
    case "transfer-traverse":
      return "Travel above pallet";
    case "place-approach":
      return "Place approach";
    case "place-dwell":
      return "Place dwell";
    case "between-cycle-dwell":
      return "Between-cycle dwell";
  }
}
