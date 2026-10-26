// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  extractPalletSheet,
  SheetExtractionError,
} from "./ollamaSheetExtractor";

const validSheetJson = JSON.stringify({
  productNumber: "483-00815",
  cartonMm: { length: 148, width: 148, height: 122 },
  blockMm: { length: 1184, width: 740, height: 1586 },
  palletMm: { length: 1200, width: 800 },
  cartonsPerLayer: 40,
  layers: 13,
  cartonsPerPallet: 520,
});

describe("extractPalletSheet abort and timeout handling", () => {
  it("maps fetch TimeoutError to kind timeout instead of unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    });

    const error = await extractPalletSheet("aaa", {
      ollamaUrl: "http://127.0.0.1:11434",
      model: "test-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SheetExtractionError);
    expect(error).toMatchObject({
      name: "SheetExtractionError",
      kind: "timeout",
    });
    expect((error as SheetExtractionError).message).toContain("timed out");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rethrows caller AbortError so the route can release without a 503", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("This operation was aborted");
      error.name = "AbortError";
      throw error;
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      extractPalletSheet("aaa", {
        ollamaUrl: "http://127.0.0.1:11434",
        model: "test-model",
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("passes a combined abort signal into fetch and still completes on success", async () => {
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(
        JSON.stringify({ message: { content: validSheetJson } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await extractPalletSheet("aaa", {
      ollamaUrl: "http://127.0.0.1:11434",
      model: "test-model",
      signal: new AbortController().signal,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result.sheet.productNumber).toBe("483-00815");
    expect(result.attempts).toBe(1);
  });

  it("classifies a timeout while reading the response body", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(
              new DOMException("Timed out during body read", "TimeoutError"),
            );
          },
        }),
      );
    await expect(
      extractPalletSheet("aaa", {
        ollamaUrl: "http://127.0.0.1:11434",
        model: "test-model",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ name: "SheetExtractionError", kind: "timeout" });
  });

  it("preserves caller cancellation while reading an error response body", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(
              new DOMException("Cancelled during body read", "AbortError"),
            );
          },
        }),
        { status: 500 },
      );
    await expect(
      extractPalletSheet("aaa", {
        ollamaUrl: "http://127.0.0.1:11434",
        model: "test-model",
        fetchImpl,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps genuine connection failures as unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const error = await extractPalletSheet("aaa", {
      ollamaUrl: "http://127.0.0.1:11434",
      model: "test-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SheetExtractionError);
    expect(error).toMatchObject({ kind: "unreachable" });
  });
});
