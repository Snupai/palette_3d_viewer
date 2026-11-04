import path from "node:path";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import * as schema from "./schema";

/**
 * PostgreSQL access for the local LAN server (ADR 0009).
 *
 * Driver: `postgres` (postgres.js 3.x) behind `drizzle-orm/postgres-js`. It is
 * pure JavaScript — no native addon — so it runs unchanged in the Next.js Node
 * runtime and under Bun (`bun run db:migrate`). Tests use PGlite through
 * `./testing` with the same schema and migrations. Server-only: never import
 * this module from client components.
 */

/**
 * Driver-independent Drizzle handle. Repositories (#27) and auth (#28) accept
 * this type so they run against both postgres.js and PGlite.
 */
export type PlannerDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface OpenDatabase {
  /** Drizzle query layer with the full schema. */
  readonly db: PlannerDatabase;
  /**
   * Applies pending migrations from `migrationsFolder` (default
   * {@link DEFAULT_MIGRATIONS_FOLDER}); already applied ones are skipped, so
   * this is safe to run on every start.
   */
  migrate(migrationsFolder?: string): Promise<void>;
  /** Closes the connection pool. */
  close(): Promise<void>;
}

export interface OpenDatabaseOptions {
  /** Maximum pooled connections (single host, ADR 0009). */
  readonly maxConnections?: number;
}

/** Folder of generated Drizzle migrations (`bun run db:generate`). */
export const DEFAULT_MIGRATIONS_FOLDER = path.resolve(process.cwd(), "drizzle");

const DEFAULT_MAX_CONNECTIONS = 10;

/**
 * Validates a `DATABASE_URL`: it must be a `postgres://` or `postgresql://`
 * URL. Throws instead of guessing, so a misconfiguration fails at start.
 */
export function assertDatabaseUrl(url: string): string {
  const trimmed = url.trim();
  let protocol: string;
  try {
    protocol = new URL(trimmed).protocol;
  } catch {
    protocol = "";
  }
  if (protocol !== "postgres:" && protocol !== "postgresql:") {
    throw new Error(
      "DATABASE_URL must be a postgres:// or postgresql:// connection URL.",
    );
  }
  return trimmed;
}

/**
 * Opens a lazy connection pool to the PostgreSQL server at `url`. No
 * connection is made until the first query; does not migrate — call
 * `migrate()` or use {@link openMigratedDatabase}.
 */
export function openDatabase(
  url: string,
  options: OpenDatabaseOptions = {},
): OpenDatabase {
  const client = postgres(assertDatabaseUrl(url), {
    max: options.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
    // Migrations emit NOTICEs ("schema already exists"); keep stdout clean.
    onnotice: () => undefined,
  });
  const db = drizzle(client, { schema });
  return {
    db,
    migrate: (migrationsFolder = DEFAULT_MIGRATIONS_FOLDER) =>
      migrate(db, { migrationsFolder }),
    close: () => client.end(),
  };
}

/**
 * Runs `database.migrate()` and closes the database if migrating fails, so a
 * failed start does not leak the pool.
 */
export async function migrateDatabase(
  database: OpenDatabase,
  migrationsFolder?: string,
): Promise<OpenDatabase> {
  try {
    await database.migrate(migrationsFolder);
  } catch (error) {
    await database.close();
    throw error;
  }
  return database;
}

/** Convenience: {@link openDatabase} followed by {@link migrateDatabase}. */
export function openMigratedDatabase(
  url: string,
  options: OpenDatabaseOptions & { readonly migrationsFolder?: string } = {},
): Promise<OpenDatabase> {
  return migrateDatabase(openDatabase(url, options), options.migrationsFolder);
}
