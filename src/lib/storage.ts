import {
  savedPalletSchema,
  validateStoredPallets,
  type PalletStorageLoadResult,
} from "~/lib/palletPersistence";
import type { SavedPallet } from "~/lib/palletTypes";

const DB_NAME = "pallets-db";
const DB_VERSION = 2;
const STORE_NAME = "pallets";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(STORE_NAME)
        ? request.transaction!.objectStore(STORE_NAME)
        : db.createObjectStore(STORE_NAME, { keyPath: "id" });
      if (!store.indexNames.contains("createdAt")) {
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
      if (!store.indexNames.contains("name")) {
        store.createIndex("name", "name", { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error("IndexedDB open failed"));
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error("IndexedDB open blocked"));
    };
  });

  return dbPromise;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const succeed = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let tx: IDBTransaction;
    try {
      tx = db.transaction(STORE_NAME, mode);
    } catch (error) {
      dbPromise = null;
      fail(error);
      return;
    }

    const store = tx.objectStore(STORE_NAME);
    let result: T;

    tx.oncomplete = () => succeed(result);
    tx.onerror = () => fail(tx.error ?? new Error("IndexedDB tx error"));
    tx.onabort = () => fail(tx.error ?? new Error("IndexedDB tx aborted"));

    void Promise.resolve(fn(store))
      .then((value) => {
        result = value;
      })
      .catch(fail);
  });
}

export async function getAllPallets(): Promise<PalletStorageLoadResult> {
  const rows = await withStore<unknown[]>("readonly", (store) => {
    return new Promise<unknown[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB getAll failed"));
    });
  });
  const result = validateStoredPallets(rows);
  result.pallets.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

export async function putPallets(entries: SavedPallet[]): Promise<void> {
  if (entries.length === 0) return;
  const validated = entries.map((entry) => savedPalletSchema.parse(entry));
  await withStore("readwrite", (store) => {
    validated.forEach((entry) => store.put(entry));
  });
}

export async function deletePalletById(id: string): Promise<void> {
  await withStore("readwrite", (store) => {
    store.delete(id);
  });
}

export async function clearPallets(): Promise<void> {
  await withStore("readwrite", (store) => {
    store.clear();
  });
}

export async function countPallets(): Promise<number> {
  return withStore("readonly", (store) => {
    return new Promise<number>((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result ?? 0);
      request.onerror = () =>
        reject(request.error ?? new Error("IndexedDB count failed"));
    });
  });
}
