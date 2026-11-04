import { defineConfig } from "drizzle-kit";

/**
 * `bun run db:generate` diffs `src/server/db/schema` against `drizzle/` and
 * writes a new SQL migration; `bun run db:migrate` applies pending ones to
 * `DATABASE_URL` (ADR 0009).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema",
  out: "./drizzle",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://palette:palette@127.0.0.1:5432/palette",
  },
});
