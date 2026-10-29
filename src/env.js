import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    NODE_ENV: z.enum(["development", "test", "production"]),
    /** Local Ollama server used to read photographed pallet sheets. */
    OLLAMA_URL: z.string().url().default("http://127.0.0.1:11434"),
    /** Local vision model for sheet extraction (`ollama pull <name>`). */
    SHEET_EXTRACTION_MODEL: z.string().default("qwen2.5vl:32b"),
    /** Concurrent sheet-extraction inferences per process; others get 429. */
    SHEET_EXTRACTION_MAX_CONCURRENT: z.coerce.number().int().min(1).default(1),
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
  },

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    OLLAMA_URL: process.env.OLLAMA_URL,
    SHEET_EXTRACTION_MODEL: process.env.SHEET_EXTRACTION_MODEL,
    SHEET_EXTRACTION_MAX_CONCURRENT:
      process.env.SHEET_EXTRACTION_MAX_CONCURRENT,
    NEXT_PUBLIC_DISABLE_AI_FEATURES:
      process.env.NEXT_PUBLIC_DISABLE_AI_FEATURES,
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
