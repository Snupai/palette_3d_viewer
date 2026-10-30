import type { Translate } from "~/i18n";
import type { CandidateLabelSide } from "~/domain/solver/candidateIdentity";
import type {
  ProjectEditorDiagnostic,
  ProjectEditorGroup,
} from "~/features/editor/editorModel";

/** Label side options as shown in the editor, in the order of the picker. */
export function labelSideOptions(
  t: Translate,
): ReadonlyArray<readonly [CandidateLabelSide | "", string]> {
  return [
    ["", t("editor.labelSide.none")],
    ["top", t("editor.labelSide.top")],
    ["right", t("editor.labelSide.right")],
    ["bottom", t("editor.labelSide.bottom")],
    ["left", t("editor.labelSide.left")],
    ["top_right", t("editor.labelSide.topRight")],
    ["bottom_right", t("editor.labelSide.bottomRight")],
    ["bottom_left", t("editor.labelSide.bottomLeft")],
    ["top_left", t("editor.labelSide.topLeft")],
  ];
}

/** The part of a layer pattern the labels need. */
type PatternLike = {
  placements: readonly { id: string; sequence: number }[];
};

/** "#3" for the third placed package of a pattern, falling back to the id. */
export function packageLabel(
  pattern: PatternLike,
  placementId: string,
): string {
  const placement = pattern.placements.find(({ id }) => id === placementId);
  return placement ? `#${placement.sequence + 1}` : placementId;
}

/** "G2" for a grip, by its order in the current execution sequence. */
export function gripLabel(
  groups: readonly ProjectEditorGroup[],
  gripId: string,
): string {
  const group = groups.find(({ id }) => id === gripId);
  return group ? `G${group.orderIndex + 1}` : gripId;
}

/**
 * Localized text for a model diagnostic. The model keeps English messages for
 * tests and logs; the editor shows package and grip labels instead of ids.
 */
export function describeDiagnostic(
  diagnostic: ProjectEditorDiagnostic,
  pattern: PatternLike,
  groups: readonly ProjectEditorGroup[],
  t: Translate,
): string {
  const packages = (diagnostic.placementIds ?? []).map((id) =>
    packageLabel(pattern, id),
  );
  const grips = (diagnostic.gripIds ?? []).map((id) => gripLabel(groups, id));
  const grip = grips[0] ?? "?";
  switch (diagnostic.code) {
    case "missing-active-solution":
      return t("editor.diag.noSolution");
    case "missing-pattern":
      return t("editor.diag.noPattern");
    case "missing-pallet":
      return t("editor.diag.noPallet");
    case "placement-out-of-bounds":
      return t("editor.diag.outOfBounds", { package: packages[0] ?? "?" });
    case "placement-overlap":
      return t("editor.diag.overlap", {
        first: packages[0] ?? "?",
        second: packages[1] ?? "?",
      });
    case "placement-unassigned":
      return t("editor.diag.unassigned", { package: packages[0] ?? "?" });
    case "empty-group":
      return t("editor.diag.emptyGroup", { grip });
    case "invalid-group-geometry":
      return t("editor.diag.groupGeometry", {
        grip,
        reason: geometryReason(diagnostic.message, t),
      });
    case "group-label-mismatch":
      return t("editor.diag.labelMismatch", { grip });
    case "group-order-omission":
      return t("editor.diag.orderOmission");
    case "group-number-duplicate":
      return t("editor.diag.numberDuplicate", {
        grips: grips.join(", ") || "?",
      });
    case "invalid-order":
      return t("editor.diag.invalidOrder", { message: diagnostic.message });
    case "invalid-project":
      return t("editor.diag.invalidProject", { message: diagnostic.message });
  }
}

const geometryReasonKeys = {
  "A group must contain at least one package placement.": "editor.reason.empty",
  "This project does not allow multiple packages in one grip group.":
    "editor.reason.multiPick",
  "Grouped packages must use the same placement rotation.":
    "editor.reason.rotation",
  "Grouped packages must be aligned on one cross axis.":
    "editor.reason.crossAxis",
  "Grouped packages must be face-adjacent along their local length axis.":
    "editor.reason.adjacent",
} as const;

function geometryReason(message: string, t: Translate): string {
  const colon = message.indexOf(": ");
  const reason = colon >= 0 ? message.slice(colon + 2) : message;
  const key =
    geometryReasonKeys[reason as keyof typeof geometryReasonKeys] ?? null;
  return key ? t(key) : reason;
}

/**
 * Why the current selection cannot become a grip, for the order view. The
 * problem is the selection itself, what it would leave behind of a partly
 * selected grip, or an existing grip that is already invalid.
 */
export function describeGripSelectionProblem(
  diagnostic: ProjectEditorDiagnostic,
  pattern: PatternLike,
  groups: readonly ProjectEditorGroup[],
  selectedPlacementIds: ReadonlySet<string>,
  t: Translate,
): string {
  if (diagnostic.code !== "invalid-group-geometry") {
    return describeDiagnostic(diagnostic, pattern, groups, t);
  }
  const existing = groups.find(({ id }) => diagnostic.gripIds?.includes(id));
  if (!existing) {
    return t("editor.selection.invalid", {
      reason: geometryReason(diagnostic.message, t),
    });
  }
  const selectedCount = existing.placementIds.filter((id) =>
    selectedPlacementIds.has(id),
  ).length;
  return selectedCount > 0 && selectedCount < existing.placementIds.length
    ? t("editor.selection.invalidRemainder", {
        grip: gripLabel(groups, existing.id),
        reason: geometryReason(diagnostic.message, t),
      })
    : describeDiagnostic(diagnostic, pattern, groups, t);
}
