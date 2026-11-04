/**
 * `bun run db:migrate` — applies pending Drizzle migrations from `drizzle/` to
 * the PostgreSQL server at `DATABASE_URL` (ADR 0009; Bun also reads `.env`).
 * Idempotent and independent of the storage mode. Waits up to ~30 s for a
 * freshly started container (`bun run db:up`) to accept connections.
 */

// `src/env.js` requires NODE_ENV, which a plain CLI run does not set. Default
// it before the (dynamic) import so static import hoisting cannot reorder it.
(process.env as Record<string, string | undefined>).NODE_ENV ??= "production";

const { env } = await import("~/env");
const { openMigratedDatabase } = await import("~/server/db/database");

const url = env.DATABASE_URL?.trim();
if (!url) {
  console.error("DATABASE_URL is not set; nothing to migrate.");
  process.exit(1);
}

/**
 * Connection refused or "the database system is starting up" (57P03),
 * looking through Drizzle's `DrizzleQueryError` wrapper (`cause`).
 */
function isStartingUp(error: unknown): boolean {
  for (let e: unknown = error; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "57P03") {
      return true;
    }
  }
  return false;
}

const ATTEMPTS = 30;
for (let attempt = 1; ; attempt += 1) {
  try {
    const database = await openMigratedDatabase(url, { maxConnections: 1 });
    await database.close();
    break;
  } catch (error) {
    if (!isStartingUp(error) || attempt === ATTEMPTS) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
console.log(`Migrated ${new URL(url).host}${new URL(url).pathname}`);
