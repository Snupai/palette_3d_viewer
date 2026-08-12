import { z } from "zod";
import type { SavedPallet } from "~/lib/palletTypes";
import { parseRobText } from "~/lib/robParser";

export const CURRENT_PALLET_SCHEMA_VERSION = 1 as const;

const finiteNumber = z.number().finite();
const positiveDimension = finiteNumber.positive();
const rotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
const blueLineSchema = z
  .enum([
    "top",
    "right",
    "bottom",
    "left",
    "top_right",
    "bottom_right",
    "bottom_left",
    "top_left",
  ])
  .nullable();

export const rectangleSchema = z.object({
  width: positiveDimension,
  length: positiveDimension,
  x: finiteNumber,
  y: finiteNumber,
});

export const boxSchema = z.object({
  blueNumber: z.number().int().positive(),
  blueLine: blueLineSchema,
  rotation: rotationSchema,
  rect: rectangleSchema,
  height: positiveDimension,
  placeX: finiteNumber,
  placeY: finiteNumber,
  numPackages: z.number().int().positive(),
});

export const gripSchema = z.object({
  id: z.string().min(1),
  pickX: finiteNumber,
  pickY: finiteNumber,
  pickRotation: rotationSchema,
  x: finiteNumber,
  y: finiteNumber,
  rotation: rotationSchema,
  numPackages: z.number().int().positive(),
  dx: finiteNumber,
  dy: finiteNumber,
  rawLead: z.tuple([finiteNumber, finiteNumber, finiteNumber]).optional(),
});

const planarDimensionsSchema = z.object({
  width: positiveDimension,
  length: positiveDimension,
});

export const layerSchema = z
  .object({
    unique_layer_id: z.number().int().positive(),
    boxes: z.array(boxSchema),
    zwischenlage: z.number().int().nonnegative(),
    interlayerThicknessesMm: z.array(positiveDimension).optional(),
    interlayerDimensions: planarDimensionsSchema.optional(),
  })
  .superRefine((layer, context) => {
    if (
      layer.interlayerThicknessesMm !== undefined &&
      layer.interlayerThicknessesMm.length !== layer.zwischenlage
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["interlayerThicknessesMm"],
        message: "must contain one thickness for each interlayer sheet",
      });
    }
  });

const dimensionsSchema = planarDimensionsSchema.extend({
  height: positiveDimension,
});

const plannerLayerPreviewMetadataSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  patternRef: z.string().min(1),
  candidateId: z.string().min(1).nullable(),
  isSpecialTop: z.boolean(),
});

const plannerPreviewMetadataSchema = z.object({
  projectId: z.string().min(1).nullable(),
  solutionId: z.string().min(1).nullable(),
  layers: z.array(plannerLayerPreviewMetadataSchema),
  metrics: z.object({
    packageCount: z.number().int().nonnegative(),
    cycleCount: z.number().int().nonnegative().nullable(),
    loadStackHeightMm: finiteNumber.nonnegative(),
    areaUtilizationPercent: finiteNumber.nullable(),
    volumeUtilizationPercent: finiteNumber.nullable(),
    grossWeightKg: finiteNumber.nonnegative().nullable(),
  }),
  warningCodes: z.array(z.string().min(1)),
});

export const palletDataSchema = z
  .object({
    layers: z.array(layerSchema),
    uniqueLayers: z.record(z.string().regex(/^[1-9]\d*$/), z.array(gripSchema)),
    layer_count: z.number().int().nonnegative(),
    total_boxes: z.number().int().nonnegative(),
    package: dimensionsSchema,
    pallet: dimensionsSchema.nullable(),
    interlayer: planarDimensionsSchema.nullable().optional(),
    planner: plannerPreviewMetadataSchema.optional(),
    inputDirection: z.union([z.literal(0), z.literal(1)]),
    inputDirectionExplicit: z.boolean().optional(),
    trailingZwischenlage: z.number().int().nonnegative().optional(),
    trailingInterlayerThicknessesMm: z.array(positiveDimension).optional(),
    trailingInterlayerDimensions: planarDimensionsSchema.optional(),
  })
  .superRefine((data, context) => {
    if (data.layer_count !== data.layers.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layer_count"],
        message: "does not match the number of layers",
      });
    }
    const totalBoxes = data.layers.reduce(
      (total, layer) => total + layer.boxes.length,
      0,
    );
    if (data.total_boxes !== totalBoxes) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["total_boxes"],
        message: "does not match the number of boxes",
      });
    }
    if (
      data.trailingInterlayerThicknessesMm !== undefined &&
      data.trailingInterlayerThicknessesMm.length !==
        (data.trailingZwischenlage ?? 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trailingInterlayerThicknessesMm"],
        message:
          "must contain one thickness for each trailing interlayer sheet",
      });
    }
    data.layers.forEach((layer, index) => {
      if (!data.uniqueLayers[String(layer.unique_layer_id)]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["layers", index, "unique_layer_id"],
          message: "references a missing unique layer",
        });
      }
    });
  });

