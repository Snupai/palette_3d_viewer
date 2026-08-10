import {
  migrateProject,
  projectToProjectV2,
} from "~/domain/project/projectMigration";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  projectSchema,
  type PackageSpec,
  type PalletSpec,
  type PlanningSolution,
  type Project,
  type ProjectV2,
} from "~/domain/project/projectSchema";
import { createMultipackEquipmentProfileResources } from "~/domain/project/equipmentProfiles";
import {
  getPalletTemplate,
  type PalletTemplateKind,
} from "~/domain/project/palletTemplates";

export type ProjectEntityKind =
  | "project"
  | "solution"
  | "pattern"
  | "layer"
  | "placement"
  | "cycle"
  | "resource";

export type ProjectFactoryDependencies = {
  createId?: (kind: ProjectEntityKind) => string;
  now?: () => number;
};

const defaultPackage: PackageSpec = {
  shape: "cuboid",
  dimensionsMm: { length: 400, width: 300, height: 200 },
  weightKg: null,
  clearanceMm: 0,
  multiPickAllowed: false,
  inletOrientation: "lengthwise",
  palletizingDirection: null,
  labelSidesAtPickup: [],
};

function dependencies(input: ProjectFactoryDependencies = {}) {
  return {
    createId:
      input.createId ??
      ((kind: ProjectEntityKind) =>
        `${kind}-${
          globalThis.crypto?.randomUUID?.() ??
          `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
        }`),
    now: input.now ?? Date.now,
  };
}

export function defaultPackageSpec(): PackageSpec {
  return {
    ...defaultPackage,
    dimensionsMm: { ...defaultPackage.dimensionsMm },
    labelSidesAtPickup: [...defaultPackage.labelSidesAtPickup],
  };
}

export function createEmptyPlanningSolution(
  input: { id?: string; name?: string } = {},
  factoryDependencies: ProjectFactoryDependencies = {},
): PlanningSolution {
  const deps = dependencies(factoryDependencies);
  return {
    id: input.id ?? deps.createId("solution"),
    name: input.name ?? "Solution 1",
    origin: "manual",
    patterns: [],
    stack: {
      interlayerThicknessMm: 3,
      layers: [],
      trailingInterlayer: 0,
    },
    robotCycles: [],
  };
}

type PackageOverrides = Partial<Omit<PackageSpec, "dimensionsMm">> & {
  dimensionsMm?: Partial<PackageSpec["dimensionsMm"]>;
};

export type CreateProjectInput = {
  id?: string;
  projectNumber?: string;
  productNumber?: string;
  source?: Project["source"];
  package?: PackageOverrides;
  pallet?: PalletSpec | PalletTemplateKind | null;
  grippers?: Project["grippers"];
  palletStations?: Project["palletStations"];
  selectedGripperId?: string | null;
  selectedPalletStationId?: string | null;
  solutions?: Project["solutions"];
  activeSolutionId?: string | null;
};

/** Creates a complete, viewer-independent planning project without a .rob file. */
export function createProject(
  input: CreateProjectInput = {},
  factoryDependencies: ProjectFactoryDependencies = {},
): Project {
  const deps = dependencies(factoryDependencies);
  const timestamp = deps.now();
  const packageDefaults = defaultPackageSpec();
  const packageSpec: PackageSpec = {
    ...packageDefaults,
    ...input.package,
    dimensionsMm: {
      ...packageDefaults.dimensionsMm,
      ...input.package?.dimensionsMm,
    },
    labelSidesAtPickup:
      input.package?.labelSidesAtPickup ?? packageDefaults.labelSidesAtPickup,
  };
  const pallet =
    input.pallet === undefined
      ? getPalletTemplate("euro")
      : typeof input.pallet === "string"
        ? getPalletTemplate(input.pallet)
        : input.pallet;
  const source: Project["source"] = input.source ?? { kind: "new" };
  const seededEquipment =
    source.kind === "new" &&
    input.grippers === undefined &&
    input.palletStations === undefined
      ? createMultipackEquipmentProfileResources()
      : null;
  const grippers = input.grippers ?? seededEquipment?.grippers ?? [];
  const palletStations =
    input.palletStations ?? seededEquipment?.palletStations ?? [];
  const solutions = input.solutions ?? [
    createEmptyPlanningSolution({}, factoryDependencies),
  ];

  return projectSchema.parse({
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    id: input.id ?? deps.createId("project"),
    projectNumber: input.projectNumber ?? "",
    productNumber: input.productNumber ?? "",
    createdAt: timestamp,
    updatedAt: timestamp,
    source,
    package: packageSpec,
    pallet,
    grippers,
    palletStations,
    selectedGripperId:
      input.selectedGripperId !== undefined
        ? input.selectedGripperId
        : (grippers.find(({ isDefault }) => isDefault)?.id ?? null),
    selectedPalletStationId:
      input.selectedPalletStationId !== undefined
        ? input.selectedPalletStationId
        : (palletStations.find(({ isDefault }) => isDefault)?.id ?? null),
    solutions,
    activeSolutionId:
      input.activeSolutionId !== undefined
        ? input.activeSolutionId
        : solutions.length === 1
          ? solutions[0]!.id
          : null,
  });
}

/** Compatibility factory for code that still needs the exact ProjectV2 shape. */
export function createProjectV2(
  input: CreateProjectInput = {},
  factoryDependencies: ProjectFactoryDependencies = {},
): ProjectV2 {
  return projectToProjectV2(
    createProject(
      {
        ...input,
        grippers: input.grippers ?? [],
        palletStations: input.palletStations ?? [],
      },
      factoryDependencies,
    ),
  );
}

export type ProjectUpdate = Partial<
  Omit<Project, "schemaVersion" | "id" | "createdAt" | "updatedAt">
>;

export function updateProject(
  projectInput: Project | ProjectV2,
  update: ProjectUpdate | ((project: Project) => Project),
  factoryDependencies: ProjectFactoryDependencies = {},
): Project {
  const current = migrateProject(projectInput);
  const candidate =
    typeof update === "function"
      ? update(projectSchema.parse(current))
      : { ...current, ...update };
  const updatedAt = Math.max(
    current.updatedAt,
    dependencies(factoryDependencies).now(),
  );

  return projectSchema.parse({
    ...candidate,
    schemaVersion: current.schemaVersion,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt,
  });
}

export type DuplicateProjectInput = {
  id?: string;
  projectNumber?: string;
  productNumber?: string;
};

export function duplicateProjectModel(
  projectInput: Project | ProjectV2,
  input: DuplicateProjectInput = {},
  factoryDependencies: ProjectFactoryDependencies = {},
): Project {
  const project = migrateProject(projectInput);
  const deps = dependencies(factoryDependencies);
  const timestamp = deps.now();
  return projectSchema.parse({
    ...project,
    id: input.id ?? deps.createId("project"),
    projectNumber: input.projectNumber ?? project.projectNumber,
    productNumber: input.productNumber ?? project.productNumber,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
