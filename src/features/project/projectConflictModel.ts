import type { DuplicateProjectInput } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import type { Translate } from "~/i18n";
import { planLibraryEntry } from "~/features/planner/planLibraryModel";
import type { StorageMode } from "~/lib/storageMode";
import {
  RecordVersionConflictError,
  type ProjectRepository,
  type RecordVersion,
  type RecordWriteOptions,
} from "~/lib/projectRepository";

/**
 * Version conflicts (ADR 0006, issue #36). The editor remembers the stored
 * version of the plan it loaded and saves against exactly that version. When
 * someone else saved in between, the server answers 409 and this model drives
 * the conflict view: own draft left, current server state right, choose a
 * whole plan state or save the draft as a copy. There is no field-level merge.
 */

/** The plan version the open editor is based on. */
export type LoadedProjectVersion = {
  projectId: string;
  version: RecordVersion;
};

/**
 * Write options for saving `projectId`. Only server mode checks versions; local
 * mode keeps its unconditional writes. A plan other than the loaded one (a new
 * plan, a freshly imported file) has no remembered version and is written as
 * before.
 */
export function projectSaveOptions(
  mode: StorageMode,
  loaded: LoadedProjectVersion | null,
  projectId: string,
): RecordWriteOptions | undefined {
  if (mode !== "server" || !loaded || loaded.projectId !== projectId) {
    return undefined;
  }
  return { expectedVersion: loaded.version };
}

/** Whether a failed save is a version conflict on the plan being saved. */
export function isProjectVersionConflict(
  error: unknown,
  projectId: string,
): error is RecordVersionConflictError {
  return error instanceof RecordVersionConflictError && error.id === projectId;
}

/** Current server state; `null` when the plan no longer exists there. */
export type ConflictServerState = {
  project: Project;
  version: RecordVersion;
} | null;

export type ProjectConflict = {
  /** The draft whose save was rejected; it is never discarded implicitly. */
  mine: Project;
  server: ConflictServerState;
  /** The server changed again while a choice was being saved. */
  refreshed: boolean;
};

export function createProjectConflict(
  mine: Project,
  server: ConflictServerState,
  refreshed = false,
): ProjectConflict {
  return { mine, server, refreshed };
}

type ConflictReader = Pick<ProjectRepository, "getProject">;

/** Reads the plan as it is stored right now. */
export async function readConflictServerState(
  repository: ConflictReader,
  projectId: string,
): Promise<ConflictServerState> {
  const result = await repository.getProject(projectId);
  if (!result.project || typeof result.version !== "number") return null;
  return { project: result.project, version: result.version };
}

function sameServerVersion(
  left: ConflictServerState,
  right: ConflictServerState,
): boolean {
  return (left?.version ?? null) === (right?.version ?? null);
}

export type ConflictChoice = "keep-mine" | "keep-server" | "save-copy";

export type ConflictOutcome =
  /** The own draft is now the stored plan at `version`. */
  | { kind: "saved-mine"; project: Project; version: RecordVersion }
  /** The draft is discarded; the editor continues on the server state. */
  | { kind: "adopted-server"; project: Project; version: RecordVersion }
  /** The draft is discarded; the plan no longer exists on the server. */
  | { kind: "server-deleted" }
  /** The draft was saved as a new plan; the original stays as on the server. */
  | { kind: "saved-copy"; project: Project }
  /** The server changed again: compare anew before deciding. */
  | { kind: "refreshed"; conflict: ProjectConflict };

export type ConflictRepository = Pick<
  ProjectRepository,
  "getProject" | "saveProjectVersioned" | "saveProjectAs"
>;

/**
 * Carries out one choice. Every choice is checked against the server version
 * the user saw: "keep mine" writes with that version as `expectedVersion`
 * (the atomic server-side re-check), "keep server" re-reads before adopting.
 * If the server moved on, nothing is written and a refreshed conflict comes
 * back instead. "Save as copy" creates a new plan and cannot conflict.
 */
export async function resolveProjectConflict(
  repository: ConflictRepository,
  conflict: ProjectConflict,
  choice: ConflictChoice,
  copyInput: DuplicateProjectInput = {},
): Promise<ConflictOutcome> {
  const id = conflict.mine.id;
  if (choice === "save-copy") {
    const project = await repository.saveProjectAs(conflict.mine, copyInput);
    return { kind: "saved-copy", project };
  }
  if (choice === "keep-server") {
    const current = await readConflictServerState(repository, id);
    if (!sameServerVersion(current, conflict.server)) {
      return {
        kind: "refreshed",
        conflict: createProjectConflict(conflict.mine, current, true),
      };
    }
    return current
      ? {
          kind: "adopted-server",
          project: current.project,
          version: current.version,
        }
      : { kind: "server-deleted" };
  }
  try {
    const saved = await repository.saveProjectVersioned(conflict.mine, {
      expectedVersion: conflict.server?.version ?? null,
    });
    return { kind: "saved-mine", ...saved };
  } catch (error) {
    if (!isProjectVersionConflict(error, id)) throw error;
    return {
      kind: "refreshed",
      conflict: createProjectConflict(
        conflict.mine,
        await readConflictServerState(repository, id),
        true,
      ),
    };
  }
}

