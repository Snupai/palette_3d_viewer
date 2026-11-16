// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  extractPalletSheet,
  extractPalletSheetWithFallback,
  SheetExtractionError,
} from "./ollamaSheetExtractor";
import {
  NANONETS_OCR_PROMPT,
  NUEXTRACT_PROMPT,
} from "~/domain/sheetExtraction";

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

describe("extractPalletSheet prompt styles", () => {
  function openAiAnswers(...contents: string[]) {
    const queue = [...contents];
    return vi.fn(async (_url: URL, _init?: RequestInit) =>
      jsonResponse({
        choices: [{ message: { role: "assistant", content: queue.shift() } }],
      }),
    );
  }
  function bodyOf(fetchImpl: ReturnType<typeof openAiAnswers>, call: number) {
    return JSON.parse(fetchImpl.mock.calls[call]![1]?.body as string) as Record<
      string,
      unknown
    >;
  }

  it("runs Nanonets' OCR prompt as free text, then extracts JSON from the transcription", async () => {
    const fetchImpl = openAiAnswers(
      "<table>Packstückmaße 148</table>",
      validSheetJson,
    );

    const result = await extractPalletSheet("aaa", {
      api: "openai",
      baseUrl: "http://127.0.0.1:8201",
      model: "nanonets-ocr2-3b",
      promptStyle: "ocr-extract",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const ocr = bodyOf(fetchImpl, 0);
    expect(ocr).not.toHaveProperty("response_format");
    expect(ocr.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64,aaa" },
          },
          { type: "text", text: NANONETS_OCR_PROMPT },
        ],
      },
    ]);
    const extract = bodyOf(fetchImpl, 1);
    expect(extract).toMatchObject({ response_format: { type: "json_schema" } });
    expect(
      (extract.messages as { role: string; content: unknown }[]).map(
        ({ role, content }) => [role, typeof content],
      ),
    ).toEqual([
      ["user", "object"],
      ["assistant", "string"],
      ["user", "string"],
    ]);
    expect(result.sheet.cartonsPerPallet).toBe(520);
    expect(result.attempts).toBe(1);
  });

  it("sends NuExtract its template and maps the descriptive keys back without a retry turn", async () => {
    const fetchImpl = openAiAnswers(
      JSON.stringify({
        sheet_layout: "pester",
        Produkt_Nr_article_number_digits_dash_digits_may_be_handwritten:
          "483-00815",
        carton_outer_dimensions_mm_Packstueckmasse_or_Abmessung_der_VE_or_VPE_aussen_not_EP:
          {
            length: 148,
            width: 148,
            height: 122,
          },
        stacked_load_block_dimensions_without_pallet_mm: {
          length: 1184,
          width: 740,
          height: 1586,
        },
        wooden_pallet_footprint_mm: { length: 1200, width: 800 },
        cartons_per_layer_Packstuecke_VE_VPE_pro_Lage: 40,
        number_of_layers_Lagen_pro_Palette: 13,
        // Inconsistent on purpose: an instruct model would get a retry turn.
        cartons_per_pallet_Packstuecke_VE_VPE_pro_Palette: 999,
      }),
    );

    const result = await extractPalletSheet("aaa", {
      api: "openai",
      baseUrl: "http://127.0.0.1:8202",
      model: "nuextract-2.0-8b",
      promptStyle: "nuextract",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetchImpl, 0);
    expect(body).toMatchObject({
      response_format: {
        json_schema: {
          schema: {
            properties: {
              cartons_per_layer_Packstuecke_VE_VPE_pro_Lage: {
                type: ["integer", "null"],
              },
            },
          },
        },
      },
      messages: [
        {
          content: [
            { type: "text", text: NUEXTRACT_PROMPT },
            { type: "image_url" },
          ],
        },
      ],
    });
    expect(result.sheet.productNumber).toBe("483-00815");
    expect(result.sheet.cartonMm).toEqual({
      length: 148,
      width: 148,
      height: 122,
    });
    expect(result.sheet.cartonsPerLayer).toBe(40);
    expect(result.attempts).toBe(1);
  });
});

describe("extractPalletSheetWithFallback", () => {
  const inconsistentSheetJson = JSON.stringify({
    ...(JSON.parse(validSheetJson) as object),
    cartonsPerPallet: 999,
  });
  function reader(model: string, answer: () => Promise<Response>) {
    const fetchImpl = vi.fn(answer);
    return {
      fetchImpl,
      options: {
        api: "openai" as const,
        baseUrl: "http://127.0.0.1:8200",
        model,
        maxRetries: 0,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    };
  }
  const answering = (content: string) => async () =>
    jsonResponse({ choices: [{ message: { content } }] });

  it("keeps a consistent fast answer and never calls the main model", async () => {
    const fast = reader("nuextract3", answering(validSheetJson));
    const main = reader("qwen3.8-27b", answering(validSheetJson));

    const result = await extractPalletSheetWithFallback("aaa", {
      fast: fast.options,
      main: main.options,
    });

    expect(result.model).toBe("nuextract3");
    expect(result.fallback).toBeUndefined();
    expect(main.fetchImpl).not.toHaveBeenCalled();
  });

  it("lets the main model read when the fast answer fails the checks", async () => {
    const fast = reader("nuextract3", answering(inconsistentSheetJson));
    const main = reader("qwen3.8-27b", answering(validSheetJson));

    const result = await extractPalletSheetWithFallback("aaa", {
      fast: fast.options,
      main: main.options,
    });

    expect(main.fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.model).toBe("qwen3.8-27b");
    expect(result.sheet.cartonsPerPallet).toBe(520);
    expect(result.fallback).toEqual({ fastModel: "nuextract3", fastErrors: 1 });
  });

  it("gives a retrying fast model no second attempt before the main model", async () => {
    const fast = reader("qwen3-vl-8b", answering(inconsistentSheetJson));
    const main = reader("qwen3.8-27b", answering(validSheetJson));

    const result = await extractPalletSheetWithFallback("aaa", {
      // Default `maxRetries` (1), as the route passes it.
      fast: { ...fast.options, maxRetries: undefined },
      main: main.options,
    });

    expect(fast.fetchImpl).toHaveBeenCalledTimes(1);
    expect(main.fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.model).toBe("qwen3.8-27b");
  });

  it("falls back when the fast model is unreachable", async () => {
    const fast = reader("nuextract3", async () => {
      throw new TypeError("fetch failed");
    });
    const main = reader("qwen3.8-27b", answering(validSheetJson));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const result = await extractPalletSheetWithFallback("aaa", {
        fast: fast.options,
        main: main.options,
      });
      expect(result.model).toBe("qwen3.8-27b");
      expect(result.fallback).toEqual({
        fastModel: "nuextract3",
        fastErrors: null,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it("does not fall back when the caller aborts", async () => {
    const controller = new AbortController();
    const fast = reader("nuextract3", async () => {
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const main = reader("qwen3.8-27b", answering(validSheetJson));

    const error = await extractPalletSheetWithFallback("aaa", {
      fast: { ...fast.options, signal: controller.signal },
      main: { ...main.options, signal: controller.signal },
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(main.fetchImpl).not.toHaveBeenCalled();
  });

  it("reads with the main model alone when no fast model is configured", async () => {
    const main = reader("qwen3.8-27b", answering(validSheetJson));

    const result = await extractPalletSheetWithFallback("aaa", {
      fast: null,
      main: main.options,
    });

    expect(result.model).toBe("qwen3.8-27b");
    expect(result.fallback).toBeUndefined();
  });
});
