import type { Project } from "~/domain/project/projectSchema";
import { projectSolutionToPalletData } from "~/lib/projectAdapters";

export function planLibraryEntry(project: Project) {
  let data = null;
  try {
    data = projectSolutionToPalletData(project);
  } catch {
    /* A project with only inputs has no stack. */
  }
  const counts = data?.layers.map((l) => l.boxes.length) ?? [];
  const perLayer = [...new Set(counts)].sort((a, b) => a - b);
  return {
    project,
    data,
    layerCount: data?.layer_count ?? 0,
    total: data?.total_boxes ?? 0,
    perLayer,
    perLayerLabel: perLayer.length ? perLayer.join(" / ") : "–",
  };
}
export type PlanLibraryEntry = ReturnType<typeof planLibraryEntry>;
export type PlanFilters = {
  lengthMin: string;
  lengthMax: string;
  widthMin: string;
  widthMax: string;
  heightMin: string;
  heightMax: string;
  layersMin: string;
  layersMax: string;
  boxesMin: string;
  boxesMax: string;
  source: string;
  pallet: string;
};
export const emptyPlanFilters: PlanFilters = {
  lengthMin: "",
  lengthMax: "",
  widthMin: "",
  widthMax: "",
  heightMin: "",
  heightMax: "",
  layersMin: "",
  layersMax: "",
  boxesMin: "",
  boxesMax: "",
  source: "all",
  pallet: "all",
};
function within(n: number, min: string, max: string) {
  return (
    (min.trim() === "" || n >= Number(min)) &&
    (max.trim() === "" || n <= Number(max))
  );
}
export function filterPlanEntries(
  entries: readonly PlanLibraryEntry[],
  f: PlanFilters,
) {
  return entries.filter((e) => {
    const d = e.project.package.dimensionsMm;
    return (
      within(d.length, f.lengthMin, f.lengthMax) &&
      within(d.width, f.widthMin, f.widthMax) &&
      within(d.height, f.heightMin, f.heightMax) &&
      within(e.layerCount, f.layersMin, f.layersMax) &&
      ((!f.boxesMin && !f.boxesMax) ||
        e.perLayer.some((n) => within(n, f.boxesMin, f.boxesMax))) &&
      (f.source === "all" || e.project.source.kind === f.source) &&
      (f.pallet === "all" || e.project.pallet?.kind === f.pallet)
    );
  });
}
