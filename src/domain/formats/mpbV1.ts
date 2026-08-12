import type { RobotDiagnostic } from "~/domain/robotics/types";

/**
 * Internal inspection envelope only. This is not claimed to be the proprietary
 * MultiPack binary signature. Real files with another signature are rejected.
 */
export const SYNTHETIC_MPB_V1_MAGIC = "MPB-SYN1";
export const SYNTHETIC_MPB_V1_HEADER_BYTES = 14;
export const DEFAULT_MPB_MAX_INPUT_BYTES = 1_048_576;

export type MpbV1KnownFields = {
  projectNumber?: string;
  productNumber?: string;
  package?: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    weightKg?: number | null;
  };
  pallet?: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
  };
  notes?: string;
};

export type MpbUnknownField = {
  path: string;
  value: unknown;
};

export type MpbV1Inspection = {
  format: "synthetic-mpb-v1-envelope";
  version: 1;
  verification: "unverified";
  writerSupported: false;
  knownFields: MpbV1KnownFields;
  unknownFields: readonly MpbUnknownField[];
  trailingByteCount: number;
  trailingBytesHex: string | null;
  diagnostics: readonly RobotDiagnostic[];
};

export type MpbInspectionResult =
  | {
      ok: true;
      inspection: MpbV1Inspection;
      diagnostics: readonly RobotDiagnostic[];
    }
  | { ok: false; inspection: null; diagnostics: readonly RobotDiagnostic[] };

