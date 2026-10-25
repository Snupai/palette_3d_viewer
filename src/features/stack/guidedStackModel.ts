import type { MessageKey, Translate } from "~/i18n";
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

export function compositionLabel(
  t: Translate,
  mode: StackCompositionMode,
): string {
  return t(`stack.composition.${mode}`);
}

export function transformLabel(
  t: Translate,
  transform: StackLayerTransform,
): string {
  return t(`stack.transform.${transform}`);
}

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
  // Same bound as manual edits; a tiny package height would otherwise
  // materialize millions of layers before the user can correct it.
  return rebuildStackSequence({
    ...initial,
    requestedLayerCount: clampLayerCount(capacity.capacityLayers),
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

export function candidateLabel(
  t: Translate,
  candidate: SolverCandidate,
): string {
  return t("stack.candidateLabel", {
    rank: candidate.rank,
    count: candidate.metrics.packageCount,
  });
}

/** "Muster A" / "Muster B" for the composed refs, else the candidate rank. */
export function patternName(
  t: Translate,
  state: StackWorkspaceState,
  patternRef: string,
  candidateByRef: ReadonlyMap<string, SolverCandidate>,
): string {
  if (patternRef === state.patternARef) return t("stack.patternA");
  if (patternRef === state.patternBRef) return t("stack.patternB");
  const candidate = candidateByRef.get(patternRef);
  return candidate
    ? t("stack.rank", { rank: candidate.rank })
    : t("stack.missingPattern");
}

export function candidateRefOptions(
  t: Translate,
  candidates: readonly SolverCandidate[],
) {
  return candidates.map((candidate) => ({
    value: candidatePatternRef(candidate),
    label: candidateLabel(t, candidate),
  }));
}

const numberFormats = new Map<string, Intl.NumberFormat>();

/** Locale-aware number with at most one fraction digit; `tag` is a BCP-47 tag. */
export function formatNumber(value: number, tag: string): string {
  let format = numberFormats.get(tag);
  if (!format) {
    format = new Intl.NumberFormat(tag, { maximumFractionDigits: 1 });
    numberFormats.set(tag, format);
  }
  return format.format(value);
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

const metricNameKeys: Record<string, MessageKey> = {
  "area utilization": "stack.warn.metric.area",
  "volume utilization": "stack.warn.metric.volume",
  "storage height utilization": "stack.warn.metric.height",
  "gross weight": "stack.warn.metric.weight",
  "cycle count": "stack.warn.metric.cycles",
};

const resourceTextKeys: Record<string, MessageKey> = {
  pallet: "stack.warn.resource.pallet",
  gripper: "stack.warn.resource.gripper",
  "pallet-station": "stack.warn.resource.palletStation",
  "package-weight": "stack.warn.resource.packageWeight",
  "pallet-tare": "stack.warn.resource.palletTare",
  material: "stack.warn.resource.material",
  pattern: "stack.warn.resource.pattern",
};

/** One-liner in the active language built from the warning's structured fields. */
export function describeStackWarning(
  warning: StackWarning,
  t: Translate,
  tag: string,
): string {
  const actual = warning.actual
    ? formatNumber(warning.actual.value, tag)
    : null;
  const limit = warning.limit ? formatNumber(warning.limit.value, tag) : null;
  switch (warning.code) {
    case "height-exceeded":
      return actual && limit
        ? t("stack.warn.height", { actual, limit })
        : t("stack.warn.heightShort");
    case "gross-weight-exceeded":
      return actual && limit
        ? t("stack.warn.weight", { actual, limit })
        : t("stack.warn.weightShort");
    case "storage-envelope-exceeded":
      return (warning.axis === "length" || warning.axis === "width") &&
        actual &&
        limit
        ? t(
            warning.axis === "length"
              ? "stack.warn.envelopeLength"
              : "stack.warn.envelopeWidth",
            { actual, limit },
          )
        : t("stack.warn.envelopeShort");
    case "footprint-exceeded":
      return t("stack.warn.footprint");
    case "missing-resource": {
      const key =
        warning.resourceKind && resourceTextKeys[warning.resourceKind];
      return key ? t(key) : warning.message;
    }
    case "metric-provenance-unknown":
    case "metric-provenance-unverified": {
      const nameKey = warning.metricName && metricNameKeys[warning.metricName];
      const name = nameKey
        ? t(nameKey)
        : (warning.metricName ?? t("stack.warn.metricFallback"));
      return t(
        warning.code === "metric-provenance-unknown"
          ? "stack.warn.metricUnknown"
          : "stack.warn.metricUnverified",
        { name },
      );
    }
    case "transform-frame-fallback":
      return t("stack.warn.frameFallback");
    case "invalid-stack-input":
      return warning.message;
  }
}
