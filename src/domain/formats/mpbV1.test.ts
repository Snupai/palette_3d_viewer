import { describe, expect, it } from "vitest";
import {
  inspectMpbV1Envelope,
  SYNTHETIC_MPB_V1_HEADER_BYTES,
  SYNTHETIC_MPB_V1_MAGIC,
} from "~/domain/formats/mpbV1";

function syntheticEnvelope(
  payload: unknown,
  options: {
    version?: number;
    declaredLength?: number;
    trailing?: readonly number[];
    payloadBytes?: Uint8Array;
  } = {},
): Uint8Array {
  const payloadBytes =
    options.payloadBytes ?? new TextEncoder().encode(JSON.stringify(payload));
  const declaredLength = options.declaredLength ?? payloadBytes.byteLength;
  const trailing = Uint8Array.from(options.trailing ?? []);
  const bytes = new Uint8Array(
    SYNTHETIC_MPB_V1_HEADER_BYTES +
      payloadBytes.byteLength +
      trailing.byteLength,
  );
  bytes.set(new TextEncoder().encode(SYNTHETIC_MPB_V1_MAGIC), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(8, options.version ?? 1, true);
  view.setUint32(10, declaredLength, true);
  bytes.set(payloadBytes, SYNTHETIC_MPB_V1_HEADER_BYTES);
  bytes.set(trailing, SYNTHETIC_MPB_V1_HEADER_BYTES + payloadBytes.byteLength);
  return bytes;
}

describe("safe synthetic MPB v1 inspection boundary", () => {
  it("inspects only known fields, preserves unknowns, and labels output unverified", () => {
    const input = syntheticEnvelope(
      {
        projectNumber: "P-1",
        productNumber: "SKU-1",
        package: {
          lengthMm: 100,
          widthMm: 50,
          heightMm: 40,
          weightKg: 1.5,
          proprietaryFlag: 7,
        },
        pallet: { lengthMm: 1_200, widthMm: 800, heightMm: 144 },
        proprietaryRoot: { raw: true },
      },
      { trailing: [0xde, 0xad] },
    );

    const result = inspectMpbV1Envelope(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inspection).toMatchObject({
      format: "synthetic-mpb-v1-envelope",
      version: 1,
      verification: "unverified",
      writerSupported: false,
      knownFields: {
        projectNumber: "P-1",
        productNumber: "SKU-1",
        package: {
          lengthMm: 100,
          widthMm: 50,
          heightMm: 40,
          weightKg: 1.5,
        },
        pallet: { lengthMm: 1_200, widthMm: 800, heightMm: 144 },
      },
      trailingByteCount: 2,
      trailingBytesHex: "dead",
    });
    expect(result.inspection.unknownFields).toEqual([
      { path: "proprietaryRoot", value: { raw: true } },
      { path: "package.proprietaryFlag", value: 7 },
    ]);
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["unknown-mpb-field", "mpb-trailing-bytes"]),
    );
  });

  it("rejects oversize, unrecognized, truncated, unknown-version, and malformed inputs", () => {
    const valid = syntheticEnvelope({ projectNumber: "P-1" });
    const oversize = inspectMpbV1Envelope(valid, {
      maxInputBytes: valid.byteLength - 1,
    });
    const unrecognized = inspectMpbV1Envelope(
      new TextEncoder().encode("NOT-MPB-ENVELOPE"),
    );
    const truncated = inspectMpbV1Envelope(
      syntheticEnvelope({ projectNumber: "P-1" }, { declaredLength: 10_000 }),
    );
    const unknownVersion = inspectMpbV1Envelope(
      syntheticEnvelope({}, { version: 2 }),
    );
    const malformedJson = inspectMpbV1Envelope(
      syntheticEnvelope(null, {
        payloadBytes: new TextEncoder().encode("{not-json"),
      }),
    );
    const malformedFields = inspectMpbV1Envelope(
      syntheticEnvelope({
        package: { lengthMm: 0, widthMm: 50, heightMm: 40 },
      }),
    );

    expect(oversize.diagnostics[0]?.code).toBe("input-too-large");
    expect(unrecognized.diagnostics[0]?.code).toBe("unrecognized-mpb-envelope");
    expect(truncated.diagnostics[0]?.code).toBe("truncated-mpb-envelope");
    expect(unknownVersion.diagnostics[0]?.code).toBe("unsupported-mpb-version");
    expect(malformedJson.diagnostics[0]?.code).toBe("malformed-mpb-payload");
    expect(malformedFields.diagnostics[0]?.code).toBe("malformed-mpb-payload");
  });
});
