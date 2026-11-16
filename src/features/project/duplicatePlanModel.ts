import type { Project } from "~/domain/project/projectSchema";

/**
 * What makes two plans "the same plan" for the user: the number the library
 * shows as the title (product number, else project number). Untitled plans
 * never count as duplicates.
 */
export function planIdentity(
  project: Pick<Project, "productNumber" | "projectNumber">,
): string | null {
  const label = project.productNumber.trim() || project.projectNumber.trim();
  return label ? label.toLocaleLowerCase("de") : null;
}

/**
 * Stored plans `project` would duplicate, newest first. Only a save that gives
 * the plan a new identity asks: a new plan, or a stored one (`previous`) whose
 * number changed. Saving a plan again under its own number never asks.
 */
export function needsDuplicateCheck(
  project: Project,
  previous: Project | null,
): boolean {
  const identity = planIdentity(project);
  return (
    identity !== null &&
    !(previous?.id === project.id && planIdentity(previous) === identity)
  );
}

export function findDuplicatePlans(
  project: Project,
  previous: Project | null,
  stored: readonly Project[],
): Project[] {
  if (!needsDuplicateCheck(project, previous)) return [];
  const identity = planIdentity(project);
  return stored
    .filter(
      (candidate) =>
        candidate.id !== project.id && planIdentity(candidate) === identity,
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
