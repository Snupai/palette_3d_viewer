import { safeMigrateProject } from "~/domain/project/projectMigration";
import { normalizeYawDeg } from "~/domain/robotics/frames";
import { materializeRobotCycles } from "~/domain/robotics/materialize";
import type {
  RobotCycle,
  RobotCycleMaterialization,
  RobotCycleMaterializationOptions,
  RobotDiagnostic,
} from "~/domain/robotics/types";
import { gripsToBoxes } from "~/domain/palletGeometry";
import type { Grip, PalletData } from "~/domain/palletTypes";
import { parseRobText, serializeRobText } from "~/lib/robParser";

export type RobIntegerQuantizationPolicy =
  | { mode: "reject-decimals" }
  | { mode: "truncate-toward-zero" }
  | { mode: "round-half-away-from-zero" };

export type RobSignConvention = {
  id: string;
  xSign: 1 | -1;
  ySign: 1 | -1;
  yawSign: 1 | -1;
  yawOffsetDeg: number;
  provenance: {
    status:
      | "verified"
      | "repository-behavior"
      | "project-defined"
      | "unverified";
    source: string;
  };
};

export type RobUnknownFieldPolicy =
  | { mode: "reject" }
  | { mode: "preserve-imported" }
  | { mode: "from-cycle-or-zero" }
  | {
      mode: "explicit-values";
      semantics: string;
      provenance: string;
      valuesByCycleId: Readonly<
        Record<string, { field8: number; field9: number } | undefined>
      >;
    };

export type RobExportOptions = {
  quantization?: RobIntegerQuantizationPolicy;
  signConvention?: RobSignConvention;
  unknownFields?: RobUnknownFieldPolicy;
  interlayerThicknessPolicy?: "require-3mm" | "allow-count-only";
  newline?: "\n" | "\r\n";
  separator?: " " | "\t";
};

export type RobExportManifest = {
  source: "project-derived-robot-cycles";
  projectId: string;
  solutionId: string;
  cycleIds: readonly string[];
  quantization: RobIntegerQuantizationPolicy;
  signConvention: RobSignConvention;
  unknownFieldPolicy: RobUnknownFieldPolicy["mode"];
  coordinateFrames: readonly string[];
  parserRoundtrip: "pending" | "verified" | "failed";
};

export type RobExportPreflight = {
  kind: "project-derived-rob-preflight";
  ok: boolean;
  data: PalletData | null;
  diagnostics: readonly RobotDiagnostic[];
  manifest: RobExportManifest | null;
};

export type ProjectRobExportResult = {
  kind: "project-derived-rob-export";
  ok: boolean;
  text: string | null;
  data: PalletData | null;
  diagnostics: readonly RobotDiagnostic[];
  manifest: RobExportManifest | null;
  parserRoundtripVerified: boolean;
};

export type RetainedRawRobDownload = {
  kind: "retained-raw-rob-import";
  variant: "original" | "edited";
  fileName: string;
  text: string;
  sourceField: "originalRawText" | "rawRobText";
  verification: "verbatim-retained-import";
};

function quantized(
  value: number,
  policy: RobIntegerQuantizationPolicy,
  field: string,
  diagnostics: RobotDiagnostic[],
  cycle?: RobotCycle,
): number {
  if (!Number.isFinite(value)) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "non-integer-value",
      message: `${field} must be finite before .rob export.`,
      cycleId: cycle?.id,
      layerId: cycle?.physicalLayerId,
      details: { field, value: String(value) },
    });
    return 0;
  }
  if (policy.mode === "reject-decimals") {
    if (!Number.isInteger(value)) {
      diagnostics.push({
        severity: "error",
        phase: "export",
        code: "non-integer-value",
        message: `${field} is ${value}; the selected .rob quantization policy rejects decimals.`,
        cycleId: cycle?.id,
        layerId: cycle?.physicalLayerId,
        details: { field, value },
      });
    }
    return Object.is(value, -0) ? 0 : value;
  }
  const result =
    policy.mode === "truncate-toward-zero"
      ? Math.trunc(value)
      : value < 0
        ? -Math.round(Math.abs(value))
        : Math.round(value);
  return Object.is(result, -0) ? 0 : result;
}

