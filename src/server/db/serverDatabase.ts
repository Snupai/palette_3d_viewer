import { env } from "~/env";
import {
  configuredStorageMode,
  resolveServerStorageConfig,
} from "~/lib/storageMode";

import { openDatabase, type PlannerDatabase } from "./database";

/**
 * The one database handle for route handlers. Server-only.
 *
 * Opened lazily from `DATABASE_URL` on first use and cached on `globalThis`,
 * so Next.js dev reloads reuse the pool instead of opening one per reload.
 * Migrations are not run here; the compose `migrate` service applies them
 * before the app starts (ADR 0009). Returns `null` in `local` storage mode
 * (ADR 0002): the server then has no database and API routes answer 404.
 */
const cache = globalThis as { __paletteServerDatabase?: PlannerDatabase };

let testOverride: PlannerDatabase | null | undefined;

export function getServerDatabase(): PlannerDatabase | null {
  if (testOverride !== undefined) return testOverride;
  const config = resolveServerStorageConfig({
    mode: configuredStorageMode,
    databaseUrl: env.DATABASE_URL,
  });
  if (!config) return null;
  cache.__paletteServerDatabase ??= openDatabase(config.databaseUrl).db;
  return cache.__paletteServerDatabase;
}

/**
 * Test-only: route handlers use `db` (e.g. a PGlite database) instead of
 * `DATABASE_URL`; `null` simulates `local` mode; `undefined` restores the
 * default.
 */
export function setServerDatabaseForTesting(
  db: PlannerDatabase | null | undefined,
): void {
  testOverride = db;
}
