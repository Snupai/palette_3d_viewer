import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    /**
     * Wire protocol of the local model server that reads photographed pallet
     * sheets: `ollama` (default) or `openai` (OpenAI-compatible, e.g. llama.cpp
     * `llama-server`). Resolved in `src/lib/sheetExtraction/sheetExtractionConfig.ts`.
     */
    SHEET_EXTRACTION_API: z.enum(["ollama", "openai"]).default("ollama"),
    /** Base URL of that server (default: Ollama :11434, `openai` :8080). */
    SHEET_EXTRACTION_URL: z.string().url().optional(),
    /** Older name for `SHEET_EXTRACTION_URL`, used when that is unset. */
    OLLAMA_URL: z.string().url().optional(),
    /**
     * Vision model; Ollama defaults to `qwen2.5vl:32b`. `openai` may omit it for
     * a single-model `llama-server -m …` (router mode requires it).
     */
    SHEET_EXTRACTION_MODEL: z.string().optional(),
    /** Optional key, sent as `Authorization: Bearer` (e.g. `llama-server --api-key`). */
    SHEET_EXTRACTION_API_KEY: z.string().optional(),
    /** Concurrent sheet-extraction inferences per process; others get 429. */
    SHEET_EXTRACTION_MAX_CONCURRENT: z.coerce.number().int().min(1).default(1),
    /**
     * PostgreSQL connection URL for `NEXT_PUBLIC_PALETTE_STORAGE_MODE=server`
     * (ADR 0009). Ignored in `local` mode; `resolveServerStorageConfig()` in
     * `src/lib/storageMode.ts` requires it in `server` mode.
     */
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(ql)?:\/\//.test(value), {
        message: "DATABASE_URL must be a postgres:// or postgresql:// URL.",
      })
      .optional(),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {
    /**
     * Set to `true`/`1` to deploy without AI: hides the sheet-photo import and
     * turns `/api/sheet-extraction` off. Inlined at build time.
     */
    NEXT_PUBLIC_DISABLE_AI_FEATURES: z
      .enum(["true", "false", "1", "0"])
      .optional(),
    /**
     * Explicit storage mode (ADR 0002): `local` (default) keeps plans in the
     * browser's IndexedDB, `server` uses the LAN server. No automatic fallback
     * between them. Keep in sync with `STORAGE_MODES` in `src/lib/storageMode.ts`.
     */
    NEXT_PUBLIC_PALETTE_STORAGE_MODE: z
      .enum(["local", "server"])
      .default("local"),
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    SHEET_EXTRACTION_API: process.env.SHEET_EXTRACTION_API,
    SHEET_EXTRACTION_URL: process.env.SHEET_EXTRACTION_URL,
    OLLAMA_URL: process.env.OLLAMA_URL,
    SHEET_EXTRACTION_MODEL: process.env.SHEET_EXTRACTION_MODEL,
    SHEET_EXTRACTION_API_KEY: process.env.SHEET_EXTRACTION_API_KEY,
    SHEET_EXTRACTION_MAX_CONCURRENT:
      process.env.SHEET_EXTRACTION_MAX_CONCURRENT,
    DATABASE_URL: process.env.DATABASE_URL,
    NEXT_PUBLIC_DISABLE_AI_FEATURES:
      process.env.NEXT_PUBLIC_DISABLE_AI_FEATURES,
    NEXT_PUBLIC_PALETTE_STORAGE_MODE:
      process.env.NEXT_PUBLIC_PALETTE_STORAGE_MODE,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});
