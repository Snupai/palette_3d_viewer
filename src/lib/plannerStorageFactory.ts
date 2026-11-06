import { BrowserLocalPlannerStorage } from "~/lib/browserPlanStorage";
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
 * Maps the build mode to its primary record storage. `local` keeps the
 * existing IndexedDB inventory; `server` talks to the same-origin records API.
 * An unreachable server or expired session is an error, never a reason to
 * reroute server-plan saves (ADR 0002). ADR 0010 specifies a separate
 * browser-plan inventory and explicit synchronization in server mode; that
 * inventory is not a fallback and is not constructed by this entry point.
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

/** Explicit browser-plan storage for anonymous editing in server mode (ADR 0010).
 * Callers select this origin deliberately; never use it as a server fallback.
 */
export function createBrowserLocalPlannerStorage(
  options: { indexedDb?: IDBFactory; now?: () => number } = {},
): BrowserLocalPlannerStorage {
  return new BrowserLocalPlannerStorage(options.indexedDb, options.now);
}
