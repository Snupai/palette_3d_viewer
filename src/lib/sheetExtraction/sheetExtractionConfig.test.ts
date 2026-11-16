// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  chatEndpointUrl,
  resolveSheetExtractionEndpoint,
  resolveSheetExtractionFastEndpoint,
} from "./sheetExtractionConfig";

describe("resolveSheetExtractionEndpoint", () => {
  it("defaults to Ollama on loopback with the default vision model", () => {
    expect(resolveSheetExtractionEndpoint({})).toEqual({
      api: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5vl:32b",
      promptStyle: "instruct",
    });
  });

  it("keeps the legacy OLLAMA_URL when SHEET_EXTRACTION_URL is unset", () => {
    expect(
      resolveSheetExtractionEndpoint({ OLLAMA_URL: "http://gpu:11434" })
        .baseUrl,
    ).toBe("http://gpu:11434");
    expect(
      resolveSheetExtractionEndpoint({
        OLLAMA_URL: "http://gpu:11434",
        SHEET_EXTRACTION_URL: "http://other:11434",
      }).baseUrl,
    ).toBe("http://other:11434");
  });

  it("leaves model and key unset for an OpenAI-compatible server", () => {
    expect(
      resolveSheetExtractionEndpoint({
        SHEET_EXTRACTION_API: "openai",
        SHEET_EXTRACTION_MODEL: "",
        SHEET_EXTRACTION_API_KEY: "  ",
      }),
    ).toEqual({
      api: "openai",
      baseUrl: "http://127.0.0.1:8080",
      promptStyle: "instruct",
    });
  });

  it("passes model and key through when set", () => {
    expect(
      resolveSheetExtractionEndpoint({
        SHEET_EXTRACTION_API: "openai",
        SHEET_EXTRACTION_URL: "http://llama:8080",
        SHEET_EXTRACTION_MODEL: "qwen2.5-vl-7b",
        SHEET_EXTRACTION_API_KEY: "secret",
      }),
    ).toEqual({
      api: "openai",
      baseUrl: "http://llama:8080",
      model: "qwen2.5-vl-7b",
      apiKey: "secret",
      promptStyle: "instruct",
    });
  });

  it("rejects an unknown API instead of guessing", () => {
    expect(() =>
      resolveSheetExtractionEndpoint({ SHEET_EXTRACTION_API: "llamacpp" }),
    ).toThrow(/SHEET_EXTRACTION_API/);
  });
});

describe("chatEndpointUrl", () => {
  it.each([
    ["ollama", "http://h:11434", "http://h:11434/api/chat"],
    ["ollama", "http://h/ollama/", "http://h/ollama/api/chat"],
    ["openai", "http://h:8080", "http://h:8080/v1/chat/completions"],
    ["openai", "http://h:8080/v1/", "http://h:8080/v1/chat/completions"],
    ["openai", "http://h/llm", "http://h/llm/v1/chat/completions"],
  ] as const)("%s %s → %s", (api, base, expected) => {
    expect(chatEndpointUrl(api, base).href).toBe(expected);
  });
});

describe("resolveSheetExtractionFastEndpoint", () => {
  it("is off unless a fast model is set", () => {
    expect(resolveSheetExtractionFastEndpoint({})).toBeNull();
    expect(
      resolveSheetExtractionFastEndpoint({ SHEET_EXTRACTION_FAST_MODEL: " " }),
    ).toBeNull();
  });

  it("shares API, server and key with the main model and picks its prompt style", () => {
    const settings = {
      SHEET_EXTRACTION_API: "openai",
      SHEET_EXTRACTION_URL: "http://127.0.0.1:8200",
      SHEET_EXTRACTION_MODEL: "qwen3.8-27b",
      SHEET_EXTRACTION_API_KEY: "k",
      SHEET_EXTRACTION_FAST_MODEL: "nuextract3",
    };
    expect(resolveSheetExtractionFastEndpoint(settings)).toEqual({
      api: "openai",
      baseUrl: "http://127.0.0.1:8200",
      model: "nuextract3",
      apiKey: "k",
      promptStyle: "nuextract",
    });
    expect(
      resolveSheetExtractionFastEndpoint({
        ...settings,
        SHEET_EXTRACTION_FAST_URL: "http://127.0.0.1:8202",
      })?.baseUrl,
    ).toBe("http://127.0.0.1:8202");
  });
});
