// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type * as Extractor from "~/lib/sheetExtraction/ollamaSheetExtractor";

vi.mock("~/env", () => ({
  env: {
    SHEET_EXTRACTION_MAX_CONCURRENT: 1,
    OLLAMA_URL: "http://localhost:11434",
    SHEET_EXTRACTION_MODEL: "test",
  },
}));
vi.mock(
  "~/lib/sheetExtraction/ollamaSheetExtractor",
  async (importOriginal) => ({
    ...(await importOriginal<typeof Extractor>()),
    extractPalletSheet: vi.fn(async () => ({ ok: true })),
  }),
);
import { POST } from "./route";
import { extractPalletSheet } from "~/lib/sheetExtraction/ollamaSheetExtractor";

describe("sheet extraction upload admission", () => {
  it("allows a completed upload to use Ollama while another upload stalls", async () => {
    const controller = new AbortController();
    const stalled = new Request("http://localhost/api/sheet-extraction", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test" },
      body: new ReadableStream({
        start(stream) {
          stream.enqueue(new TextEncoder().encode("--test\r\n"));
        },
      }),
      signal: controller.signal,
      ...({ duplex: "half" } as object),
    });
    const pending = POST(stalled);
    try {
      const form = new FormData();
      form.set(
        "image",
        new Blob(["image"], { type: "image/png" }),
        "photo.png",
      );
      const response = await POST(
        new Request("http://localhost/api/sheet-extraction", {
          method: "POST",
          body: form,
        }),
      );
      expect(response.status).toBe(200);
      expect(extractPalletSheet).toHaveBeenCalledTimes(1);
    } finally {
      controller.abort();
      expect((await pending).status).toBe(499);
    }
  });
});