export type ConflictRowId =
  | "projectNumber"
  | "productNumber"
  | "packageDimensions"
  | "packageWeight"
  | "packageClearance"
  | "inletOrientation"
  | "multiPick"
  | "labelSides"
  | "pallet"
  | "overhang"
  | "maxGross"
  | "layerCount"
  | "packagesPerLayer"
  | "totalPackages"
  | "interlayers"
  | "patterns"
  | "geometryReview"
  | "gripper"
  | "palletStation"
  | "robotCycles";

export type ConflictRowGroup = "details" | "package" | "pallet" | "stack";

export type ConflictRow = {
  id: ConflictRowId;
  group: ConflictRowGroup;
  label: string;
  mine: string;
  server: string;
  differs: boolean;
};

export type ConflictComparison = {
  rows: ConflictRow[];
  /** Rows whose plan states differ. */
  differingCount: number;
  /**
   * The plans differ in a field no row shows (e.g. robot cycle poses), so the
   * view can say so instead of claiming they are equal.
   */
  hasUnlistedDifferences: boolean;
};

const EMPTY = "–";

const SIDE_KEYS = {
  top: "conflict.side.top",
  right: "conflict.side.right",
  bottom: "conflict.side.bottom",
  left: "conflict.side.left",
} as const;

function activeSolution(project: Project) {
  return (
    project.solutions.find(({ id }) => id === project.activeSolutionId) ?? null
  );
}

/** JSON with sorted keys and without `undefined` members, for comparisons. */
export function stableJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (typeof input !== "object" || input === null) return input;
    if (Array.isArray(input)) return input.map(normalize);
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };
  return JSON.stringify(normalize(value)) ?? "";
}

/** Plan content without the bookkeeping timestamp every save rewrites. */
export function planContent(project: Project): string {
  return stableJson({ ...project, updatedAt: undefined });
}

/** Whether two plan states are the same apart from `updatedAt`. */
export function samePlanContent(left: Project, right: Project): boolean {
  return planContent(left) === planContent(right);
}

type RowSpec = {
  id: ConflictRowId;
  group: ConflictRowGroup;
  label: string;
  value: (project: Project) => string;
  /** Compared value when the displayed text cannot show every change. */
  key?: (project: Project) => string;
};

