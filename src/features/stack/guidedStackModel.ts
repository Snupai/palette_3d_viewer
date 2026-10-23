import type { Project } from "~/domain/project/projectSchema";
import type { SolverCandidate } from "~/domain/solver";
import {
  createCompositionSequence,
  type StackCompositionMode,
  type StackLayerTransform,
  type StackWarning,
} from "~/domain/stack";
import {
  calculateWorkspaceCapacity,
  candidatePatternRef,
  createInitialStackWorkspaceState,
  rebuildStackSequence,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";

export const compositionModes: readonly StackCompositionMode[] = [
  "tower",
  "longitudinal-mirror",
  "transverse-mirror",
  "rotation",
];

export const compositionLabelsDe: Record<StackCompositionMode, string> = {
  tower: "Turm (identisch)",
  "longitudinal-mirror": "Längs gespiegelt",
  "transverse-mirror": "Quer gespiegelt",
  rotation: "Um 180° gedreht",
};

export const transformLabelsDe: Record<StackLayerTransform, string> = {
  identity: "unverändert",
  "rotate-90": "um 90° gedreht",
  "rotate-180": "um 180° gedreht",
  "rotate-270": "um 270° gedreht",
  "mirror-x": "quer gespiegelt",
  "mirror-y": "längs gespiegelt",
  "transpose-main": "an der Hauptdiagonale gespiegelt",
  "transpose-anti": "an der Nebendiagonale gespiegelt",
};

/**
 * Guided start: pattern A as a full stack when the storage height gives a
 * trustworthy capacity, otherwise the single layer of the classic workspace.
 */
export function createGuidedInitialState(
  project: Project,
  candidates: readonly SolverCandidate[],
): StackWorkspaceState {
  const initial = createInitialStackWorkspaceState(candidates);
  if (!initial.patternARef) return initial;
  const capacity = calculateWorkspaceCapacity(project, initial);
  if (capacity?.status !== "calculated" || capacity.capacityLayers <= 1) {
    return initial;
  }
  return rebuildStackSequence({
    ...initial,
    requestedLayerCount: capacity.capacityLayers,
  });
}

/**
 * Applies a count/composition/pattern change and rebuilds the sequence with
 * the production composer. Individually placed sheets stay on the layers that
 * still exist, so adding a layer does not clear earlier sheet choices.
 */
export function rebuildGuidedSequence(
  state: StackWorkspaceState,
  patch: Partial<
    Pick<
      StackWorkspaceState,
      "requestedLayerCount" | "compositionMode" | "patternARef" | "patternBRef"
    >
  >,
): StackWorkspaceState {
  const rebuilt = rebuildStackSequence({ ...state, ...patch });
  const layerIds = new Set(rebuilt.layers.map(({ id }) => id));
  const individualBeforeLayer = Object.fromEntries(
    Object.entries(state.individualBeforeLayer).filter(([layerId]) =>
      layerIds.has(layerId),
    ),
  );
  return { ...rebuilt, individualBeforeLayer };
}

/** Layer count clamped to the stepper's range; NaN and fractions round down. */
export function clampLayerCount(value: number, max = 999): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

/** Two-layer sequence used for the composition tile thumbnails. */
export function compositionPreviewState(
  state: StackWorkspaceState,
  mode: StackCompositionMode,
): StackWorkspaceState | null {
  if (!state.patternARef) return null;
  return {
    ...state,
    compositionMode: mode,
    requestedLayerCount: 2,
    layers: createCompositionSequence({
      mode,
      layerCount: 2,
      primaryPatternRef: state.patternARef,
      secondaryPatternRef: state.patternBRef,
    }),
    interlayerMode: "none",
    individualBeforeLayer: {},
    baseEnabled: false,
    deckEnabled: false,
    specialTopEnabled: false,
  };
}

export function setIndividualSheet(
  state: StackWorkspaceState,
  layerId: string,
  enabled: boolean,
): StackWorkspaceState {
  const current = state.individualBeforeLayer[layerId];
  return {
    ...state,
    individualBeforeLayer: {
      ...state.individualBeforeLayer,
      [layerId]: { thicknessMm: current?.thicknessMm ?? 3, enabled },
    },
  };
}

export function candidateLabelDe(candidate: SolverCandidate): string {
  return `Platz ${candidate.rank}, ${candidate.metrics.packageCount} Pakete`;
}

/** "Muster A" / "Muster B" for the composed refs, else the candidate rank. */
export function patternNameDe(
  state: StackWorkspaceState,
  patternRef: string,
  candidateByRef: ReadonlyMap<string, SolverCandidate>,
): string {
  if (patternRef === state.patternARef) return "Muster A";
  if (patternRef === state.patternBRef) return "Muster B";
  const candidate = candidateByRef.get(patternRef);
  return candidate ? `Platz ${candidate.rank}` : "Fehlendes Muster";
}

export function candidateRefOptions(candidates: readonly SolverCandidate[]) {
  return candidates.map((candidate) => ({
    value: candidatePatternRef(candidate),
    label: candidateLabelDe(candidate),
  }));
}

const numberFormat = new Intl.NumberFormat("de-DE", {
  maximumFractionDigits: 1,
});

export function formatDe(value: number): string {
  return numberFormat.format(value);
}

const limitCodes = new Set<StackWarning["code"]>([
  "height-exceeded",
  "gross-weight-exceeded",
  "footprint-exceeded",
  "storage-envelope-exceeded",
  "invalid-stack-input",
]);

/** Limit violations are shown with the totals; the rest are planning notes. */
export function isLimitWarning(warning: StackWarning): boolean {
  return warning.severity === "error" || limitCodes.has(warning.code);
}

const metricNamesDe: Record<string, string> = {
  "area utilization": "Flächennutzung",
  "volume utilization": "Volumennutzung",
  "storage height utilization": "Höhennutzung",
  "gross weight": "Bruttogewicht",
  "cycle count": "Taktzahl",
};

const resourceTextDe: Record<string, string> = {
  pallet:
    "Keine Palette gewählt; Ladefläche, Lagermaße und Gewichte sind nicht prüfbar.",
  gripper:
    "Kein Greifer ausgewählt; die Takte sind noch keinem Greifer zugeordnet.",
  "pallet-station":
    "Keine Palettenstation ausgewählt; die Robotik-Prüfung folgt später.",
  "package-weight":
    "Paketgewicht fehlt; Nutzlast und Bruttogewicht sind unbekannt.",
  "pallet-tare":
    "Leergewicht der Palette fehlt; das Bruttogewicht ist unbekannt.",
  material: "Eine Zwischenlage verweist auf ein fehlendes Material.",
  pattern: "Ein Muster der Schichtfolge fehlt in den Ergebnissen.",
};

/** German one-liner built from the warning's structured fields. */
export function describeStackWarning(warning: StackWarning): string {
  const actual = warning.actual ? formatDe(warning.actual.value) : null;
  const limit = warning.limit ? formatDe(warning.limit.value) : null;
  const axis =
    warning.axis === "length"
      ? "länge"
      : warning.axis === "width"
        ? "breite"
        : null;
  switch (warning.code) {
    case "height-exceeded":
      return actual && limit
        ? `Ladehöhe ${actual} mm liegt über der Lagerhöhe ${limit} mm.`
        : "Die Ladehöhe liegt über der Lagerhöhe.";
    case "gross-weight-exceeded":
      return actual && limit
        ? `Bruttogewicht ${actual} kg liegt über dem Maximum ${limit} kg.`
        : "Das Bruttogewicht liegt über dem Maximum.";
    case "storage-envelope-exceeded":
      return axis && actual && limit
        ? `Block${axis} ${actual} mm ist größer als die Lager${axis} ${limit} mm.`
        : "Der Block ist größer als die Lagerfläche.";
    case "footprint-exceeded":
      return "Eine Schicht ragt über die zulässige Ladefläche hinaus.";
    case "missing-resource":
      return (
        (warning.resourceKind && resourceTextDe[warning.resourceKind]) ??
        warning.message
      );
    case "metric-provenance-unknown":
    case "metric-provenance-unverified": {
      const name =
        (warning.metricName && metricNamesDe[warning.metricName]) ??
        warning.metricName ??
        "Kennzahl";
      return warning.code === "metric-provenance-unknown"
        ? `${name}: nicht berechenbar, Angaben fehlen.`
        : `${name}: Wert ist nicht bestätigt.`;
    }
    case "transform-frame-fallback":
      return "Spiegelung und Drehung beziehen sich ersatzweise auf die Palette statt auf den Erzeugungsrahmen.";
    case "invalid-stack-input":
      return warning.message;
  }
}
