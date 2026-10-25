import type { ProductionTool } from "~/features/planning-case/PlanningCaseWorkbench";
import type { PlanningStage } from "~/features/planning-case/planningCaseModel";

/**
 * URL ⇄ planner shell state. Paths are flat so a reload lands on the same
 * screen: `/`, `/plans`, `/new`, `/plan/<id>/<stage>[/<tool>]`,
 * `/plan/<id>/edit`.
 *
 * Slugs are English and independent of the UI language.
 */
export type PlannerRoute =
  | { kind: "welcome" }
  | { kind: "library" }
  | { kind: "create" }
  | {
      kind: "plan";
      id: string;
      stage: PlanningStage | null;
      view: "edit" | ProductionTool | null;
    };

const STAGE_SLUGS: Record<PlanningStage, string> = {
  inputs: "inputs",
  generate: "patterns",
  stack: "build",
};

const PRODUCTION_TOOLS: readonly ProductionTool[] = [
  "candidate-browser",
  "candidate-3d",
  "stack",
  "editor",
  "robotics",
  "simulation",
  "report",
];

const stageBySlug = new Map(
  Object.entries(STAGE_SLUGS).map(([stage, slug]) => [
    slug,
    stage as PlanningStage,
  ]),
);

export function parsePlannerRoute(pathname: string): PlannerRoute {
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  if (segments.length === 0) return { kind: "welcome" };
  if (segments[0] === "plans") return { kind: "library" };
  if (segments[0] === "new") return { kind: "create" };
  if (segments[0] === "plan" && segments[1]) {
    const id = segments[1];
    const second = segments[2];
    if (second === "edit") {
      return { kind: "plan", id, stage: null, view: "edit" };
    }
    const stage = second ? (stageBySlug.get(second) ?? null) : null;
    const third = segments[3];
    const view =
      third && (PRODUCTION_TOOLS as readonly string[]).includes(third)
        ? (third as ProductionTool)
        : null;
    return { kind: "plan", id, stage, view };
  }
  return { kind: "welcome" };
}

export function plannerRoutePath(route: PlannerRoute): string {
  switch (route.kind) {
    case "welcome":
      return "/";
    case "library":
      return "/plans";
    case "create":
      return "/new";
    case "plan": {
      const base = `/plan/${encodeURIComponent(route.id)}`;
      if (route.view === "edit") return `${base}/edit`;
      const stage = route.stage ? `/${STAGE_SLUGS[route.stage]}` : "";
      const tool = route.view ? `/${route.view}` : "";
      return `${base}${stage}${tool}`;
    }
  }
}
