import {
  IndexedDbPlannerRecordStorage,
  type PlannerRecordStorage,
} from "~/lib/plannerRecordStorage";
import { ServerPlannerRecordStorage } from "~/lib/serverPlannerRecordStorage";
import { configuredStorageMode, type StorageMode } from "~/lib/storageMode";

export type PlannerStorageConfig = {
  mode: StorageMode;
  /** Only used in `local` mode; defaults to `globalThis.indexedDB`. */
  indexedDb?: IDBFactory;
  /** Only used in `server` mode; defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
};

/**
 * The single place that maps the storage mode to a record storage.
 * `local` is the IndexedDB storage exactly as before; `server` talks to the
 * records API of the same origin and never touches IndexedDB — an
 * unreachable server or an expired session is an error, not a reason to
 * switch storage (ADR 0002).
 */
export function createPlannerRecordStorage(
  config: PlannerStorageConfig = { mode: configuredStorageMode },
): PlannerRecordStorage {
  switch (config.mode) {
    case "local":
      return new IndexedDbPlannerRecordStorage(config.indexedDb);
    case "server":
      return new ServerPlannerRecordStorage({ fetch: config.fetch });
  }
}