const savedPalletFields = {
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: finiteNumber,
  data: palletDataSchema,
  rawText: z.string().optional(),
  originalRawText: z.string().optional(),
};

export const savedPalletSchema = z.object({
  schemaVersion: z.literal(CURRENT_PALLET_SCHEMA_VERSION),
  ...savedPalletFields,
});

const legacySavedPalletSchema = z.object({
  schemaVersion: z.undefined().optional(),
  ...savedPalletFields,
});

const recoverablePalletEnvelopeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: finiteNumber,
  data: z.unknown().optional(),
  rawText: z.string().min(1).optional(),
  originalRawText: z.string().optional(),
});

export type PalletStorageIssue = {
  id: string | null;
  name: string | null;
  reason: string;
};

export type PalletStorageLoadResult = {
  pallets: SavedPallet[];
  repaired: SavedPallet[];
  issues: PalletStorageIssue[];
};

type NormalizedPallet =
  | { pallet: SavedPallet; repaired: boolean }
  | { issue: PalletStorageIssue };

function savedPallet(value: z.infer<typeof savedPalletSchema>): SavedPallet {
  return value as SavedPallet;
}

function issueFor(value: unknown, reason: string): PalletStorageIssue {
  const envelope = recoverablePalletEnvelopeSchema.safeParse(value);
  return {
    id: envelope.success ? envelope.data.id : null,
    name: envelope.success ? envelope.data.name : null,
    reason,
  };
}

export function normalizeStoredPallet(value: unknown): NormalizedPallet {
  const current = savedPalletSchema.safeParse(value);
  if (current.success) {
    return { pallet: savedPallet(current.data), repaired: false };
  }

  const legacy = legacySavedPalletSchema.safeParse(value);
  if (legacy.success) {
    return {
      pallet: savedPallet({
        ...legacy.data,
        schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
      }),
      repaired: true,
    };
  }

  const envelope = recoverablePalletEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return {
      issue: issueFor(value, "record metadata is incomplete or invalid"),
    };
  }
  if (!envelope.data.rawText) {
    return {
      issue: issueFor(
        value,
        "persisted pallet data is invalid and no raw .rob text is available",
      ),
    };
  }

  try {
    const data = parseRobText(envelope.data.rawText);
    return {
      pallet: {
        schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
        id: envelope.data.id,
        name: envelope.data.name,
        createdAt: envelope.data.createdAt,
        data,
        rawText: envelope.data.rawText,
        originalRawText: envelope.data.originalRawText ?? envelope.data.rawText,
      },
      repaired: true,
    };
  } catch (cause) {
    const reason =
      cause instanceof Error ? cause.message : "the raw .rob text is invalid";
    return {
      issue: issueFor(value, `raw .rob recovery failed: ${reason}`),
    };
  }
}

export function validateStoredPallets(
  values: readonly unknown[],
): PalletStorageLoadResult {
  const pallets: SavedPallet[] = [];
  const repaired: SavedPallet[] = [];
  const issues: PalletStorageIssue[] = [];

  values.forEach((value) => {
    const result = normalizeStoredPallet(value);
    if ("issue" in result) {
      issues.push(result.issue);
      return;
    }
    pallets.push(result.pallet);
    if (result.repaired) repaired.push(result.pallet);
  });

  return { pallets, repaired, issues };
}

export function parseLegacyPalletJson(
  raw: string,
): PalletStorageLoadResult & { parsed: boolean } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {
      parsed: false,
      pallets: [],
      repaired: [],
      issues: [
        {
          id: null,
          name: null,
          reason: "legacy storage contains invalid JSON",
        },
      ],
    };
  }
  if (!Array.isArray(value)) {
    return {
      parsed: false,
      pallets: [],
      repaired: [],
      issues: [
        { id: null, name: null, reason: "legacy storage is not a pallet list" },
      ],
    };
  }

  return { parsed: true, ...validateStoredPallets(value) };
}

export function formatPalletStorageIssues(
  issues: readonly PalletStorageIssue[],
): string | null {
  if (issues.length === 0) return null;
  const entries = issues.map(
    (issue) =>
      `${issue.name ? `“${issue.name}”` : "an unnamed entry"}: ${issue.reason}`,
  );
  return `Skipped ${issues.length} saved pallet${issues.length === 1 ? "" : "s"} because the stored data could not be recovered. ${entries.join("; ")}`;
}
