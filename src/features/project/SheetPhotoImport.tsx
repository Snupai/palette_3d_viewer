"use client";

import { useEffect, useRef, useState } from "react";
import type { SheetIssue } from "~/domain/sheetExtraction";
import { requestSheetExtraction } from "~/features/project/sheetImport";
import type { SheetExtractionResult } from "~/lib/sheetExtraction/ollamaSheetExtractor";

export type SheetPhotoImportProps = {
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onExtracted: (result: SheetExtractionResult) => void;
};

const severityClass: Record<SheetIssue["severity"], string> = {
  error: "text-[var(--danger)]",
  warning: "text-[var(--ink)]",
  info: "text-[var(--muted)]",
};

const severityLabel: Record<SheetIssue["severity"], string> = {
  error: "Fix",
  warning: "Check",
  info: "Note",
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
 * to the dialog. Every value stays editable; issues tell the user what to verify.
 */
export function SheetPhotoImport({
  disabled = false,
  onBusyChange,
  onExtracted,
}: SheetPhotoImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SheetExtractionResult | null>(null);

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

  const read = async (file: File) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhotoUrl(URL.createObjectURL(file));
    setError(null);
    setResult(null);
    setBusyState(true);
    try {
      const extracted = await requestSheetExtraction(file, controller.signal);
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
    <fieldset className="grid gap-3 border border-[var(--line)] p-4">
      <legend className="px-1 text-sm font-semibold text-[var(--ink)]">
        From sheet photo
      </legend>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void read(file);
          }}
        />
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="ui-btn cursor-pointer px-3 py-2 text-sm disabled:cursor-wait disabled:opacity-50"
        >
          {busy
            ? "Reading sheet…"
            : photoUrl
              ? "Take another photo"
              : "Take or choose photo"}
        </button>
        <span className="text-xs text-[var(--muted)]">
          Read locally on this machine. Values below are a suggestion — check
          them against the sheet.
        </span>
      </div>

      {photoUrl || error ? (
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
            <img
              src={photoUrl}
              alt="Photographed pallet sheet"
              className="max-h-56 w-full border border-[var(--line)] object-contain"
            />
          ) : null}
          <div className="grid content-start gap-2 text-sm">
            {error ? (
              <div role="alert" className="text-[var(--danger)]">
                {error}
              </div>
            ) : null}
            {busy ? (
              <div className="text-[var(--muted)]">
                The local model is reading the sheet. This can take up to a
                minute.
              </div>
            ) : null}
            {sheet && result ? (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-[var(--muted)]">Product</dt>
                  <dd>
                    {[sheet.productName, sheet.productNumber, sheet.cartonId]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </dd>
                  <dt className="text-[var(--muted)]">Carton</dt>
                  <dd>{dims(sheet.cartonMm)} mm</dd>
                  <dt className="text-[var(--muted)]">Block</dt>
                  <dd>{dims(sheet.blockMm)} mm</dd>
                  <dt className="text-[var(--muted)]">Pallet</dt>
                  <dd>{dims(sheet.palletMm)} mm</dd>
                  <dt className="text-[var(--muted)]">Layers</dt>
                  <dd>
                    {sheet.cartonsPerLayer ?? "?"} per layer ×{" "}
                    {sheet.layers ?? "?"} layers ={" "}
                    {sheet.cartonsPerPallet ?? "?"} cartons
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
                  <div className="text-xs text-[var(--ok)]">
                    All consistency checks passed.
                  </div>
                )}
                <div className="text-[11px] text-[var(--muted)]">
                  {result.model} · {(result.durationMs / 1000).toFixed(1)} s
                  {result.attempts > 1 ? ` · ${result.attempts} attempts` : ""}
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
