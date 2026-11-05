import {
  countSheetErrors,
  palletSheetJsonSchema,
  rawPalletSheetSchema,
  SHEET_EXTRACTION_PROMPT,
  sheetRetryPrompt,
  validatePalletSheet,
  type ValidatedSheet,
} from "~/domain/sheetExtraction";
import {
  chatEndpointUrl,
  type SheetExtractionApi,
} from "./sheetExtractionConfig";

export type OllamaSheetExtractorOptions = {
  /** Wire protocol of the model server; defaults to `ollama`. */
  api?: SheetExtractionApi;
  /**
   * Base URL of the local model server, e.g. `http://127.0.0.1:11434` (Ollama)
   * or `http://127.0.0.1:8080` (llama.cpp `llama-server`).
   */
  baseUrl: string;
  /**
   * Model name. Required by Ollama; for `openai` it is omitted from the request
   * when unset, so the server answers with its loaded model.
   */
  model?: string;
  /** Sent as `Authorization: Bearer <key>` when set. Never logged. */
  apiKey?: string;
  /** MIME type for the OpenAI data URL; Ollama ignores it. */
  imageMimeType?: string;
  /** Extra attempts when the answer fails the consistency checks. */
  maxRetries?: number;
  timeoutMs?: number;
  /**
   * Abort from the HTTP request (client disconnect / replaced upload). Combined
   * with `timeoutMs` so a cancelled read frees the admission slot promptly.
   */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

export type SheetExtractionResult = ValidatedSheet & {
  /** Configured model, else the one the server reported, else `"unknown"`. */
  model: string;
  attempts: number;
  durationMs: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

export type SheetExtractionErrorKind =
  | "unreachable"
  | "timeout"
  | "model"
  | "invalid-response";

export class SheetExtractionError extends Error {
  constructor(
    message: string,
    readonly kind: SheetExtractionErrorKind,
  ) {
    super(message);
    this.name = "SheetExtractionError";
  }
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "AbortError";
}

function isTimeoutError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === "TimeoutError";
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  const error = new Error(
    reason instanceof Error ? reason.message : "This operation was aborted",
  );
  error.name = "AbortError";
  return error;
}

/** Prefer `AbortSignal.any` so timeout and caller abort share one fetch signal. */
function chatSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([timeout, external]);
  }
  const controller = new AbortController();
  const abort = () =>
    controller.abort(external.aborted ? external.reason : timeout.reason);
  if (external.aborted || timeout.aborted) {
    abort();
    return controller.signal;
  }
  external.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

/**
 * Reads a photographed pallet sheet with a local vision model. The only network
 * call goes to the configured local model server (Ollama, or an
 * OpenAI-compatible one such as llama.cpp's `llama-server`).
 * If the answer fails the arithmetic checks, the model is shown its own errors
 * once and asked again; the attempt with fewer errors wins.
 */
export async function extractPalletSheet(
  imageBase64: string,
  {
    api = "ollama",
    baseUrl,
    model,
    apiKey,
    imageMimeType = "image/jpeg",
    maxRetries = 1,
    timeoutMs = 300_000,
    signal,
    fetchImpl = fetch,
  }: OllamaSheetExtractorOptions,
): Promise<SheetExtractionResult> {
  const startedAt = Date.now();
  const messages: ChatMessage[] = [
    { role: "user", content: SHEET_EXTRACTION_PROMPT, images: [imageBase64] },
  ];

  let best: ValidatedSheet | null = null;
  let reportedModel: string | undefined;
  let attempts = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) {
      throw abortError(signal.reason);
    }
    attempts += 1;
    const { content: answer, model: answeredBy } = await chat(messages, {
      api,
      baseUrl,
      model,
      apiKey,
      imageMimeType,
      timeoutMs,
      signal,
      fetchImpl,
    });
    reportedModel ??= answeredBy;
    const validated = validatePalletSheet(parseAnswer(answer));
    if (
      best === null ||
      countSheetErrors(validated.issues) < countSheetErrors(best.issues)
    ) {
      best = validated;
    }
    if (countSheetErrors(best.issues) === 0) break;
    messages.push(
      { role: "assistant", content: answer },
      { role: "user", content: sheetRetryPrompt(validated.issues) },
    );
  }

  return {
    ...best!,
    model: model ?? reportedModel ?? "unknown",
    attempts,
    durationMs: Date.now() - startedAt,
  };
}