function bytesFrom(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

function failure(
  code: RobotDiagnostic["code"],
  message: string,
  details?: RobotDiagnostic["details"],
): MpbInspectionResult {
  return {
    ok: false,
    inspection: null,
    diagnostics: [
      {
        severity: "error",
        phase: "legacy-import",
        code,
        message,
        details,
      },
    ],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string when present.`);
  }
  return value;
}

function collectUnknown(
  record: Record<string, unknown>,
  knownKeys: ReadonlySet<string>,
  prefix: string,
  unknownFields: MpbUnknownField[],
  diagnostics: RobotDiagnostic[],
): void {
  for (const [key, value] of Object.entries(record)) {
    if (knownKeys.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    unknownFields.push({ path, value });
    diagnostics.push({
      severity: "warning",
      phase: "legacy-import",
      code: "unknown-mpb-field",
      message: `Synthetic MPB v1 field "${path}" is not decoded and was preserved as unknown.`,
      path: path.split("."),
      details: { field: path },
    });
  }
}

function parseKnownFields(
  payload: unknown,
  unknownFields: MpbUnknownField[],
  diagnostics: RobotDiagnostic[],
): MpbV1KnownFields {
  if (!isRecord(payload)) {
    throw new Error("Synthetic MPB v1 payload must be a JSON object.");
  }
  collectUnknown(
    payload,
    new Set(["projectNumber", "productNumber", "package", "pallet", "notes"]),
    "",
    unknownFields,
    diagnostics,
  );
  const known: MpbV1KnownFields = {};
  const projectNumber = optionalString(payload.projectNumber, "projectNumber");
  const productNumber = optionalString(payload.productNumber, "productNumber");
  const notes = optionalString(payload.notes, "notes");
  if (projectNumber !== undefined) known.projectNumber = projectNumber;
  if (productNumber !== undefined) known.productNumber = productNumber;
  if (notes !== undefined) known.notes = notes;

  if (payload.package !== undefined) {
    if (!isRecord(payload.package)) {
      throw new Error("package must be an object when present.");
    }
    collectUnknown(
      payload.package,
      new Set(["lengthMm", "widthMm", "heightMm", "weightKg"]),
      "package",
      unknownFields,
      diagnostics,
    );
    if (
      !finitePositive(payload.package.lengthMm) ||
      !finitePositive(payload.package.widthMm) ||
      !finitePositive(payload.package.heightMm)
    ) {
      throw new Error(
        "package lengthMm, widthMm, and heightMm must be positive finite numbers.",
      );
    }
    const weight = payload.package.weightKg;
    if (
      weight !== undefined &&
      weight !== null &&
      (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0)
    ) {
      throw new Error("package.weightKg must be null or non-negative.");
    }
    known.package = {
      lengthMm: payload.package.lengthMm,
      widthMm: payload.package.widthMm,
      heightMm: payload.package.heightMm,
      ...(weight !== undefined ? { weightKg: weight } : {}),
    };
  }

  if (payload.pallet !== undefined) {
    if (!isRecord(payload.pallet)) {
      throw new Error("pallet must be an object when present.");
    }
    collectUnknown(
      payload.pallet,
      new Set(["lengthMm", "widthMm", "heightMm"]),
      "pallet",
      unknownFields,
      diagnostics,
    );
    if (
      !finitePositive(payload.pallet.lengthMm) ||
      !finitePositive(payload.pallet.widthMm) ||
      !finitePositive(payload.pallet.heightMm)
    ) {
      throw new Error(
        "pallet lengthMm, widthMm, and heightMm must be positive finite numbers.",
      );
    }
    known.pallet = {
      lengthMm: payload.pallet.lengthMm,
      widthMm: payload.pallet.widthMm,
      heightMm: payload.pallet.heightMm,
    };
  }
  return known;
}

function hexPrefix(bytes: Uint8Array, limit = 64): string {
  return [...bytes.slice(0, limit)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Safe, read-only boundary for the documented synthetic v1 envelope. It neither
 * recognizes arbitrary proprietary MPB files nor exposes a writer.
 */
export function inspectMpbV1Envelope(
  input: Uint8Array | ArrayBuffer,
  options: { maxInputBytes?: number } = {},
): MpbInspectionResult {
  const bytes = bytesFrom(input);
  const maxInputBytes = options.maxInputBytes ?? DEFAULT_MPB_MAX_INPUT_BYTES;
  if (!Number.isInteger(maxInputBytes) || maxInputBytes <= 0) {
    throw new Error("maxInputBytes must be a positive integer.");
  }
  if (bytes.byteLength > maxInputBytes) {
    return failure(
      "input-too-large",
      `MPB inspection input is ${bytes.byteLength} bytes; limit is ${maxInputBytes} bytes.`,
      { actualBytes: bytes.byteLength, maximumBytes: maxInputBytes },
    );
  }

  const magicBytes = new TextEncoder().encode(SYNTHETIC_MPB_V1_MAGIC);
  if (bytes.byteLength < magicBytes.byteLength) {
    const supplied = ascii(bytes);
    const expectedPrefix = SYNTHETIC_MPB_V1_MAGIC.slice(0, supplied.length);
    return supplied === expectedPrefix
      ? failure(
          "truncated-mpb-envelope",
          "Synthetic MPB envelope is truncated before the complete magic header.",
          { actualBytes: bytes.byteLength },
        )
      : failure(
          "unrecognized-mpb-envelope",
          "Input is not the documented synthetic MPB v1 envelope.",
        );
  }
  if (ascii(bytes.slice(0, magicBytes.byteLength)) !== SYNTHETIC_MPB_V1_MAGIC) {
    return failure(
      "unrecognized-mpb-envelope",
      "Input is not the documented synthetic MPB v1 envelope; proprietary MPB decoding is not attempted.",
    );
  }
  if (bytes.byteLength < SYNTHETIC_MPB_V1_HEADER_BYTES) {
    return failure(
      "truncated-mpb-envelope",
      "Synthetic MPB envelope is truncated in its version/length header.",
      { actualBytes: bytes.byteLength },
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(8, true);
  if (version !== 1) {
    return failure(
      "unsupported-mpb-version",
      `Synthetic MPB envelope version ${version} is unsupported; only version 1 is inspected.`,
      { version },
    );
  }
  const payloadLength = view.getUint32(10, true);
  const expectedLength = SYNTHETIC_MPB_V1_HEADER_BYTES + payloadLength;
  if (bytes.byteLength < expectedLength) {
    return failure(
      "truncated-mpb-envelope",
      `Synthetic MPB v1 declares ${payloadLength} payload bytes but only ${bytes.byteLength - SYNTHETIC_MPB_V1_HEADER_BYTES} are available.`,
      {
        declaredPayloadBytes: payloadLength,
        availablePayloadBytes: bytes.byteLength - SYNTHETIC_MPB_V1_HEADER_BYTES,
      },
    );
  }

  const diagnostics: RobotDiagnostic[] = [];
  const trailing = bytes.slice(expectedLength);
  if (trailing.byteLength > 0) {
    diagnostics.push({
      severity: "warning",
      phase: "legacy-import",
      code: "mpb-trailing-bytes",
      message: `${trailing.byteLength} trailing bytes are not decoded and were retained as diagnostic hex.`,
      details: { trailingByteCount: trailing.byteLength },
    });
  }

  let payload: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.slice(SYNTHETIC_MPB_V1_HEADER_BYTES, expectedLength),
    );
    payload = JSON.parse(text) as unknown;
  } catch (cause) {
    return failure(
      "malformed-mpb-payload",
      cause instanceof Error
        ? `Synthetic MPB v1 payload is malformed: ${cause.message}`
        : "Synthetic MPB v1 payload is malformed.",
    );
  }

  const unknownFields: MpbUnknownField[] = [];
  let knownFields: MpbV1KnownFields;
  try {
    knownFields = parseKnownFields(payload, unknownFields, diagnostics);
  } catch (cause) {
    return failure(
      "malformed-mpb-payload",
      cause instanceof Error
        ? `Synthetic MPB v1 payload is invalid: ${cause.message}`
        : "Synthetic MPB v1 payload is invalid.",
    );
  }

  const inspection: MpbV1Inspection = {
    format: "synthetic-mpb-v1-envelope",
    version: 1,
    verification: "unverified",
    writerSupported: false,
    knownFields,
    unknownFields,
    trailingByteCount: trailing.byteLength,
    trailingBytesHex: trailing.byteLength > 0 ? hexPrefix(trailing) : null,
    diagnostics,
  };
  return { ok: true, inspection, diagnostics };
}
