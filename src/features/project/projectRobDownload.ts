import type { Translate } from "~/i18n";
import type { Project } from "~/domain/project/projectSchema";
import { getRetainedRawRobDownload } from "~/domain/robotics/robExport";
import {
  stackLayerCount,
  projectNeedsGeometryReview,
} from "~/features/planning-case/planningCaseModel";
import { exportProjectRobDownload } from "~/features/robotics/robotWorkspaceModel";

export type LibraryRobDownload =
  | { ok: true; fileName: string; text: string }
  | { ok: false; message: string };

/**
 * A project has a .rob plan when it keeps the imported file's text, or when
 * it has a saved stack the robot export can be derived from.
 */
export function hasRobPlan(project: Project): boolean {
  if (project.source.kind === "rob-import") {
    return project.source.rawRobText !== undefined;
  }
  return stackLayerCount(project) > 0;
}

/**
 * Imported plans are handed back verbatim (the retained text is never
 * rewritten); generated plans go through the default project-derived export.
 */
export function libraryRobDownload(
  project: Project,
  t: Translate,
): LibraryRobDownload {
  if (project.source.kind === "rob-import") {
    const retained = getRetainedRawRobDownload(project, "edited");
    return retained
      ? { ok: true, fileName: retained.fileName, text: retained.text }
      : { ok: false, message: t("project.download.noRobText") };
  }
  if (projectNeedsGeometryReview(project))
    return { ok: false, message: t("project.geometryReview") };
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