function exportedYaw(
  yawDeg: number,
  convention: RobSignConvention,
  diagnostics: RobotDiagnostic[],
  field: string,
  cycle: RobotCycle,
): 0 | 90 | 180 | 270 {
  const transformed = normalizeYawDeg(
    yawDeg * convention.yawSign + convention.yawOffsetDeg,
  );
  const nearest = Math.round(transformed / 90) * 90;
  const normalizedNearest = normalizeYawDeg(nearest);
  if (Math.abs(transformed - normalizedNearest) > 1e-9) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "invalid-orthogonal-yaw",
      message: `${field} becomes ${transformed}° under sign convention "${convention.id}"; .rob supports only 0/90/180/270.`,
      cycleId: cycle.id,
      layerId: cycle.physicalLayerId,
      details: { field, yawDeg: transformed },
    });
    return 0;
  }
  return normalizedNearest as 0 | 90 | 180 | 270;
}

function unknownFieldsForCycle(
  cycle: RobotCycle,
  policy: RobUnknownFieldPolicy,
  quantization: RobIntegerQuantizationPolicy,
  diagnostics: RobotDiagnostic[],
): { field8: number; field9: number } {
  if (policy.mode === "reject") {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "unknown-legacy-field-semantics",
      message: `Cycle "${cycle.id}" cannot be exported until the last two .rob fields are explicitly preserved or supplied by policy.`,
      cycleId: cycle.id,
      layerId: cycle.physicalLayerId,
    });
    return { field8: 0, field9: 0 };
  }
  if (policy.mode === "preserve-imported") {
    if (!cycle.legacyUnknownFields) {
      diagnostics.push({
        severity: "error",
        phase: "export",
        code: "missing-explicit-legacy-fields",
        message: `Cycle "${cycle.id}" has no imported last-field values to preserve.`,
        cycleId: cycle.id,
        layerId: cycle.physicalLayerId,
      });
      return { field8: 0, field9: 0 };
    }
    return {
      field8: quantized(
        cycle.legacyUnknownFields.field8,
        quantization,
        `${cycle.id}.field8`,
        diagnostics,
        cycle,
      ),
      field9: quantized(
        cycle.legacyUnknownFields.field9,
        quantization,
        `${cycle.id}.field9`,
        diagnostics,
        cycle,
      ),
    };
  }
  if (policy.mode === "from-cycle-or-zero") {
    if (!cycle.legacyUnknownFields) return { field8: 0, field9: 0 };
    return {
      field8: quantized(
        cycle.legacyUnknownFields.field8,
        quantization,
        `${cycle.id}.field8`,
        diagnostics,
        cycle,
      ),
      field9: quantized(
        cycle.legacyUnknownFields.field9,
        quantization,
        `${cycle.id}.field9`,
        diagnostics,
        cycle,
      ),
    };
  }

  const supplied = policy.valuesByCycleId[cycle.id];
  if (
    !supplied ||
    policy.semantics.trim() === "" ||
    policy.provenance.trim() === ""
  ) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "missing-explicit-legacy-fields",
      message: `Cycle "${cycle.id}" requires caller-supplied field8/field9 values plus non-empty semantics and provenance.`,
      cycleId: cycle.id,
      layerId: cycle.physicalLayerId,
    });
    return { field8: 0, field9: 0 };
  }
  return {
    field8: quantized(
      supplied.field8,
      quantization,
      `${cycle.id}.field8`,
      diagnostics,
      cycle,
    ),
    field9: quantized(
      supplied.field9,
      quantization,
      `${cycle.id}.field9`,
      diagnostics,
      cycle,
    ),
  };
}

function gripForCycle(
  cycle: RobotCycle,
  quantization: RobIntegerQuantizationPolicy,
  convention: RobSignConvention,
  unknownPolicy: RobUnknownFieldPolicy,
  diagnostics: RobotDiagnostic[],
): Grip {
  const unknown = unknownFieldsForCycle(
    cycle,
    unknownPolicy,
    quantization,
    diagnostics,
  );
  return {
    id: cycle.id,
    pickX: quantized(
      cycle.pickPose.positionMm.x * convention.xSign,
      quantization,
      `${cycle.id}.pickX`,
      diagnostics,
      cycle,
    ),
    pickY: quantized(
      cycle.pickPose.positionMm.y * convention.ySign,
      quantization,
      `${cycle.id}.pickY`,
      diagnostics,
      cycle,
    ),
    pickRotation: exportedYaw(
      cycle.pickPose.yawDeg,
      convention,
      diagnostics,
      `${cycle.id}.pickYaw`,
      cycle,
    ),
    x: quantized(
      cycle.placePose.positionMm.x * convention.xSign,
      quantization,
      `${cycle.id}.placeX`,
      diagnostics,
      cycle,
    ),
    y: quantized(
      cycle.placePose.positionMm.y * convention.ySign,
      quantization,
      `${cycle.id}.placeY`,
      diagnostics,
      cycle,
    ),
    rotation: exportedYaw(
      cycle.placePose.yawDeg,
      convention,
      diagnostics,
      `${cycle.id}.placeYaw`,
      cycle,
    ),
    numPackages: cycle.packageCount,
    dx: unknown.field8,
    dy: unknown.field9,
  };
}

