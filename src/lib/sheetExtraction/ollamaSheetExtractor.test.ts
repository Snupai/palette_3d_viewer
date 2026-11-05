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
      baseUrl: "http://127.0.0.1:11434",
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
        baseUrl: "http://127.0.0.1:11434",
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
      baseUrl: "http://127.0.0.1:11434",
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
        baseUrl: "http://127.0.0.1:11434",
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
        baseUrl: "http://127.0.0.1:11434",
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
      baseUrl: "http://127.0.0.1:11434",
      model: "test-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SheetExtractionError);
    expect(error).toMatchObject({ kind: "unreachable" });
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("extractPalletSheet request shape", () => {
  it("talks OpenAI-compatible chat with an image data URL, schema and bearer key", async () => {
    const fetchImpl = vi.fn(async (_url: URL, _init?: RequestInit) =>
      jsonResponse({
        model: "qwen2.5-vl-7b.gguf",
        choices: [{ message: { role: "assistant", content: validSheetJson } }],
      }),
    );

    const result = await extractPalletSheet("aaa", {
      api: "openai",
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "secret",
      imageMimeType: "image/png",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:8080/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer secret",
    );
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("model");
    expect(body).toMatchObject({
      stream: false,
      temperature: 0,
      response_format: { type: "json_schema" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aaa" },
            },
          ],
        },
      ],
    });
    expect(result.sheet.productNumber).toBe("483-00815");
    expect(result.model).toBe("qwen2.5-vl-7b.gguf");
  });

  it("keeps Ollama's native request and sends no Authorization without a key", async () => {
    const fetchImpl = vi.fn(async (_url: URL, _init?: RequestInit) =>
      jsonResponse({ message: { content: validSheetJson } }),
    );

    const result = await extractPalletSheet("aaa", {
      baseUrl: "http://127.0.0.1:11434",
      model: "test-model",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:11434/api/chat");
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(JSON.parse(init?.body as string)).toMatchObject({
      model: "test-model",
      format: { type: "object" },
      messages: [{ role: "user", images: ["aaa"] }],
    });
    expect(result.model).toBe("test-model");
  });

  it("reports a rejected key as a model error without echoing the key", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { message: "Invalid API Key" } }),
          {
            status: 401,
          },
        ),
    );

    const error = await extractPalletSheet("aaa", {
      api: "openai",
      baseUrl: "http://127.0.0.1:8080",
      apiKey: "secret",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ kind: "model" });
    expect((error as Error).message).toContain("401");
    expect((error as Error).message).not.toContain("secret");
  });
});
