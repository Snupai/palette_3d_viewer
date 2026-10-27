import type { MultiPackPackageDmm } from "~/domain/solver/multipack/families";
import type { MultiPackSolution } from "~/domain/solver/multipack/optimizer";
import {
  searchMultiPackPlans,
  type PlanSearchInput,
} from "~/domain/solver/multipack/planSearch";

/**
 * Plans from `FUN_00bea380`. `stopAtTarget` reproduces Optimize's early exit
 * and exact-count trim; the solver catalog leaves it off so later families
 * still run after a grid already matches the requested count.
 */
export type MultiPackEnumerationInput = {
  paletteDmm: { x: number; y: number };
  package: MultiPackPackageDmm;
  clearanceDmm: number;
} & Omit<PlanSearchInput, "paletteDmm" | "package" | "clearanceDmm">;

export type EnumeratedMultiPackSolution = {
  variant: string;
  solution: MultiPackSolution;
};

export function enumerateMultiPackSolutions(
  input: MultiPackEnumerationInput,
): EnumeratedMultiPackSolution[] {
  return searchMultiPackPlans(input);
}
