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
/** Server-only SQLite database path (ADR 0001); required in `server` mode. */
export const DATABASE_PATH_ENV_VAR = "PALETTE_DB_PATH";

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
  databasePath: string;
};

/**
 * Server-side view of the storage config. Returns `null` in `local` mode
 * (the server keeps no plan data) and fails loudly when `server` mode lacks a
 * database path instead of guessing one.
 */
export function resolveServerStorageConfig(input: {
  mode: StorageMode;
  databasePath: string | undefined;
}): ServerStorageConfig | null {
  if (input.mode === "local") return null;
  const databasePath = input.databasePath?.trim() ?? "";
  if (databasePath === "") {
    throw new StorageConfigError(
      `${STORAGE_MODE_ENV_VAR}=server requires ${DATABASE_PATH_ENV_VAR} to point at the SQLite database file.`,
    );
  }
  return { mode: "server", databasePath };
}
