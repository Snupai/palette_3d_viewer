import {
  sheetPromptStyleFor,
  type SheetPromptStyle,
} from "~/domain/sheetExtraction";

/**
 * Which local model server reads the sheet photos, and how to reach it.
 *
 * - `ollama`: Ollama's native `/api/chat` (default).
 * - `openai`: an OpenAI-compatible `/v1/chat/completions`, e.g. llama.cpp's
 *   `llama-server` (started with `--mmproj` for vision, optionally `--api-key`).
 *
 * The choice is explicit; there is no probing or fallback between servers.
 */
export const SHEET_EXTRACTION_APIS = ["ollama", "openai"] as const;
export type SheetExtractionApi = (typeof SHEET_EXTRACTION_APIS)[number];

export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
/** `llama-server`'s default port. */
export const DEFAULT_OPENAI_URL = "http://127.0.0.1:8080";
/**
 * Ollama requires a model name; a single-model OpenAI-compatible server (e.g.
 * `llama-server -m …`) may use its loaded one.
 */
export const DEFAULT_OLLAMA_MODEL = "qwen2.5vl:32b";

export type SheetExtractionEndpoint = {
  api: SheetExtractionApi;
  baseUrl: string;
  /**
   * Omitted for `openai` when unset: a single-model `llama-server -m …` uses its
   * loaded model; router/multi-model mode rejects requests without one.
   */
  model?: string;
  /** Sent as `Authorization: Bearer <key>` when set. Never logged. */
  apiKey?: string;
  /** Prompt shape, derived from the model name (`sheetPromptStyleFor`). */
  promptStyle: SheetPromptStyle;
};

export type SheetExtractionSettings = {
  SHEET_EXTRACTION_API?: string;
  SHEET_EXTRACTION_URL?: string;
  /** Older name for the URL, still honoured when `SHEET_EXTRACTION_URL` is unset. */
  OLLAMA_URL?: string;
  SHEET_EXTRACTION_MODEL?: string;
  SHEET_EXTRACTION_API_KEY?: string;
  /** Fast first reader, see `resolveSheetExtractionFastEndpoint`. */
  SHEET_EXTRACTION_FAST_MODEL?: string;
  SHEET_EXTRACTION_FAST_URL?: string;
};

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function isSheetExtractionApi(
  value: string,
): value is SheetExtractionApi {
  return (SHEET_EXTRACTION_APIS as readonly string[]).includes(value);
}

/** Maps the environment settings to one endpoint; empty values count as unset. */
export function resolveSheetExtractionEndpoint(
  settings: SheetExtractionSettings,
): SheetExtractionEndpoint {
  const apiSetting = present(settings.SHEET_EXTRACTION_API) ?? "ollama";
  if (!isSheetExtractionApi(apiSetting)) {
    throw new Error(
      `SHEET_EXTRACTION_API must be one of ${SHEET_EXTRACTION_APIS.join(", ")}.`,
    );
  }
  const api = apiSetting;
  const baseUrl =
    present(settings.SHEET_EXTRACTION_URL) ??
    present(settings.OLLAMA_URL) ??
    (api === "ollama" ? DEFAULT_OLLAMA_URL : DEFAULT_OPENAI_URL);
  const model =
    present(settings.SHEET_EXTRACTION_MODEL) ??
    (api === "ollama" ? DEFAULT_OLLAMA_MODEL : undefined);
  const apiKey = present(settings.SHEET_EXTRACTION_API_KEY);
  return {
    api,
    baseUrl,
    ...(model ? { model } : {}),
    ...(apiKey ? { apiKey } : {}),
    promptStyle: sheetPromptStyleFor(model),
  };
}

/**
 * Endpoint URL for one API. A base URL path is kept (reverse-proxy prefixes),
 * and an OpenAI base that already ends in `/v1` is not doubled.
 */
export function chatEndpointUrl(api: SheetExtractionApi, baseUrl: string): URL {
  const url = new URL(baseUrl);
  const path = url.pathname.replace(/\/+$/, "");
  if (api === "ollama") {
    url.pathname = `${path}/api/chat`;
  } else {
    url.pathname = path.endsWith("/v1")
      ? `${path}/chat/completions`
      : `${path}/v1/chat/completions`;
  }
  url.search = "";
  url.hash = "";
  return url;
}

/**
 * Optional fast model that reads first. When its answer fails the consistency
 * checks (or the call fails), the main endpoint reads the photo instead, so
 * most sheets take a second and only the hard ones wait for the large model.
 * It shares the API and key of the main endpoint; `SHEET_EXTRACTION_FAST_URL`
 * only when it runs on another server. Unset: the main model reads alone.
 */
export function resolveSheetExtractionFastEndpoint(
  settings: SheetExtractionSettings,
): SheetExtractionEndpoint | null {
  const model = present(settings.SHEET_EXTRACTION_FAST_MODEL);
  if (!model) return null;
  const main = resolveSheetExtractionEndpoint(settings);
  return {
    ...main,
    baseUrl: present(settings.SHEET_EXTRACTION_FAST_URL) ?? main.baseUrl,
    model,
    promptStyle: sheetPromptStyleFor(model),
  };
}