function parseAnswer(answer: string) {
  let json: unknown;
  try {
    json = JSON.parse(answer);
  } catch {
    throw new SheetExtractionError(
      "The model did not return JSON.",
      "invalid-response",
    );
  }
  const parsed = rawPalletSheetSchema.safeParse(json);
  if (!parsed.success) {
    throw new SheetExtractionError(
      "The model answer does not match the sheet schema.",
      "invalid-response",
    );
  }
  return parsed.data;
}

type ChatOptions = {
  api: SheetExtractionApi;
  baseUrl: string;
  model?: string;
  apiKey?: string;
  imageMimeType: string;
  timeoutMs: number;
  signal?: AbortSignal;
  fetchImpl: typeof fetch;
};

type ChatAnswer = { content: string; model?: string };

const SERVER_LABEL: Record<SheetExtractionApi, string> = {
  ollama: "Ollama",
  openai: "Model server",
};

function requestBody(
  messages: readonly ChatMessage[],
  { api, model, imageMimeType }: ChatOptions,
): unknown {
  if (api === "ollama") {
    return {
      ...(model ? { model } : {}),
      stream: false,
      format: palletSheetJsonSchema,
      options: { temperature: 0 },
      messages,
    };
  }
  return {
    ...(model ? { model } : {}),
    stream: false,
    temperature: 0,
    response_format: {
      type: "json_schema",
      json_schema: { name: "pallet_sheet", schema: palletSheetJsonSchema },
    },
    messages: messages.map(({ role, content, images }) =>
      images?.length
        ? {
            role,
            content: [
              { type: "text", text: content },
              ...images.map((image) => ({
                type: "image_url",
                image_url: { url: `data:${imageMimeType};base64,${image}` },
              })),
            ],
          }
        : { role, content },
    ),
  };
}

function answerFrom(api: SheetExtractionApi, body: unknown): ChatAnswer | null {
  if (typeof body !== "object" || body === null) return null;
  if (api === "ollama") {
    const content = (body as { message?: { content?: unknown } }).message
      ?.content;
    const model = (body as { model?: unknown }).model;
    return typeof content === "string"
      ? { content, ...(typeof model === "string" ? { model } : {}) }
      : null;
  }
  const { choices, model } = body as {
    choices?: { message?: { content?: unknown } }[];
    model?: unknown;
  };
  const content = Array.isArray(choices)
    ? choices[0]?.message?.content
    : undefined;
  return typeof content === "string"
    ? { content, ...(typeof model === "string" ? { model } : {}) }
    : null;
}

async function chat(
  messages: readonly ChatMessage[],
  options: ChatOptions,
): Promise<ChatAnswer> {
  const { api, baseUrl, apiKey, timeoutMs, signal, fetchImpl } = options;
  const server = SERVER_LABEL[api];
  let response: Response | undefined;
  const requestSignal = chatSignal(timeoutMs, signal);
  try {
    response = await fetchImpl(chatEndpointUrl(api, baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(requestBody(messages, options)),
      signal: requestSignal,
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new SheetExtractionError(
        `${server} returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
        "model",
      );
    }
    const answer = answerFrom(api, await response.json());
    if (!answer) {
      throw new SheetExtractionError(
        `${server} response has no message content.`,
        "invalid-response",
      );
    }
    return answer;
  } catch (cause) {
    if (cause instanceof SheetExtractionError) throw cause;
    if (
      isTimeoutError(cause) ||
      (requestSignal.aborted && isTimeoutError(requestSignal.reason))
    ) {
      throw new SheetExtractionError(
        `Local model at ${baseUrl} timed out after ${timeoutMs} ms.`,
        "timeout",
      );
    }
    if (isAbortError(cause) || signal?.aborted) {
      throw isAbortError(cause) ? cause : abortError(signal?.reason ?? cause);
    }
    if (response) {
      throw new SheetExtractionError(
        `${server} response body could not be read.`,
        "invalid-response",
      );
    }
    throw new SheetExtractionError(
      `Local model server at ${baseUrl} is not reachable (${cause instanceof Error ? cause.message : String(cause)}). Is ${api === "ollama" ? "Ollama" : "the model server"} running?`,
      "unreachable",
    );
  }
}
