/** Namespace `simulation` — German source strings. */
export const simulationDe = {
  "simulation.cycleCount_one": "{count} Griff",
  "simulation.cycleCount_other": "{count} Griffe",
  "simulation.cycleCount": "{count} Griffe",
  "simulation.duration": "Dauer {time}",
  "simulation.noCycles": "Keine berechneten Griffe",
  "simulation.cycle": "Griff",
  // Playback controls
  "simulation.playback": "Wiedergabe",
  "simulation.stop": "Stopp",
  "simulation.start": "Start",
  "simulation.toStart": "Anfang",
  "simulation.back": "Zurück",
  "simulation.next": "Weiter",
  "simulation.toEnd": "Ende",
  "simulation.direction": "Richtung",
  "simulation.forward": "Vorwärts",
  "simulation.reverse": "Rückwärts",
  "simulation.speed": "Geschwindigkeit",
  "simulation.timePosition": "Zeitposition",
  // Viewer
  "simulation.emptyPreview":
    "Erst einen Stapel mit Lagen speichern, dann lässt sich die Bewegung ansehen.",
  // Lift
  "simulation.lift.title": "Hub (Ewellix)",
  "simulation.lift.position": "Hubposition Ewellix",
  // Timing
  "simulation.timing.title": "Bewegungszeiten",
  "simulation.timing.linearSpeed": "Bahngeschwindigkeit (mm/s)",
  "simulation.timing.angularSpeed": "Drehgeschwindigkeit (°/s)",
  "simulation.timing.pickDwell": "Haltezeit Aufnahme (ms)",
  "simulation.timing.placeDwell": "Haltezeit Ablage (ms)",
  "simulation.timing.betweenCycles": "Pause zwischen Griffen (ms)",
  // Tool position
  "simulation.tcp.title": "Aktuelle Werkzeugposition",
  "simulation.tcp.phase": "Phase",
  "simulation.tcp.rotation": "Drehung",
  "simulation.tcp.keyPoint": "Stützpunkt",
  "simulation.tcp.exact": "exakt",
  "simulation.tcp.interpolated": "interpoliert",
  // Timeline phases
  "simulation.phase.cycleRetract": "Von Palette zurückziehen",
  "simulation.phase.cycleTraverse": "Fahrt über Zufuhr",
  "simulation.phase.pickApproach": "Aufnahme anfahren",
  "simulation.phase.pickDwell": "Verweilen Aufnahme",
  "simulation.phase.pickLift": "Paket anheben",
  "simulation.phase.pickTraverse": "Fahrt von Aufnahme",
  "simulation.phase.transferTraverse": "Fahrt über Palette",
  "simulation.phase.placeApproach": "Ablage anfahren",
  "simulation.phase.placeDwell": "Verweilen Ablage",
  "simulation.phase.betweenCycleDwell": "Verweilen zwischen Zyklen",
} as const;
