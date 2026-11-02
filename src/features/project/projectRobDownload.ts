import type { Translate } from "~/i18n";
import type { Project } from "~/domain/project/projectSchema";
import {
  getRetainedRawRobDownload,
  importedRobTextIsCurrent,
} from "~/domain/robotics/robExport";
import {
  stackLayerCount,
  projectNeedsGeometryReview,
} from "~/features/planning-case/planningCaseModel";
import { exportProjectRobDownload } from "~/features/robotics/robotWorkspaceModel";
import { projectSolutionToPalletData } from "~/lib/projectAdapters";
import { materializeProjectSolutionStack } from "~/domain/stack/project";
import {
  parseRobText,
  serializeRobText,
  ZWISCHENLAGE_HEIGHT_MM,
} from "~/lib/robParser";

export type LibraryRobDownload =
  | { ok: true; fileName: string; text: string }
  | { ok: false; message: string };

/**
 * A project has a .rob plan when it keeps the (still current) imported file's
 * text, or when it has a saved stack the robot export can be derived from.
 */
export function hasRobPlan(project: Project): boolean {
  if (
    importedRobTextIsCurrent(project) &&
    project.source.kind === "rob-import"
  ) {
    return project.source.rawRobText !== undefined;
  }
  return stackLayerCount(project) > 0;
}

/** The active plan is the imported one, edited in the grip editor. */
export function isEditedImportPlan(project: Project): boolean {
  if (project.source.kind !== "rob-import" || importedRobTextIsCurrent(project))
    return false;
  const solution = project.solutions.find(
    ({ id }) => id === project.activeSolutionId,
  );
  return solution?.origin === "manual" && solution.stack.layers.length > 0;
}

/**
 * Regenerates the `.rob` of an imported plan that was edited after the import
 * from the saved plan itself (same legacy frame and file name as the import),
 * so the download never hands back the stale imported text. The retained
 * source text is not touched. Plans `.rob` cannot represent faithfully
 * (packages without a grip, non-3 mm interlayers, grips off whole
 * millimetres) are refused with a reason instead of being exported lossily.
 * Returns null unless the active plan is the imported one edited in the
 * editor (origin "manual"); calculated stacks use the regular robot export.
 */
export function editedImportRobDownload(
  project: Project,
  t: Translate,
): LibraryRobDownload | null {
  if (!isEditedImportPlan(project) || project.source.kind !== "rob-import")
    return null;
  const solution = project.solutions.find(
    ({ id }) => id === project.activeSolutionId,
  )!;

  const usedPatternIds = new Set(
    solution.stack.layers.map(({ patternId }) => patternId),
  );
  const usedPatterns = solution.patterns.filter(({ id }) =>
    usedPatternIds.has(id),
  );
  const unassigned = usedPatterns.flatMap(({ placements }) =>
    placements.filter(({ gripId }) => gripId === null),
  ).length;
  if (unassigned > 0) {
    return {
      ok: false,
      message: t("project.download.unassignedPackages", { count: unassigned }),
    };
  }

  try {
    const stack = materializeProjectSolutionStack(project, solution.id);
    if (
      stack.sheets.some(
        ({ thicknessMm }) =>
          Math.abs(thicknessMm - ZWISCHENLAGE_HEIGHT_MM) > 1e-9,
      )
    ) {
      return { ok: false, message: t("project.download.interlayerThickness") };
    }

    for (const grip of usedPatterns.flatMap(({ grips }) => grips)) {
      const group = grip.groupNumber ?? grip.id;
      if (!Number.isInteger(grip.x) || !Number.isInteger(grip.y)) {
        return {
          ok: false,
          message: t("project.download.wholeMillimetres", {
            group,
            x: grip.x,
            y: grip.y,
          }),
        };
      }
      if (!Number.isInteger(grip.pickX) || !Number.isInteger(grip.pickY)) {
        return {
          ok: false,
          message: t("project.download.pickWholeMillimetres", {
            group,
            x: grip.pickX,
            y: grip.pickY,
          }),
        };
      }
    }

    const text = serializeRobText(projectSolutionToPalletData(project));
    // Same guarantee as the generated export: the file must parse back and
    // carry every saved package.
    const parsed = parseRobText(text);
    const placementsByPattern = new Map(
      usedPatterns.map(({ id, placements }) => [id, placements.length]),
    );
    const expected = solution.stack.layers.reduce(
      (total, { patternId }) =>
        total + (placementsByPattern.get(patternId) ?? 0),
      0,
    );
    if (parsed.total_boxes !== expected) {
      return {
        ok: false,
        message: t("project.download.packageCountMismatch", {
          exported: parsed.total_boxes,
          expected,
        }),
      };
    }
    return { ok: true, fileName: project.source.fileName, text };
  } catch (cause) {
    return {
      ok: false,
      message:
        cause instanceof Error
          ? cause.message
          : t("project.download.exportFailed"),
    };
  }
}

/**
 * Unedited imported plans are handed back verbatim (the retained text is never
 * rewritten). Imported plans edited after the import are regenerated from the
 * saved plan; generated plans go through the default project-derived export.
 */
export function libraryRobDownload(
  project: Project,
  t: Translate,
): LibraryRobDownload {
  if (importedRobTextIsCurrent(project)) {
    const retained = getRetainedRawRobDownload(project, "edited");
    return retained
      ? { ok: true, fileName: retained.fileName, text: retained.text }
      : { ok: false, message: t("project.download.noRobText") };
  }
  if (projectNeedsGeometryReview(project))
    return { ok: false, message: t("project.geometryReview") };
  const edited = editedImportRobDownload(project, t);
  if (edited) return edited;
  if (stackLayerCount(project) === 0) {
    return {
      ok: false,
      message: t("project.download.noStack"),
    };
  }
  const result = exportProjectRobDownload(project);
  if (!result.ok || !result.text) {
    return {
      ok: false,
      message:
        result.diagnostics.map(({ message }) => message).join(" ") ||
        t("project.download.exportFailed"),
    };
  }
  return { ok: true, fileName: result.fileName, text: result.text };
}
