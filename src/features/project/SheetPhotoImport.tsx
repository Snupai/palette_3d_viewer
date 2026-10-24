"use client";

import { useEffect, useRef, useState } from "react";
import type { SheetIssue } from "~/domain/sheetExtraction";
import { requestSheetExtraction } from "~/features/project/sheetImport";
import { scanDocument } from "~/lib/sheetExtraction/documentScan";
import type { SheetExtractionResult } from "~/lib/sheetExtraction/ollamaSheetExtractor";

export type SheetPhotoImportProps = {
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onExtracted: (result: SheetExtractionResult) => void;
};

const severityClass: Record<SheetIssue["severity"], string> = {
  error: "text-danger",
  warning: "text-ink",
  info: "text-muted",
};

const severityLabel: Record<SheetIssue["severity"], string> = {
  error: "Korrigieren",
  warning: "Prüfen",
  info: "Hinweis",
};

function dims(
  value: { length: number; width: number; height?: number } | null,
) {
  if (!value) return "—";
  return [value.length, value.width, value.height]
    .filter((part) => part !== undefined && part > 0)
    .join(" × ");
}

/**
 * Reads a photographed pallet sheet with the local model and hands the result
 * to the form. Every value stays editable; issues tell the user what to verify.
 */
export function SheetPhotoImport({
  disabled = false,
  onBusyChange,
  onExtracted,
}: SheetPhotoImportProps) {
  // Two inputs: `capture` forces the phone camera and skips the gallery,
  // so the library picker needs an input without it.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SheetExtractionResult | null>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [scan, setScan] = useState<"scanning" | "cut" | "uncut" | "raw" | null>(
    null,
  );

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl],
  );

  const setBusyState = (next: boolean) => {
    setBusy(next);
    onBusyChange?.(next);
  };

  /**
   * Cuts the sheet out of the photo (perspective-corrected, scanner look)
   * before sending it, unless the user asked for the untouched photo.
   */
  const read = async (file: File, mode: "scan" | "raw") => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setOriginal(file);
    setPhotoUrl(URL.createObjectURL(file));
    setError(null);
    setResult(null);
    setScan(mode === "scan" ? "scanning" : "raw");
    setBusyState(true);
    try {
      let upload = file;
      if (mode === "scan") {
        const scanned = await scanDocument(file);
        if (controller.signal.aborted) return;
        setScan(scanned.detected ? "cut" : "uncut");
        if (scanned.detected) {
          upload = new File([scanned.blob], "sheet.jpg", {
            type: "image/jpeg",
          });
          setPhotoUrl(URL.createObjectURL(upload));
        }
      }
      const extracted = await requestSheetExtraction(upload, controller.signal);
      if (controller.signal.aborted) return;
      setResult(extracted);
      onExtracted(extracted);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (abortRef.current === controller) setBusyState(false);
    }
  };

  const sheet = result?.sheet;

  return (
    <fieldset className="border-line bg-surface grid gap-3 border p-4">
      <legend className="text-ink px-1 text-sm font-semibold">
        Aus Palettenblatt-Foto
      </legend>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void read(file, "scan");
          }}
        />
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void read(file, "scan");
          }}
        />
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => cameraInputRef.current?.click()}
          className="ui-btn cursor-pointer px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-50"
        >
          {busy
            ? scan === "scanning"
              ? "Blatt wird zugeschnitten …"
              : "Blatt wird gelesen …"
            : photoUrl
              ? "Neues Foto aufnehmen"
              : "Foto aufnehmen"}
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => libraryInputRef.current?.click()}
          className="ui-btn cursor-pointer px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-50"
        >
          Aus Galerie wählen
        </button>
        <span className="fw-note">
          Wird lokal auf dem eigenen Server gelesen. Die Werte sind ein
          Vorschlag und müssen mit dem Blatt abgeglichen werden.
        </span>
      </div>

      {photoUrl || error ? (
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img
              src={photoUrl}
              alt="Fotografiertes Palettenblatt"
              className="border-line max-h-56 w-full border object-contain"
            />
          ) : null}
          <div className="grid content-start gap-2 text-sm">
            {error ? (
              <div role="alert" className="text-danger">
                {error}
              </div>
            ) : null}
            {busy && scan === "scanning" ? (
              <div className="text-muted">
                Das Blatt wird im Foto gesucht, zugeschnitten und begradigt.
              </div>
            ) : busy ? (
              <div className="text-muted">
                Das lokale Modell liest das Blatt. Das kann bis zu einer Minute
                dauern.
              </div>
            ) : null}
            {!busy && scan === "uncut" ? (
              <div className="text-muted text-xs">
                Kein Blattrand erkannt, das Originalfoto wurde verwendet.
              </div>
            ) : null}
            {!busy && scan === "cut" && original ? (
              <div className="text-muted text-xs">
                Zugeschnitten und begradigt. Falsch getroffen?{" "}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => void read(original, "raw")}
                  className="text-ink cursor-pointer underline"
                >
                  Originalfoto lesen
                </button>
              </div>
            ) : null}
            {sheet && result ? (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-muted">Produkt</dt>
                  <dd>
                    {[sheet.productName, sheet.productNumber, sheet.cartonId]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </dd>
                  <dt className="text-muted">Karton</dt>
                  <dd>{dims(sheet.cartonMm)} mm</dd>
                  <dt className="text-muted">Block</dt>
                  <dd>{dims(sheet.blockMm)} mm</dd>
                  <dt className="text-muted">Palette</dt>
                  <dd>{dims(sheet.palletMm)} mm</dd>
                  <dt className="text-muted">Lagen</dt>
                  <dd>
                    {sheet.cartonsPerLayer ?? "?"} je Lage ×{" "}
                    {sheet.layers ?? "?"} Lagen ={" "}
                    {sheet.cartonsPerPallet ?? "?"} Kartons
                  </dd>
                </dl>
                {result.issues.length > 0 ? (
                  <ul className="grid gap-0.5 text-xs">
                    {result.issues.map((issue, index) => (
                      <li key={index} className={severityClass[issue.severity]}>
                        <span className="font-semibold">
                          {severityLabel[issue.severity]}:
                        </span>{" "}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-ok text-xs">
                    Alle Plausibilitätsprüfungen bestanden.
                  </div>
                )}
                <div className="text-muted text-[11px]">
                  {result.model} · {(result.durationMs / 1000).toFixed(1)} s
                  {result.attempts > 1 ? ` · ${result.attempts} Versuche` : ""}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
