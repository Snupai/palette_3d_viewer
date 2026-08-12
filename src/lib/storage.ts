import {
  PALLETS_STORE_NAME,
  requestToPromise,
  runPlannerTransaction,
} from "~/lib/plannerDatabase";
import {
  savedPalletSchema,
  validateStoredPallets,
  type PalletStorageLoadResult,
} from "~/lib/palletPersistence";
import type { SavedPallet } from "~/lib/palletTypes";

function withPalletStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T> {
  return runPlannerTransaction(PALLETS_STORE_NAME, mode, (transaction) =>
    operation(transaction.objectStore(PALLETS_STORE_NAME)),
  );
}

export async function getAllPallets(): Promise<PalletStorageLoadResult> {
  const rows = await withPalletStore<unknown[]>("readonly", (store) =>
    requestToPromise(store.getAll()),
  );
  const result = validateStoredPallets(rows);
  result.pallets.sort((a, b) => b.createdAt - a.createdAt);
  return result;
}

export async function putPallets(entries: SavedPallet[]): Promise<void> {
  if (entries.length === 0) return;
  const validated = entries.map((entry) => savedPalletSchema.parse(entry));
  await withPalletStore("readwrite", (store) => {
    validated.forEach((entry) => store.put(entry));
  });
}

export async function deletePalletById(id: string): Promise<void> {
  await withPalletStore("readwrite", (store) => {
    store.delete(id);
  });
}

export async function clearPallets(): Promise<void> {
  await withPalletStore("readwrite", (store) => {
    store.clear();
  });
}

export async function countPallets(): Promise<number> {
  return withPalletStore("readonly", (store) =>
    requestToPromise(store.count()),
  );
}
