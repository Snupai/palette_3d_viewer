export const PLANNER_DATABASE_NAME = "pallets-db";
export const PLANNER_DATABASE_VERSION = 3;

export const PALLETS_STORE_NAME = "pallets";
export const PROJECTS_STORE_NAME = "projects";
export const PROJECT_RESOURCES_STORE_NAME = "project-resources";
export const PROJECT_QUARANTINE_STORE_NAME = "project-quarantine";

export type PlannerStoreName =
  | typeof PALLETS_STORE_NAME
  | typeof PROJECTS_STORE_NAME
  | typeof PROJECT_RESOURCES_STORE_NAME
  | typeof PROJECT_QUARANTINE_STORE_NAME;

const databasePromises = new WeakMap<IDBFactory, Promise<IDBDatabase>>();

function ensureIndex(
  store: IDBObjectStore,
  name: string,
  keyPath: string,
): void {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, { unique: false });
  }
}

function ensureStore(
  database: IDBDatabase,
  transaction: IDBTransaction,
  name: PlannerStoreName,
): IDBObjectStore {
  return database.objectStoreNames.contains(name)
    ? transaction.objectStore(name)
    : database.createObjectStore(name, { keyPath: "id" });
}

function upgradeDatabase(request: IDBOpenDBRequest): void {
  const database = request.result;
  const transaction = request.transaction;
  if (!transaction) {
    throw new Error("IndexedDB upgrade transaction is unavailable.");
  }

  const pallets = ensureStore(database, transaction, PALLETS_STORE_NAME);
  ensureIndex(pallets, "createdAt", "createdAt");
  ensureIndex(pallets, "name", "name");

  const projects = ensureStore(database, transaction, PROJECTS_STORE_NAME);
  ensureIndex(projects, "createdAt", "createdAt");
  ensureIndex(projects, "updatedAt", "updatedAt");
  ensureIndex(projects, "projectNumber", "projectNumber");
  ensureIndex(projects, "productNumber", "productNumber");

  const resources = ensureStore(
    database,
    transaction,
    PROJECT_RESOURCES_STORE_NAME,
  );
  ensureIndex(resources, "kind", "kind");
  ensureIndex(resources, "name", "name");
  ensureIndex(resources, "updatedAt", "updatedAt");

  const quarantine = ensureStore(
    database,
    transaction,
    PROJECT_QUARANTINE_STORE_NAME,
  );
  ensureIndex(quarantine, "sourceStore", "sourceStore");
  ensureIndex(quarantine, "sourceId", "sourceId");
  ensureIndex(quarantine, "quarantinedAt", "quarantinedAt");
}

export function openPlannerDatabase(
  indexedDb: IDBFactory = globalThis.indexedDB,
): Promise<IDBDatabase> {
  if (!indexedDb) {
    return Promise.reject(
      new Error("IndexedDB is unavailable in the current environment."),
    );
  }
  const existing = databasePromises.get(indexedDb);
  if (existing) return existing;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDb.open(
      PLANNER_DATABASE_NAME,
      PLANNER_DATABASE_VERSION,
    );
    let settled = false;
    const clearCachedPromise = () => {
      if (databasePromises.get(indexedDb) === promise) {
        databasePromises.delete(indexedDb);
      }
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      clearCachedPromise();
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };

    request.onupgradeneeded = () => {
      try {
        upgradeDatabase(request);
      } catch (cause) {
        try {
          request.transaction?.abort();
        } catch {
          // The original upgrade error is more useful than a secondary abort error.
        }
        fail(cause);
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => {
        database.close();
        clearCachedPromise();
      };
      resolve(database);
    };
    request.onerror = () =>
      fail(request.error ?? new Error("IndexedDB open failed."));
    request.onblocked = () =>
      fail(new Error("IndexedDB open is blocked by another browser tab."));
  });
  databasePromises.set(indexedDb, promise);
  return promise;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

export async function runPlannerTransaction<T>(
  storeNames: PlannerStoreName | readonly PlannerStoreName[],
  mode: IDBTransactionMode,
  operation: (transaction: IDBTransaction) => T | Promise<T>,
  indexedDb: IDBFactory = globalThis.indexedDB,
): Promise<T> {
  const database = await openPlannerDatabase(indexedDb);
  return new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(storeNames, mode);
    } catch (cause) {
      databasePromises.delete(indexedDb);
      reject(cause instanceof Error ? cause : new Error(String(cause)));
      return;
    }

    let operationDone = false;
    let transactionDone = false;
    let settled = false;
    let result: T;

    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };
    const finish = () => {
      if (settled || !operationDone || !transactionDone) return;
      settled = true;
      resolve(result);
    };

    transaction.oncomplete = () => {
      transactionDone = true;
      finish();
    };
    transaction.onerror = () =>
      fail(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () =>
      fail(transaction.error ?? new Error("IndexedDB transaction aborted."));

    let operationResult: T | Promise<T>;
    try {
      operationResult = operation(transaction);
    } catch (cause) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already be inactive; the original error is clearer.
      }
      fail(cause);
      return;
    }

    void Promise.resolve(operationResult)
      .then((value) => {
        result = value;
        operationDone = true;
        finish();
      })
      .catch((cause: unknown) => {
        try {
          transaction.abort();
        } catch {
          // The transaction may already be inactive; the original error is clearer.
        }
        fail(cause);
      });
  });
}
