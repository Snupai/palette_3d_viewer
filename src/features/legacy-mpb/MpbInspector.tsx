"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  DEFAULT_MPB_MAX_INPUT_BYTES,
  inspectMpbV1Envelope,
  type MpbInspectionResult,
} from "~/domain/formats";

function printableUnknown(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return "[Value could not be rendered]";
  }
}

export function MpbInspector() {
  const inputRef = useRef<HTMLInputElement>(null);
  const inspectionRequestRef = useRef(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<MpbInspectionResult | null>(null);
  const [busy, setBusy] = useState(false);

  const inspect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const request = ++inspectionRequestRef.current;
    setBusy(true);
    setFileName(file.name);
    try {
      if (file.size > DEFAULT_MPB_MAX_INPUT_BYTES) {
        if (request === inspectionRequestRef.current) {
          setResult({
            ok: false,
            inspection: null,
            diagnostics: [
              {
                severity: "error",
                phase: "legacy-import",
                code: "input-too-large",
                message: `MPB inspection input is ${file.size} bytes; limit is ${DEFAULT_MPB_MAX_INPUT_BYTES} bytes. The file was not read.`,
                details: {
                  actualBytes: file.size,
                  maximumBytes: DEFAULT_MPB_MAX_INPUT_BYTES,
                },
              },
            ],
          });
        }
        return;
      }
      const nextResult = inspectMpbV1Envelope(await file.arrayBuffer());
      if (request === inspectionRequestRef.current) setResult(nextResult);
    } catch (cause) {
      if (request !== inspectionRequestRef.current) return;
      setResult({
        ok: false,
        inspection: null,
        diagnostics: [
          {
            severity: "error",
            phase: "legacy-import",
            code: "malformed-mpb-payload",
            message:
              cause instanceof Error
                ? `MPB inspection failed safely: ${cause.message}`
                : "MPB inspection failed safely.",
          },
        ],
      });
    } finally {
      if (request === inspectionRequestRef.current) setBusy(false);
    }
  };

  return (
    <section
      className="grid gap-3 border border-zinc-800 bg-zinc-900 p-3"
      data-testid="mpb-inspector"
    >
      <header className="border-b border-zinc-800 pb-3">
        <h2 className="text-sm font-semibold text-zinc-100">
          Read-only .mpb diagnostics
        </h2>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-zinc-500">
          Only the documented internal synthetic MPB v1 envelope is inspected.
          Arbitrary proprietary MultiPack files are not decoded, compatibility
          is not claimed, and no .mpb writer is available.
        </p>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".mpb,application/octet-stream"
          onChange={(event) => void inspect(event)}
          className="hidden"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 focus:ring-2 focus:ring-amber-400/30 focus:outline-none disabled:cursor-not-allowed disabled:text-zinc-600"
        >
          {busy ? "Inspecting…" : "Choose .mpb for safe inspection"}
        </button>
        <span className="text-xs text-zinc-500">
          {fileName ?? "No file selected"}
        </span>
      </div>

      {result ? (
        <div className="grid gap-3">
          <section className="border border-zinc-800">
            <h3 className="border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300">
              Inspection status
            </h3>
            <dl className="grid grid-cols-[180px_minmax(0,1fr)] gap-x-3 gap-y-1 p-3 text-xs">
              <dt className="text-zinc-500">Accepted envelope</dt>
              <dd className={result.ok ? "text-emerald-300" : "text-red-300"}>
                {result.ok ? "Yes" : "No"}
              </dd>
              <dt className="text-zinc-500">Verification</dt>
              <dd className="font-semibold text-amber-200">
                {result.ok
                  ? result.inspection.verification
                  : "unverified / rejected"}
              </dd>
              <dt className="text-zinc-500">Writer supported</dt>
              <dd className="text-zinc-300">No</dd>
              <dt className="text-zinc-500">Format</dt>
              <dd className="font-mono text-zinc-300">
                {result.ok
                  ? result.inspection.format
                  : "unrecognized or invalid"}
              </dd>
            </dl>
          </section>

          {result.ok ? (
            <>
              <section className="border border-zinc-800">
                <h3 className="border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300">
                  Known fields (decoded, external compatibility unverified)
                </h3>
                <pre className="scrollbar-thin max-h-[360px] overflow-auto p-3 text-xs leading-5 whitespace-pre-wrap text-zinc-300">
                  {printableUnknown(result.inspection.knownFields)}
                </pre>
              </section>

              <section className="border border-zinc-800">
                <h3 className="border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300">
                  Unknown / unverified fields
                </h3>
                {result.inspection.unknownFields.length === 0 ? (
                  <p className="p-3 text-xs text-zinc-500">
                    No unknown JSON fields were present in the synthetic
                    envelope.
                  </p>
                ) : (
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="text-zinc-500">
                      <tr>
                        <th className="border-b border-zinc-800 px-3 py-2 font-medium">
                          Path
                        </th>
                        <th className="border-b border-zinc-800 px-3 py-2 font-medium">
                          Retained value
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.inspection.unknownFields.map((field, index) => (
                        <tr
                          key={`${field.path}-${index}`}
                          className="border-b border-zinc-800 last:border-b-0"
                        >
                          <td className="px-3 py-2 font-mono text-amber-200">
                            {field.path}
                          </td>
                          <td className="px-3 py-2">
                            <pre className="whitespace-pre-wrap text-zinc-300">
                              {printableUnknown(field.value)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>

              <section className="border border-zinc-800">
                <h3 className="border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300">
                  Trailing bytes
                </h3>
                <dl className="grid grid-cols-[180px_minmax(0,1fr)] gap-x-3 gap-y-1 p-3 text-xs">
                  <dt className="text-zinc-500">Count</dt>
                  <dd className="font-mono text-zinc-300">
                    {result.inspection.trailingByteCount}
                  </dd>
                  <dt className="text-zinc-500">Diagnostic hex prefix</dt>
                  <dd className="font-mono break-all text-zinc-300">
                    {result.inspection.trailingBytesHex ?? "None"}
                  </dd>
                </dl>
              </section>
            </>
          ) : null}

          <section className="border border-zinc-800">
            <h3 className="border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300">
              Diagnostics
            </h3>
            <ul className="grid gap-2 p-3">
              {result.diagnostics.map((diagnostic, index) => (
                <li
                  key={`${diagnostic.code}-${index}`}
                  className={
                    diagnostic.severity === "error"
                      ? "text-xs leading-5 text-red-200"
                      : "text-xs leading-5 text-amber-200"
                  }
                >
                  <span className="font-mono text-[10px] text-zinc-500">
                    {diagnostic.code}
                  </span>
                  <br />
                  {diagnostic.message}
                </li>
              ))}
              {result.diagnostics.length === 0 ? (
                <li className="text-xs text-zinc-500">
                  No additional diagnostics.
                </li>
              ) : null}
            </ul>
          </section>
        </div>
      ) : (
        <p className="border border-dashed border-zinc-800 p-3 text-xs text-zinc-600">
          Select a file to inspect size, synthetic envelope version, known
          fields, unknown fields, and trailing bytes without writing project
          data.
        </p>
      )}
    </section>
  );
}
