"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { parseRobText, serializeRobText } from "~/lib/robParser";
import type { PalletData, SavedPallet } from "~/lib/palletTypes";
import {
  clearPallets,
  deletePalletById,
  getAllPallets,
  putPallets,
} from "~/lib/storage";

const STORAGE_KEY = "saved_pallets_v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSavedPallet(value: unknown): value is SavedPallet {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.createdAt === "number" &&
    Number.isFinite(value.createdAt) &&
    isRecord(value.data)
  );
}

function parseMigratedPallets(raw: string): SavedPallet[] | null {
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) && parsed.every(isSavedPallet) ? parsed : null;
}

/** Re-parse from raw .rob when present so newer parser fields are available. */
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

  const refresh = useCallback(async (): Promise<SavedPallet[]> => {
    const next = await getAllPallets<PalletData>();
    setSaved(next);
    return next;
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        let existing = await getAllPallets<PalletData>();
        if (existing.length === 0) {
          const raw = localStorage.getItem(STORAGE_KEY);
          if (raw) {
            const migrated = parseMigratedPallets(raw);
            if (!migrated) {
              setError(
                "Unable to migrate saved pallets: stored data is invalid.",
              );
              return;
            }
            await putPallets<PalletData>(migrated);
            localStorage.removeItem(STORAGE_KEY);
            existing = await getAllPallets<PalletData>();
          }
        }
        setSaved(existing);
        setSelectedId(existing[0]?.id ?? null);
      } catch (cause) {
        console.error("Failed to load saved pallets", cause);
        setError("Unable to load saved pallets from browser storage.");
      }
    })();
  }, []);

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
        const newEntries: SavedPallet[] = [];
        const failed: string[] = [];

        for (const file of files) {
          try {
            const text = await file.text();
            const data = parseRobText(text);
            newEntries.push({
              id:
                globalThis.crypto?.randomUUID?.() ??
                `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name: file.name ?? `Pallet ${new Date().toLocaleString()}`,
              createdAt: Date.now(),
              data,
              rawText: text,
              originalRawText: text,
            });
          } catch {
            failed.push(file.name);
          }
        }

        if (newEntries.length > 0) {
          await putPallets<PalletData>(newEntries);
          await refresh();
          setSelectedId(newEntries.at(-1)!.id);
        }
        if (failed.length > 0) {
          setError(`Failed to parse: ${failed.join(", ")}`);
        }
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
      await putPallets<PalletData>([entry]);
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
