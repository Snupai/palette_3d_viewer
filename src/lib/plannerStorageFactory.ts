import type { PlannerStoreName } from "~/lib/plannerDatabase";
import {
  IndexedDbPlannerRecordStorage,
  type PlannerRecordStorage,
  type RecordVersion,
  type VersionedRecord,
} from "~/lib/plannerRecordStorage";
import { configuredStorageMode, type StorageMode } from "~/lib/storageMode";

/**
 * Thrown by every operation of the `server` storage until the server client
 * exists. It is deliberately an error, not a reason to use IndexedDB: an
 * unreachable server or an expired session must never switch storage
 * (ADR 0002).
 */
export class ServerStorageNotImplementedError extends Error {
  readonly code = "server-storage-not-implemented";
  readonly mode: StorageMode = "server";

  constructor(
    readonly operation: keyof PlannerRecordStorage,
    readonly storeName: PlannerStoreName,
  ) {
    super(
      `Server storage is not implemented yet (${operation} on "${storeName}").`,
    );
    this.name = "ServerStorageNotImplementedError";
  }
}

/** Placeholder for the LAN server client; rejects instead of falling back. */
export class ServerPlannerRecordStorage implements PlannerRecordStorage {
  async list(storeName: PlannerStoreName): Promise<unknown[]> {
    throw new ServerStorageNotImplementedError("list", storeName);
  }

  async get(storeName: PlannerStoreName): Promise<unknown> {
    throw new ServerStorageNotImplementedError("get", storeName);
  }

  async getVersioned(
    storeName: PlannerStoreName,
  ): Promise<VersionedRecord | undefined> {
    throw new ServerStorageNotImplementedError("getVersioned", storeName);
  }

  async put(storeName: PlannerStoreName): Promise<RecordVersion> {
    throw new ServerStorageNotImplementedError("put", storeName);
  }

  async delete(storeName: PlannerStoreName): Promise<void> {
    throw new ServerStorageNotImplementedError("delete", storeName);
  }
}

export type PlannerStorageConfig = {
  mode: StorageMode;
  /** Only used in `local` mode; defaults to `globalThis.indexedDB`. */
  indexedDb?: IDBFactory;
};

/**
 * The single place that maps the storage mode to a record storage.
 * `local` is the IndexedDB storage exactly as before; `server` never touches
 * IndexedDB.
 */
export function createPlannerRecordStorage(
  config: PlannerStorageConfig = { mode: configuredStorageMode },
): PlannerRecordStorage {
  switch (config.mode) {
    case "local":
      return new IndexedDbPlannerRecordStorage(config.indexedDb);
    case "server":
      return new ServerPlannerRecordStorage();
  }
}
