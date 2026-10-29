import type { Translate } from "~/i18n";
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

export function modeLabel(t: Translate, mode: StackCompositionMode): string {
  return t(`stack.classicMode.${mode}`);
}

export const stackLayerTransforms: readonly StackLayerTransform[] = [
  "identity",
  "rotate-90",
  "rotate-180",
  "rotate-270",
  "mirror-x",
  "mirror-y",
  "transpose-main",
  "transpose-anti",
];

export function classicTransformLabel(
  t: Translate,
  transform: StackLayerTransform,
): string {
  return t(`stack.classicTransform.${transform}`);
}

export function metric(
  t: Translate,
  value: number | null,
  suffix = "",
): string {
  return value === null
    ? t("stack.unknown")
    : `${Number(value.toFixed(2))}${suffix}`;
}
