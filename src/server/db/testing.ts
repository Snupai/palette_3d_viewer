import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { DEFAULT_MIGRATIONS_FOLDER, type OpenDatabase } from "./database";
import * as schema from "./schema";

/**
 * Test-only: an in-process PostgreSQL (PGlite) with the same schema and
 * migrations as production (ADR 0009), so server tests need no container.
 * Each call is an isolated, empty database; `close()` discards it.
 */
export function openTestDatabase(): OpenDatabase {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  return {
    db,
    migrate: (migrationsFolder = DEFAULT_MIGRATIONS_FOLDER) =>
      migrate(db, { migrationsFolder }),
    close: () => client.close(),
  };
}

/** {@link openTestDatabase} with all migrations applied. */
export async function openMigratedTestDatabase(): Promise<OpenDatabase> {
  const database = openTestDatabase();
  await database.migrate();
  return database;
}
