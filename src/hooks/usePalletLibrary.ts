"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  CURRENT_PALLET_SCHEMA_VERSION,
  formatPalletStorageIssues,
  parseLegacyPalletJson,
} from "~/lib/palletPersistence";
import { formatImportDiagnostics, parsePalletFiles } from "~/lib/palletImport";
import type { PalletData, SavedPallet } from "~/lib/palletTypes";
import { parseRobText, serializeRobText } from "~/lib/robParser";
import {
  clearPallets,
  deletePalletById,
  getAllPallets,
  putPallets,
} from "~/lib/storage";

const STORAGE_KEY = "saved_pallets_v1";

/**
 * Re-parse from raw .rob when present so entries saved by an older parser pick
 * up newer fields. Optional fields like `trailingZwischenlage` pass storage
 * validation when absent, so the persisted `data` alone can be stale.
 */
export function resolvePalletData(
  entry: Pick<SavedPallet, "data" | "rawText">,
): PalletData {
  if (entry.rawText) {
    try {
      return parseRobText(entry.rawText);
    } catch {
      return entry.data;
    }
  }
  try {
    return parseRobText(serializeRobText(entry.data));
  } catch {
    return entry.data;
  }
}

export function usePalletLibrary() {
  const [saved, setSaved] = useState<SavedPallet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStoredPallets = useCallback(async () => {
    const result = await getAllPallets();
    if (result.repaired.length > 0) await putPallets(result.repaired);
    return result;
  }, []);

  const refresh = useCallback(async (): Promise<SavedPallet[]> => {
    const result = await loadStoredPallets();
    const warning = formatPalletStorageIssues(result.issues);
    if (warning) setError(warning);
    setSaved(result.pallets);
    return result.pallets;
  }, [loadStoredPallets]);

  useEffect(() => {
    void (async () => {
      try {
        const stored = await loadStoredPallets();
        let existing = stored.pallets;
        let warning = formatPalletStorageIssues(stored.issues);

        if (existing.length === 0) {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const migrated = parseLegacyPalletJson(raw);
            warning = formatPalletStorageIssues(migrated.issues) ?? warning;
            if (!migrated.parsed) {
              setError(
                warning ??
                  "Unable to migrate saved pallets from legacy storage.",
              );
              return;
            }
            if (migrated.pallets.length > 0) {
              await putPallets(migrated.pallets);
            }
            localStorage.removeItem(STORAGE_KEY);
            existing = [...migrated.pallets].sort(
              (a, b) => b.createdAt - a.createdAt,
            );
          }
        }

        setSaved(existing);
        setSelectedId(existing[0]?.id ?? null);
        if (warning) setError(warning);
      } catch (cause) {
        console.error("Failed to load saved pallets", cause);
        setError("Unable to load saved pallets from browser storage.");
      }
    })();
  }, [loadStoredPallets]);

  const selectedEntry = useMemo(
    () => saved.find((pallet) => pallet.id === selectedId) ?? null,
    [saved, selectedId],
  );

  const onFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      setError(null);
      const files = event.target.files ? Array.from(event.target.files) : [];
      try {
        if (files.length === 0) return;
        const importResult = await parsePalletFiles(files);
        const createdAt = Date.now();
        const newEntries: SavedPallet[] = importResult.parsed.map(
          ({ name, data, rawText }, index) => ({
            schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
            id:
              globalThis.crypto?.randomUUID?.() ??
              `${createdAt}-${index}-${Math.random().toString(36).slice(2, 8)}`,
            name,
            createdAt,
            data,
            rawText,
            originalRawText: rawText,
          }),
        );

        if (newEntries.length > 0) {
          await putPallets(newEntries);
          await refresh();
          setSelectedId(newEntries.at(-1)!.id);
        }
        const diagnosticMessage = formatImportDiagnostics(
          importResult.diagnostics,
        );
        if (diagnosticMessage) setError(diagnosticMessage);
      } catch (cause) {
        console.error("Failed to import pallet files", cause);
        setError("Unable to save imported pallets to browser storage.");
      } finally {
        event.target.value = "";
      }
    },
    [refresh],
  );

  const savePallet = useCallback(async (entry: SavedPallet) => {
    try {
      await putPallets([entry]);
      setSaved((current) =>
        current.map((pallet) => (pallet.id === entry.id ? entry : pallet)),
      );
      return true;
    } catch (cause) {
      console.error("Failed to save pallet", cause);
      setError("Unable to save changes. The current edits remain unsaved.");
      return false;
    }
  }, []);

  const deletePallet = useCallback(
    async (id: string) => {
      try {
        await deletePalletById(id);
        const next = await refresh();
        setSelectedId((current) =>
          current === id ? (next[0]?.id ?? null) : current,
        );
        return true;
      } catch (cause) {
        console.error("Failed to delete pallet", cause);
        setError("Unable to delete the saved pallet.");
        return false;
      }
    },
    [refresh],
  );

  const clearLibrary = useCallback(async () => {
    try {
      await clearPallets();
      setSaved([]);
      setSelectedId(null);
      return true;
    } catch (cause) {
      console.error("Failed to clear pallets", cause);
      setError("Unable to clear saved pallets.");
      return false;
    }
  }, []);

  return {
    saved,
    selectedId,
    selectedEntry,
    selectPallet: setSelectedId,
    error,
    setError,
    fileInputRef,
    onFileChange,
    savePallet,
    deletePallet,
    clearLibrary,
  };
}
