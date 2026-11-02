import type { BlockPlanPackageDmm } from "~/domain/solver/blockPlan/families";
import type { BlockPlanSolution } from "~/domain/solver/blockPlan/optimizer";
import {
  searchBlockPlanPlans,
  type PlanSearchInput,
} from "~/domain/solver/blockPlan/planSearch";

/**
 * Plans from the plan search. `stopAtTarget` enables the search's early exit
 * and exact-count trim; the solver catalog leaves it off so later families
 * still run after a grid already matches the requested count.
 */
export type BlockPlanEnumerationInput = {
  paletteDmm: { x: number; y: number };
  package: BlockPlanPackageDmm;
  clearanceDmm: number;
} & Omit<PlanSearchInput, "paletteDmm" | "package" | "clearanceDmm">;

export type EnumeratedBlockPlanSolution = {
  variant: string;
  solution: BlockPlanSolution;
};

export function enumerateBlockPlanSolutions(
  input: BlockPlanEnumerationInput,
): EnumeratedBlockPlanSolution[] {
  return searchBlockPlanPlans(input);
}