function rowSpecs(t: Translate): RowSpec[] {
  const text = (value: string) => (value.trim() === "" ? EMPTY : value);
  const number = (value: number | null | undefined, unit = "") =>
    value === null || value === undefined ? EMPTY : `${value}${unit}`;
  const yesNo = (value: boolean) =>
    value ? t("conflict.value.yes") : t("conflict.value.no");
  const stack = (project: Project) => planLibraryEntry(project);
  return [
    {
      id: "projectNumber",
      group: "details",
      label: t("conflict.row.projectNumber"),
      value: (project) => text(project.projectNumber),
    },
    {
      id: "productNumber",
      group: "details",
      label: t("conflict.row.productNumber"),
      value: (project) => text(project.productNumber),
    },
    {
      id: "packageDimensions",
      group: "package",
      label: t("conflict.row.packageDimensions"),
      value: ({ package: { dimensionsMm: d } }) =>
        `${d.length} × ${d.width} × ${d.height} mm`,
    },
    {
      id: "packageWeight",
      group: "package",
      label: t("conflict.row.packageWeight"),
      value: (project) => number(project.package.weightKg, " kg"),
    },
    {
      id: "packageClearance",
      group: "package",
      label: t("conflict.row.packageClearance"),
      value: (project) => number(project.package.clearanceMm, " mm"),
    },
    {
      id: "inletOrientation",
      group: "package",
      label: t("conflict.row.inletOrientation"),
      value: (project) =>
        project.package.inletOrientation === "lengthwise"
          ? t("conflict.value.lengthwise")
          : t("conflict.value.crosswise"),
    },
    {
      id: "multiPick",
      group: "package",
      label: t("conflict.row.multiPick"),
      value: (project) => yesNo(project.package.multiPickAllowed),
    },
    {
      id: "labelSides",
      group: "package",
      label: t("conflict.row.labelSides"),
      value: (project) =>
        project.package.labelSidesAtPickup.length === 0
          ? EMPTY
          : project.package.labelSidesAtPickup
              .map((side) => t(SIDE_KEYS[side]))
              .join(", "),
    },
    {
      id: "pallet",
      group: "pallet",
      label: t("conflict.row.pallet"),
      value: ({ pallet }) =>
        pallet
          ? `${pallet.name} · ${pallet.dimensionsMm.length} × ${pallet.dimensionsMm.width} mm`
          : EMPTY,
    },
    {
      id: "overhang",
      group: "pallet",
      label: t("conflict.row.overhang"),
      value: ({ pallet }) =>
        pallet
          ? `${pallet.allowedOverhangMm.length} / ${pallet.allowedOverhangMm.width} mm`
          : EMPTY,
    },
    {
      id: "maxGross",
      group: "pallet",
      label: t("conflict.row.maxGross"),
      value: ({ pallet }) => number(pallet?.maxGrossKg, " kg"),
    },
    {
      id: "layerCount",
      group: "stack",
      label: t("conflict.row.layerCount"),
      value: (project) => number(stack(project).layerCount || null),
    },
    {
      id: "packagesPerLayer",
      group: "stack",
      label: t("conflict.row.packagesPerLayer"),
      value: (project) => stack(project).perLayerLabel,
    },
    {
      id: "totalPackages",
      group: "stack",
      label: t("conflict.row.totalPackages"),
      value: (project) => number(stack(project).total || null),
    },
    {
      id: "interlayers",
      group: "stack",
      label: t("conflict.row.interlayers"),
      value: (project) => {
        const solution = activeSolution(project);
        if (!solution) return EMPTY;
        const sheets =
          solution.stack.layers.reduce(
            (sum, layer) => sum + layer.interlayerBefore,
            0,
          ) + solution.stack.trailingInterlayer;
        return String(sheets);
      },
    },
    {
      id: "patterns",
      group: "stack",
      label: t("conflict.row.patterns"),
      value: (project) => {
        const solution = activeSolution(project);
        return solution
          ? t("conflict.value.patternCount", {
              count: solution.patterns.length,
            })
          : EMPTY;
      },
      // Two stacks can share counts yet place packages differently.
      key: (project) => {
        const solution = activeSolution(project);
        return solution
          ? stableJson({
              patterns: solution.patterns,
              layers: solution.stack,
            })
          : "";
      },
    },
    {
      id: "geometryReview",
      group: "stack",
      label: t("conflict.row.geometryReview"),
      value: (project) =>
        yesNo(Boolean(activeSolution(project)?.requiresGeometryReview)),
    },
    {
      id: "gripper",
      group: "stack",
      label: t("conflict.row.gripper"),
      value: (project) =>
        project.grippers.find(({ id }) => id === project.selectedGripperId)
          ?.name ?? EMPTY,
      key: (project) =>
        stableJson({
          selected: project.selectedGripperId,
          grippers: project.grippers,
        }),
    },
    {
      id: "palletStation",
      group: "stack",
      label: t("conflict.row.palletStation"),
      value: (project) =>
        project.palletStations.find(
          ({ id }) => id === project.selectedPalletStationId,
        )?.name ?? EMPTY,
      key: (project) =>
        stableJson({
          selected: project.selectedPalletStationId,
          stations: project.palletStations,
        }),
    },
    {
      id: "robotCycles",
      group: "stack",
      label: t("conflict.row.robotCycles"),
      value: (project) =>
        number(activeSolution(project)?.robotCycles.length ?? null),
      key: (project) => stableJson(activeSolution(project)?.robotCycles ?? []),
    },
  ];
}

/**
 * Side-by-side comparison of two whole plan states. With the plan deleted on
 * the server, every server cell is empty and every row counts as different.
 */
export function compareConflictPlans(
  mine: Project,
  server: Project | null,
  t: Translate,
): ConflictComparison {
  const rows = rowSpecs(t).map((spec): ConflictRow => {
    const mineValue = spec.value(mine);
    const serverValue = server ? spec.value(server) : EMPTY;
    const compared = spec.key ?? spec.value;
    return {
      id: spec.id,
      group: spec.group,
      label: spec.label,
      mine: mineValue,
      server: serverValue,
      differs: server === null || compared(mine) !== compared(server),
    };
  });
  const differingCount = rows.filter(({ differs }) => differs).length;
  return {
    rows,
    differingCount,
    hasUnlistedDifferences:
      server !== null &&
      differingCount === 0 &&
      planContent(mine) !== planContent(server),
  };
}
