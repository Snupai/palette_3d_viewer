import {
  countSheetErrors,
  palletSheetJsonSchema,
  rawPalletSheetSchema,
  SHEET_EXTRACTION_PROMPT,
  sheetRetryPrompt,
  validatePalletSheet,
  type ValidatedSheet,
} from "~/domain/sheetExtraction";

export type OllamaSheetExtractorOptions = {
  /** Base URL of the local Ollama server, e.g. `http://127.0.0.1:11434`. */
  ollamaUrl: string;
  model: string;
  /** Extra attempts when the answer fails the consistency checks. */
  maxRetries?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export type SheetExtractionResult = ValidatedSheet & {
  model: string;
  attempts: number;
  durationMs: number;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: string[];
};

export class SheetExtractionError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "model" | "invalid-response",
  ) {
    super(message);
    this.name = "SheetExtractionError";
  }
}

/**
 * Reads a photographed pallet sheet with a local vision model. The image never
 * leaves this machine: the only network call goes to the local Ollama server.
 * If the answer fails the arithmetic checks, the model is shown its own errors
 * once and asked again; the attempt with fewer errors wins.
 */
export async function extractPalletSheet(
  imageBase64: string,
  {
    ollamaUrl,
    model,
    maxRetries = 1,
    timeoutMs = 300_000,
    fetchImpl = fetch,
  }: OllamaSheetExtractorOptions,
): Promise<SheetExtractionResult> {
  const startedAt = Date.now();
  const messages: ChatMessage[] = [
    { role: "user", content: SHEET_EXTRACTION_PROMPT, images: [imageBase64] },
  ];

  let best: ValidatedSheet | null = null;
  let attempts = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    attempts += 1;
    const answer = await chat(messages, {
      ollamaUrl,
      model,
      timeoutMs,
      fetchImpl,
    });
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
    model,
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

async function chat(
  messages: readonly ChatMessage[],
  {
    ollamaUrl,
    model,
    timeoutMs,
    fetchImpl,
  }: Required<Omit<OllamaSheetExtractorOptions, "maxRetries">>,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/chat", ollamaUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: palletSheetJsonSchema,
        options: { temperature: 0 },
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    throw new SheetExtractionError(
      `Local model server at ${ollamaUrl} is not reachable (${cause instanceof Error ? cause.message : String(cause)}). Is Ollama running?`,
      "unreachable",
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SheetExtractionError(
      `Ollama returned ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      "model",
    );
  }
  const body = (await response.json()) as { message?: { content?: unknown } };
  if (typeof body.message?.content !== "string") {
    throw new SheetExtractionError(
      "Ollama response has no message content.",
      "invalid-response",
    );
  }
  return body.message.content;
}
