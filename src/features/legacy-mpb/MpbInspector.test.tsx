import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_MPB_V1_HEADER_BYTES,
  SYNTHETIC_MPB_V1_MAGIC,
} from "~/domain/formats";
import { MpbInspector } from "~/features/legacy-mpb/MpbInspector";

afterEach(cleanup);

function envelope(payload: unknown): Uint8Array {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const bytes = new Uint8Array(
    SYNTHETIC_MPB_V1_HEADER_BYTES + payloadBytes.byteLength,
  );
  bytes.set(new TextEncoder().encode(SYNTHETIC_MPB_V1_MAGIC), 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(8, 1, true);
  view.setUint32(10, payloadBytes.byteLength, true);
  bytes.set(payloadBytes, SYNTHETIC_MPB_V1_HEADER_BYTES);
  return bytes;
}

describe("MpbInspector", () => {
  it("keeps unverified status, unknown fields, and writer absence visible", async () => {
    const view = render(<MpbInspector />);
    const bytes = envelope({
      projectNumber: "P-1",
      proprietaryUnknown: { value: 7 },
    });
    const input =
      view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [
          {
            name: "inspection.mpb",
            arrayBuffer: async () => bytes.buffer,
          },
        ],
      },
    });

    expect(await screen.findByText("synthetic-mpb-v1-envelope")).toBeTruthy();
    expect(screen.getByText("unverified")).toBeTruthy();
    expect(screen.getByText("proprietaryUnknown")).toBeTruthy();
    expect(screen.getByText("No")).toBeTruthy();
    expect(screen.getByText(/external compatibility unverified/i)).toBeTruthy();
  });

  it("rejects oversized files before reading their bytes", async () => {
    const view = render(<MpbInspector />);
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(0));
    const input =
      view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: {
        files: [
          {
            name: "oversized.mpb",
            size: 1_048_577,
            arrayBuffer,
          },
        ],
      },
    });

    expect(await screen.findByText(/The file was not read/)).toBeTruthy();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});
