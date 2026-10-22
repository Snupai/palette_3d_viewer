import type { StackCompositionMode, StackLayerTransform } from "~/domain/stack";
import type { StackWorkspaceState } from "~/features/stack/stackWorkspaceModel";

/** Applies an edit to the stack workspace state and marks it dirty. */
export type StackWorkspaceChange = (
  updater:
    | StackWorkspaceState
    | ((current: StackWorkspaceState) => StackWorkspaceState),
) => void;

export const stackInputClass = "ui-input text-xs";
export const stackButtonClass = "ui-btn ui-btn-sm";
export const stackFieldsetClass = "grid gap-3 border border-line p-3";
export const stackLegendClass = "px-1 text-xs font-semibold text-ink";
export const stackFieldLabelClass = "grid gap-1 text-micro text-muted";
export const stackCheckboxClass = "h-4 w-4 accent-brand";

export const modeLabels: Record<StackCompositionMode, string> = {
  tower: "Tower",
  "longitudinal-mirror": "Longitudinal mirror",
  "transverse-mirror": "Transverse mirror",
  rotation: "180° rotation",
};

export const transformLabels: Record<StackLayerTransform, string> = {
  identity: "No transform",
  "rotate-90": "Rotate 90°",
  "rotate-180": "Rotate 180°",
  "rotate-270": "Rotate 270°",
  "mirror-x": "Mirror along pallet width (flip X)",
  "mirror-y": "Mirror along pallet length (flip Y)",
  "transpose-main": "Transpose main diagonal",
  "transpose-anti": "Transpose anti-diagonal",
};

export function metric(value: number | null, suffix = ""): string {
  return value === null ? "Unknown" : `${Number(value.toFixed(2))}${suffix}`;
}
