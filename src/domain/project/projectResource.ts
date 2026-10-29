import { z } from "zod";
import {
  gripperSchema,
  palletSpecSchema,
  palletStationSchema,
  projectIdSchema,
} from "~/domain/project/projectSchema";

export const PROJECT_RESOURCE_SCHEMA_VERSION = 1 as const;

const resourceFields = {
  schemaVersion: z.literal(PROJECT_RESOURCE_SCHEMA_VERSION),
  id: projectIdSchema,
  name: z.string().trim().min(1).max(200),
  createdAt: z.number().finite().nonnegative(),
  updatedAt: z.number().finite().nonnegative(),
};

export const projectResourceSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        ...resourceFields,
        kind: z.literal("pallet"),
        value: palletSpecSchema,
      })
      .strict(),
    z
      .object({
        ...resourceFields,
        kind: z.literal("gripper"),
        value: gripperSchema,
      })
      .strict(),
    z
      .object({
        ...resourceFields,
        kind: z.literal("pallet-station"),
        value: palletStationSchema,
      })
      .strict(),
  ])
  .superRefine((resource, context) => {
    if (resource.updatedAt < resource.createdAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedAt"],
        message: "must be greater than or equal to createdAt",
      });
    }
    if (resource.id !== resource.value.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value", "id"],
        message: "must match the resource id",
      });
    }
    if (resource.name !== resource.value.name) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value", "name"],
        message: "must match the resource name",
      });
    }
  });

export type ProjectResource = z.infer<typeof projectResourceSchema>;
export type ProjectResourceKind = ProjectResource["kind"];

export type ProjectResourceParseDiagnostic = {
  code: "invalid-resource" | "unsupported-resource-version";
  message: string;
  path: (string | number)[];
  schemaVersion: number | null;
};

function resourceSchemaVersion(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === "number" && Number.isInteger(version)
    ? version
    : null;
}

export function safeParseProjectResource(value: unknown):
  | {
      success: true;
      resource: ProjectResource;
      diagnostics: [];
    }
  | {
      success: false;
      resource: null;
      diagnostics: ProjectResourceParseDiagnostic[];
    } {
  const schemaVersion = resourceSchemaVersion(value);
  if (schemaVersion !== PROJECT_RESOURCE_SCHEMA_VERSION) {
    return {
      success: false,
      resource: null,
      diagnostics: [
        {
          code: "unsupported-resource-version",
          message:
            schemaVersion === null
              ? "Project resource schemaVersion is missing or invalid."
              : `Unsupported project resource version ${schemaVersion}.`,
          path: ["schemaVersion"],
          schemaVersion,
        },
      ],
    };
  }

  const parsed = projectResourceSchema.safeParse(value);
  if (parsed.success) {
    return { success: true, resource: parsed.data, diagnostics: [] };
  }
  return {
    success: false,
    resource: null,
    diagnostics: parsed.error.issues.map((issue) => ({
      code: "invalid-resource",
      message: issue.message,
      path: issue.path,
      schemaVersion,
    })),
  };
}

export type ResourceFactoryDependencies = {
  now?: () => number;
};

export function createProjectResource(
  input:
    | { kind: "pallet"; value: z.infer<typeof palletSpecSchema> }
    | { kind: "gripper"; value: z.infer<typeof gripperSchema> }
    | { kind: "pallet-station"; value: z.infer<typeof palletStationSchema> },
  dependencies: ResourceFactoryDependencies = {},
): ProjectResource {
  const timestamp = (dependencies.now ?? Date.now)();
  return projectResourceSchema.parse({
    schemaVersion: PROJECT_RESOURCE_SCHEMA_VERSION,
    id: input.value.id,
    name: input.value.name,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...input,
  });
}

export function updateProjectResource(
  resourceInput: ProjectResource,
  value: ProjectResource["value"],
  dependencies: ResourceFactoryDependencies = {},
): ProjectResource {
  const resource = projectResourceSchema.parse(resourceInput);
  if (
    resource.kind === "pallet" &&
    !palletSpecSchema.safeParse(value).success
  ) {
    throw new Error("A pallet resource can only be updated with a pallet.");
  }
  if (resource.kind === "gripper" && !gripperSchema.safeParse(value).success) {
    throw new Error("A gripper resource can only be updated with a gripper.");
  }
  if (
    resource.kind === "pallet-station" &&
    !palletStationSchema.safeParse(value).success
  ) {
    throw new Error(
      "A pallet-station resource can only be updated with a pallet station.",
    );
  }
  const timestamp = Math.max(
    resource.updatedAt,
    (dependencies.now ?? Date.now)(),
  );
  return projectResourceSchema.parse({
    ...resource,
    id: value.id,
    name: value.name,
    value,
    updatedAt: timestamp,
  });
}
