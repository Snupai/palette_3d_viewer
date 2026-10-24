import type { Project } from "~/domain/project/projectSchema";
import { getRetainedRawRobDownload } from "~/domain/robotics/robExport";
import {
  stackLayerCount,
  projectNeedsGeometryReview,
  GEOMETRY_REVIEW_MESSAGE,
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
export function libraryRobDownload(project: Project): LibraryRobDownload {
  if (project.source.kind === "rob-import") {
    const retained = getRetainedRawRobDownload(project, "edited");
    return retained
      ? { ok: true, fileName: retained.fileName, text: retained.text }
      : { ok: false, message: "This project keeps no .rob file text." };
  }
  if (projectNeedsGeometryReview(project))
    return { ok: false, message: GEOMETRY_REVIEW_MESSAGE };
  if (stackLayerCount(project) === 0) {
    return {
      ok: false,
      message: "Save a stack for this project before downloading a .rob plan.",
    };
  }
  const result = exportProjectRobDownload(project);
  if (!result.ok || !result.text) {
    return {
      ok: false,
      message:
        result.diagnostics.map(({ message }) => message).join(" ") ||
        "The .rob plan could not be exported.",
    };
  }
  return { ok: true, fileName: result.fileName, text: result.text };
}
