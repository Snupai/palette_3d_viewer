import type { simulationDe } from "../de/simulation";

export const simulationEn = {
  "simulation.cycleCount_one": "{count} grip",
  "simulation.cycleCount_other": "{count} grips",
  "simulation.cycleCount": "{count} grips",
  "simulation.duration": "Duration {time}",
  "simulation.noCycles": "No calculated grips",
  "simulation.cycle": "Grip",
  // Playback controls
  "simulation.playback": "Playback",
  "simulation.stop": "Stop",
  "simulation.start": "Start",
  "simulation.toStart": "To start",
  "simulation.back": "Back",
  "simulation.next": "Next",
  "simulation.toEnd": "To end",
  "simulation.direction": "Direction",
  "simulation.forward": "Forward",
  "simulation.reverse": "Reverse",
  "simulation.speed": "Speed",
  "simulation.timePosition": "Time position",
  // Viewer
  "simulation.emptyPreview":
    "Save a stack with layers first, then you can view the motion.",
  // Lift
  "simulation.lift.title": "Lift (Ewellix)",
  "simulation.lift.position": "Ewellix lift position",
  // Timing
  "simulation.timing.title": "Motion timing",
  "simulation.timing.linearSpeed": "Path speed (mm/s)",
  "simulation.timing.angularSpeed": "Rotation speed (°/s)",
  "simulation.timing.pickDwell": "Pick dwell time (ms)",
  "simulation.timing.placeDwell": "Place dwell time (ms)",
  "simulation.timing.betweenCycles": "Pause between grips (ms)",
  // Tool position
  "simulation.tcp.title": "Current tool position",
  "simulation.tcp.phase": "Phase",
  "simulation.tcp.rotation": "Rotation",
  "simulation.tcp.keyPoint": "Key point",
  "simulation.tcp.exact": "exact",
  "simulation.tcp.interpolated": "interpolated",
  // Timeline phases
  "simulation.phase.cycleRetract": "Retract from pallet",
  "simulation.phase.cycleTraverse": "Travel above feed",
  "simulation.phase.pickApproach": "Approach pickup",
  "simulation.phase.pickDwell": "Pick dwell",
  "simulation.phase.pickLift": "Lift package",
  "simulation.phase.pickTraverse": "Travel from pickup",
  "simulation.phase.transferTraverse": "Travel above pallet",
  "simulation.phase.placeApproach": "Place approach",
  "simulation.phase.placeDwell": "Place dwell",
  "simulation.phase.betweenCycleDwell": "Between-cycle dwell",
} as const satisfies Record<keyof typeof simulationDe, string>;
