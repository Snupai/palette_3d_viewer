import { z } from "zod";
import { gripsToBoxes } from "~/domain/palletGeometry";
import {
  CURRENT_PROJECT_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION,
  projectSchema,
  projectV2Schema,
  type PackagePlacement,
  type PlanningSolution,
  type Project,
  type ProjectV2,
  type RobotCycle,
} from "~/domain/project/projectSchema";

export type ProjectParseDiagnostic = {
  code: "invalid-project" | "unsupported-project-version";
  message: string;
  path: (string | number)[];
  schemaVersion: number | null;
};

export class UnsupportedProjectVersionError extends Error {
  readonly schemaVersion: number | null;

  constructor(schemaVersion: number | null) {
    super(
      schemaVersion === null
        ? "Project schemaVersion is missing or invalid."
        : `Unsupported project schema version ${schemaVersion}.`,
    );
    this.name = "UnsupportedProjectVersionError";
    this.schemaVersion = schemaVersion;
  }
}

function schemaVersionOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === "number" && Number.isInteger(version)
    ? version
    : null;
}

function placementsAndCycles(
  project: ProjectV2,
  pattern: ProjectV2["solutions"][number]["patterns"][number],
  patternIndex: number,
): { placements: PackagePlacement[]; cycles: RobotCycle[] } {
  const packageWidth = project.package.dimensionsMm.length;
  const packageLength = project.package.dimensionsMm.width;
  const packageHeight = project.package.dimensionsMm.height;
  const inputDirection =
    project.package.inletOrientation === "crosswise" ? 1 : 0;
  const boxes = gripsToBoxes(
    pattern.grips,
    packageWidth,
    packageLength,
    packageHeight,
    inputDirection,
  );

  const placements = boxes.map((box, placementIndex) => {
    const grip = pattern.grips[box.blueNumber - 1];
    if (!grip) {
      throw new Error(
        `Unable to migrate pattern "${pattern.id}": placement has no source grip.`,
      );
    }
    return {
      id: `placement-${patternIndex + 1}-${placementIndex + 1}`,
      sequence: placementIndex,
      positionMm: { x: box.rect.x, y: box.rect.y },
      rotation: box.rotation,
      gripId: grip.id,
      labelSide: box.blueLine,
    } satisfies PackagePlacement;
  });

  const placementsByGrip = new Map<string, string[]>();
  placements.forEach((placement) => {
    if (placement.gripId === null) return;
    const ids = placementsByGrip.get(placement.gripId) ?? [];
    ids.push(placement.id);
    placementsByGrip.set(placement.gripId, ids);
  });

  const cycles = pattern.grips.map((grip, gripIndex) => ({
    id: `cycle-${patternIndex + 1}-${gripIndex + 1}`,
    patternId: pattern.id,
    sequence: gripIndex,
    gripId: grip.id,
    placementIds: placementsByGrip.get(grip.id) ?? [],
    gripperId: project.selectedGripperId,
    pickPose: {
      x: grip.pickX,
      y: grip.pickY,
      z: null,
      rotation: grip.pickRotation,
    },
    placePose: {
      x: grip.x,
      y: grip.y,
      z: null,
      rotation: grip.rotation,
    },
    labelOffset: { x: grip.dx, y: grip.dy },
  })) satisfies RobotCycle[];

  return { placements, cycles };
}

function gripsWithDeterministicGroupNumbers<
  Grip extends { groupNumber?: number },
>(grips: readonly Grip[]): (Grip & { groupNumber: number })[] {
  const used = new Set(
    grips.flatMap(({ groupNumber }) =>
      groupNumber === undefined ? [] : [groupNumber],
    ),
  );
  let nextAvailable = 1;

  return grips.map((grip) => {
    if (grip.groupNumber !== undefined) {
      return { ...grip, groupNumber: grip.groupNumber };
    }
    while (used.has(nextAvailable)) nextAvailable += 1;
    const groupNumber = nextAvailable;
    used.add(groupNumber);
    nextAvailable += 1;
    return { ...grip, groupNumber };
  });
}

/** Deterministically adds first-class placements and cycles to a ProjectV2. */
export function migrateProjectV2(projectInput: ProjectV2): Project {
  const project = projectV2Schema.parse(projectInput);
  const solutions = project.solutions.map((solution) => {
    const migratedPatterns = solution.patterns.map((pattern, patternIndex) => {
      const { placements } = placementsAndCycles(
        project,
        pattern,
        patternIndex,
      );
      return {
        ...pattern,
        grips: gripsWithDeterministicGroupNumbers(pattern.grips),
        placements,
      };
    });
    const robotCycles = solution.patterns.flatMap(
      (pattern, patternIndex) =>
        placementsAndCycles(project, pattern, patternIndex).cycles,
    );
    return {
      ...solution,
      patterns: migratedPatterns,
      robotCycles,
    } satisfies PlanningSolution;
  });

  return projectSchema.parse({
    ...project,
    schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    solutions,
  });
}

/**
 * Dispatches only declared project versions. Unknown versions are never guessed
 * or coerced into the current schema.
 */
export function migrateProject(value: unknown): Project {
  const schemaVersion = schemaVersionOf(value);
  if (schemaVersion === PROJECT_SCHEMA_VERSION) {
    return migrateProjectV2(projectV2Schema.parse(value));
  }
  if (schemaVersion === CURRENT_PROJECT_SCHEMA_VERSION) {
    return projectSchema.parse(value);
  }
  throw new UnsupportedProjectVersionError(schemaVersion);
}

export function safeMigrateProject(value: unknown):
  | { success: true; project: Project; migrated: boolean; diagnostics: [] }
  | {
      success: false;
      project: null;
      migrated: false;
      diagnostics: ProjectParseDiagnostic[];
    } {
  const schemaVersion = schemaVersionOf(value);
  try {
    return {
      success: true,
      project: migrateProject(value),
      migrated: schemaVersion === PROJECT_SCHEMA_VERSION,
      diagnostics: [],
    };
  } catch (cause) {
    if (cause instanceof UnsupportedProjectVersionError) {
      return {
        success: false,
        project: null,
        migrated: false,
        diagnostics: [
          {
            code: "unsupported-project-version",
            message: cause.message,
            path: ["schemaVersion"],
            schemaVersion: cause.schemaVersion,
          },
        ],
      };
    }
    if (cause instanceof z.ZodError) {
      return {
        success: false,
        project: null,
        migrated: false,
        diagnostics: cause.issues.map((issue) => ({
          code: "invalid-project" as const,
          message: issue.message,
          path: issue.path,
          schemaVersion,
        })),
      };
    }
    return {
      success: false,
      project: null,
      migrated: false,
      diagnostics: [
        {
          code: "invalid-project",
          message:
            cause instanceof Error
              ? cause.message
              : "Project migration failed.",
          path: [],
          schemaVersion,
        },
      ],
    };
  }
}

/** Compatibility projection for consumers that still speak ProjectV2. */
export function projectToProjectV2(value: unknown): ProjectV2 {
  const project = migrateProject(value);
  return projectV2Schema.parse({
    ...project,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    solutions: project.solutions.map(
      ({ robotCycles: _cycles, ...solution }) => ({
        ...solution,
        patterns: solution.patterns.map(
          ({ placements: _placements, ...pattern }) => pattern,
        ),
        stack: {
          interlayerThicknessMm: solution.stack.interlayerThicknessMm,
          layers: solution.stack.layers.map(
            ({ interlayerThicknessMm: _thickness, ...layer }) => layer,
          ),
          trailingInterlayer: solution.stack.trailingInterlayer,
        },
      }),
    ),
  });
}