function gripFingerprint(grips: readonly Grip[]): string {
  return JSON.stringify(
    grips.map(
      ({ pickX, pickY, pickRotation, x, y, rotation, numPackages, dx, dy }) => [
        pickX,
        pickY,
        pickRotation,
        x,
        y,
        rotation,
        numPackages,
        dx,
        dy,
      ],
    ),
  );
}

function semanticFingerprint(data: PalletData): string {
  return JSON.stringify({
    pallet: data.pallet,
    package: data.package,
    inputDirection: data.inputDirection,
    inputDirectionExplicit: data.inputDirectionExplicit ?? false,
    trailingZwischenlage: data.trailingZwischenlage ?? 0,
    layers: data.layers.map(({ unique_layer_id, zwischenlage }) => ({
      unique_layer_id,
      zwischenlage,
    })),
    uniqueLayers: Object.entries(data.uniqueLayers)
      .map(([id, grips]) => ({
        id: Number(id),
        fingerprint: gripFingerprint(grips),
      }))
      .sort((left, right) => left.id - right.id),
  });
}

function coordinateFramesForCycles(cycles: readonly RobotCycle[]): string[] {
  return [
    ...new Set(
      cycles.flatMap((cycle) => [
        cycle.pickPose.frame,
        cycle.transferPose.frame,
        cycle.placePose.frame,
      ]),
    ),
  ];
}

function duplicateCycleIds(cycles: readonly RobotCycle[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const cycle of cycles) {
    if (seen.has(cycle.id)) duplicates.add(cycle.id);
    else seen.add(cycle.id);
  }
  return [...duplicates];
}

function buildPalletData(
  materialization: RobotCycleMaterialization,
  quantization: RobIntegerQuantizationPolicy,
  convention: RobSignConvention,
  unknownPolicy: RobUnknownFieldPolicy,
  diagnostics: RobotDiagnostic[],
): PalletData | null {
  const project = materialization.project;
  const stack = materialization.stack;
  if (!project || !stack || !project.pallet) return null;

  const packageWidth = quantized(
    project.package.dimensionsMm.length,
    quantization,
    "package.lengthMm",
    diagnostics,
  );
  const packageLength = quantized(
    project.package.dimensionsMm.width,
    quantization,
    "package.widthMm",
    diagnostics,
  );
  const packageHeight = quantized(
    project.package.dimensionsMm.height,
    quantization,
    "package.heightMm",
    diagnostics,
  );
  const pallet = {
    width: quantized(
      project.pallet.dimensionsMm.length,
      quantization,
      "pallet.lengthMm",
      diagnostics,
    ),
    length: quantized(
      project.pallet.dimensionsMm.width,
      quantization,
      "pallet.widthMm",
      diagnostics,
    ),
    height: quantized(
      project.pallet.dimensionsMm.height,
      quantization,
      "pallet.heightMm",
      diagnostics,
    ),
  };
  const inputDirection =
    project.package.inletOrientation === "crosswise" ? 1 : 0;
  const uniqueIdByFingerprint = new Map<string, number>();
  const uniqueLayers: Record<number, Grip[]> = {};
  const layers = materialization.layers
    .slice()
    .sort((left, right) => left.physicalLayerIndex - right.physicalLayerIndex)
    .map((layer) => {
      const layerCycles = layer.cycleIds.flatMap((cycleId) => {
        const cycle = materialization.cycles.find(({ id }) => id === cycleId);
        return cycle ? [cycle] : [];
      });
      const grips = layerCycles.map((cycle) =>
        gripForCycle(
          cycle,
          quantization,
          convention,
          unknownPolicy,
          diagnostics,
        ),
      );
      const fingerprint = gripFingerprint(grips);
      let uniqueLayerId = uniqueIdByFingerprint.get(fingerprint);
      if (uniqueLayerId === undefined) {
        uniqueLayerId = uniqueIdByFingerprint.size + 1;
        uniqueIdByFingerprint.set(fingerprint, uniqueLayerId);
        uniqueLayers[uniqueLayerId] = grips;
      }
      return {
        unique_layer_id: uniqueLayerId,
        boxes: gripsToBoxes(
          grips,
          packageWidth,
          packageLength,
          packageHeight,
          inputDirection,
        ),
        zwischenlage: layer.interlayerBeforeCount,
      };
    });

  return {
    layers,
    uniqueLayers,
    layer_count: layers.length,
    total_boxes: layers.reduce((total, layer) => total + layer.boxes.length, 0),
    package: {
      width: packageWidth,
      length: packageLength,
      height: packageHeight,
    },
    pallet,
    inputDirection,
    inputDirectionExplicit: true,
    trailingZwischenlage: stack.sheets.filter(
      ({ role }) => role === "deck-sheet",
    ).length,
  };
}

