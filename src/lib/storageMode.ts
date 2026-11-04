import { z } from "zod";
import { env } from "~/env";

/**
 * Explicit storage mode (ADR 0002): the app uses either the browser's
 * IndexedDB (`local`) or the configured LAN server (`server`) — never both and
 * never a silent switch between them.
 */
export const STORAGE_MODES = ["local", "server"] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];
export const DEFAULT_STORAGE_MODE: StorageMode = "local";

/** Build-time switch, inlined into the client bundle. */
export const STORAGE_MODE_ENV_VAR = "NEXT_PUBLIC_PALETTE_STORAGE_MODE";
/** Server-only PostgreSQL connection URL (ADR 0009); required in `server` mode. */
export const DATABASE_URL_ENV_VAR = "DATABASE_URL";
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export const storageModeSchema = z.enum(STORAGE_MODES);

/** The mode this build was configured with; `local` when unset. */
export const configuredStorageMode: StorageMode =
  env.NEXT_PUBLIC_PALETTE_STORAGE_MODE ?? DEFAULT_STORAGE_MODE;

export class StorageConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageConfigError";
  }
}

export type ServerStorageConfig = {
  mode: "server";
  databaseUrl: string;
};

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return POSTGRES_PROTOCOLS.has(url.protocol) && url.hostname !== "";
  } catch {
    return false;
  }
}

/**
 * Server-side view of the storage config. Returns `null` in `local` mode
 * (the server keeps no plan data) and fails loudly when `server` mode lacks a
 * PostgreSQL URL instead of guessing one. Error messages never echo the URL,
 * which carries the database password.
 */
export function resolveServerStorageConfig(input: {
  mode: StorageMode;
  databaseUrl: string | undefined;
}): ServerStorageConfig | null {
  if (input.mode === "local") return null;
  const databaseUrl = input.databaseUrl?.trim() ?? "";
  if (databaseUrl === "") {
    throw new StorageConfigError(
      `${STORAGE_MODE_ENV_VAR}=server requires ${DATABASE_URL_ENV_VAR} (a postgres:// or postgresql:// connection URL).`,
    );
  }
  if (!isPostgresUrl(databaseUrl)) {
    throw new StorageConfigError(
      `${DATABASE_URL_ENV_VAR} must be a postgres:// or postgresql:// URL.`,
    );
  }
  return { mode: "server", databaseUrl };
}
