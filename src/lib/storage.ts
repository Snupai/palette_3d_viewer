// Lightweight IndexedDB helper for storing many pallets without localStorage quota issues

const DB_NAME = "pallets-db";
const DB_VERSION = 1;
const STORE_NAME = "pallets";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt", { unique: false });
        store.createIndex("name", "name", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => T | Promise<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    Promise.resolve(fn(store))
      .then((result) => {
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
      .catch(reject);
  });
}

export async function getAllPallets<T = any>(): Promise<T[]> {
  return withStore("readonly", (store) => {
    return new Promise<T[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = (req.result as T[]) ?? [];
        // Sort newest first
        rows.sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
        resolve(rows);
      };
      req.onerror = () => reject(req.error);
    });
  });
}

export async function putPallets<T = any>(entries: T[]): Promise<void> {
  if (!entries || entries.length === 0) return;
  await withStore("readwrite", (store) => {
    for (const entry of entries) store.put(entry);
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
      const req = store.count();
      req.onsuccess = () => resolve(req.result ?? 0);
      req.onerror = () => reject(req.error);
    });
  });
}