export function preflightProjectRobExport(
  materialization: RobotCycleMaterialization,
  options: RobExportOptions = {},
): RobExportPreflight {
  const diagnostics: RobotDiagnostic[] = [...materialization.diagnostics];
  const coordinateFrames = coordinateFramesForCycles(materialization.cycles);
  const repeatedCycleIds = duplicateCycleIds(materialization.cycles);
  const generatedCyclesWithoutTrustedPickReference =
    materialization.cycles.filter((cycle) => {
      if (cycle.provenance.cycleSource !== "calculated-suction-cycle") {
        return false;
      }
      const status = cycle.provenance.pickReferenceProvenance?.status;
      return status !== "verified" && status !== "derived";
    });
  if (!materialization.project || !materialization.stack) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "materialization-invalid",
      message: "A project-backed robot-cycle materialization is required.",
    });
  }
  if (!materialization.project?.pallet) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "missing-pallet",
      message: "A pallet is required for project-derived .rob export.",
    });
  }
  if (!materialization.valid) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "materialization-invalid",
      message:
        "Robot-cycle materialization contains blocking diagnostics; resolve them before export.",
    });
  }
  if (materialization.cycles.length === 0) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "empty-robot-plan",
      message: "An empty project has no robot cycles to export.",
    });
  }
  if (!options.quantization) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "missing-quantization-policy",
      message:
        "Select an explicit integer quantization policy for .rob export.",
    });
  }
  if (!options.signConvention) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "missing-sign-convention",
      message: "Provide an explicit, provenance-labelled .rob sign convention.",
    });
  }
  if (!options.unknownFields) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "unknown-legacy-field-semantics",
      message:
        "Choose an explicit policy for the final two .rob fields; no default semantics are invented.",
    });
  }
  if (
    generatedCyclesWithoutTrustedPickReference.length > 0 &&
    !diagnostics.some(
      ({ code }) =>
        code === "missing-pick-reference" ||
        code === "unverified-pick-reference",
    )
  ) {
    const firstCycle = generatedCyclesWithoutTrustedPickReference[0]!;
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "unverified-pick-reference",
      message:
        "Generated robot cycles require verified or derived pick-reference provenance before .rob export.",
      cycleId: firstCycle.id,
      layerId: firstCycle.physicalLayerId,
      details: {
        cycleCount: generatedCyclesWithoutTrustedPickReference.length,
        provenanceStatuses: [
          ...new Set(
            generatedCyclesWithoutTrustedPickReference.map(
              (cycle) =>
                cycle.provenance.pickReferenceProvenance?.status ?? "missing",
            ),
          ),
        ].join(", "),
      },
    });
  }
  if (
    repeatedCycleIds.length > 0 &&
    !diagnostics.some(({ code }) => code === "duplicate-cycle-id")
  ) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "duplicate-cycle-id",
      message:
        "Robot cycle ids must be unique before .rob export; duplicate ids make layer references ambiguous.",
      cycleId: repeatedCycleIds[0],
      details: { cycleIds: repeatedCycleIds.join(", ") },
    });
  }
  if (coordinateFrames.length > 1) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "mixed-coordinate-frames",
      message: `Robot cycles use incompatible coordinate frames (${coordinateFrames.join(", ")}); one .rob sign convention cannot map them safely.`,
      details: {
        coordinateFrames: coordinateFrames.join(", "),
        signConventionId: options.signConvention?.id ?? null,
      },
    });
  }

  const nonstandardSheets =
    materialization.stack?.sheets.filter(
      ({ thicknessMm }) => Math.abs(thicknessMm - 3) > 1e-9,
    ) ?? [];
  if (nonstandardSheets.length > 0) {
    diagnostics.push({
      severity:
        (options.interlayerThicknessPolicy ?? "require-3mm") ===
        "allow-count-only"
          ? "warning"
          : "error",
      phase: "export",
      code: "nonstandard-interlayer-thickness",
      message:
        ".rob stores interlayer counts but not per-sheet thickness; non-3 mm sheets require explicit count-only acceptance.",
      details: { sheetCount: nonstandardSheets.length },
    });
  }

  const quantization = options.quantization;
  const signConvention = options.signConvention;
  const unknownFields = options.unknownFields;
  const data =
    quantization &&
    signConvention &&
    unknownFields &&
    coordinateFrames.length <= 1 &&
    repeatedCycleIds.length === 0 &&
    generatedCyclesWithoutTrustedPickReference.length === 0
      ? buildPalletData(
          materialization,
          quantization,
          signConvention,
          unknownFields,
          diagnostics,
        )
      : null;
  const project = materialization.project;
  const manifest =
    project &&
    materialization.solutionId &&
    quantization &&
    signConvention &&
    unknownFields
      ? {
          source: "project-derived-robot-cycles" as const,
          projectId: project.id,
          solutionId: materialization.solutionId,
          cycleIds: materialization.cycles.map(({ id }) => id),
          quantization,
          signConvention,
          unknownFieldPolicy: unknownFields.mode,
          coordinateFrames,
          parserRoundtrip: "pending" as const,
        }
      : null;

  return {
    kind: "project-derived-rob-preflight",
    ok: !diagnostics.some(({ severity }) => severity === "error"),
    data,
    diagnostics,
    manifest,
  };
}

export function exportProjectRob(
  materialization: RobotCycleMaterialization,
  options: RobExportOptions = {},
): ProjectRobExportResult {
  const preflight = preflightProjectRobExport(materialization, options);
  if (!preflight.ok || !preflight.data || !preflight.manifest) {
    return {
      kind: "project-derived-rob-export",
      ok: false,
      text: null,
      data: preflight.data,
      diagnostics: preflight.diagnostics,
      manifest: preflight.manifest,
      parserRoundtripVerified: false,
    };
  }

  const diagnostics = [...preflight.diagnostics];
  const text = serializeRobText(preflight.data, {
    newline: options.newline,
    separator: options.separator,
  });
  let parserRoundtripVerified = false;
  try {
    const parsed = parseRobText(text);
    parserRoundtripVerified =
      semanticFingerprint(parsed) === semanticFingerprint(preflight.data);
    if (!parserRoundtripVerified) {
      diagnostics.push({
        severity: "error",
        phase: "export",
        code: "parser-roundtrip-failed",
        message:
          "Generated .rob text parsed successfully but did not preserve the preflight semantics.",
      });
    }
  } catch (cause) {
    diagnostics.push({
      severity: "error",
      phase: "export",
      code: "parser-roundtrip-failed",
      message:
        cause instanceof Error
          ? `Generated .rob parser verification failed: ${cause.message}`
          : "Generated .rob parser verification failed.",
    });
  }
  const ok =
    parserRoundtripVerified &&
    !diagnostics.some(({ severity }) => severity === "error");
  return {
    kind: "project-derived-rob-export",
    ok,
    text: ok ? text : null,
    data: preflight.data,
    diagnostics,
    manifest: {
      ...preflight.manifest,
      parserRoundtrip: parserRoundtripVerified ? "verified" : "failed",
    },
    parserRoundtripVerified,
  };
}

export function materializeAndExportProjectRob(
  projectInput: unknown,
  materializationOptions: RobotCycleMaterializationOptions,
  exportOptions: RobExportOptions,
): ProjectRobExportResult {
  return exportProjectRob(
    materializeRobotCycles(projectInput, materializationOptions),
    exportOptions,
  );
}

/** Returns retained source bytes only; it never invokes project-derived export. */
export function getRetainedRawRobDownload(
  projectInput: unknown,
  variant: "original" | "edited",
): RetainedRawRobDownload | null {
  const migrated = safeMigrateProject(projectInput);
  if (!migrated.success || migrated.project.source.kind !== "rob-import") {
    return null;
  }
  const source = migrated.project.source;
  const text =
    variant === "original" ? source.originalRawText : source.rawRobText;
  if (text === undefined) return null;
  return {
    kind: "retained-raw-rob-import",
    variant,
    fileName: source.fileName,
    text,
    sourceField: variant === "original" ? "originalRawText" : "rawRobText",
    verification: "verbatim-retained-import",
  };
}
