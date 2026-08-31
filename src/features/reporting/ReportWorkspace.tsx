"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RobViewer,
  type RobViewerHandle,
  type RobViewerReportCaptureResult,
} from "~/components/RobViewer";
import { LayerPattern } from "~/components/LayerPattern";
import type { PalletData } from "~/domain/palletTypes";
import type { Project } from "~/domain/project/projectSchema";
import type { RobotCycleMaterialization } from "~/domain/robotics";
import {
  createPlanningReportModel,
  type PlanningReportCapture,
} from "~/features/reporting/reportModel";

export type ReportWorkspaceProps = {
  project: Project;
  materialization: RobotCycleMaterialization;
  previewData: PalletData | null;
};

function metricValue(value: number | null, unit: string): string {
  if (value === null) return "Unknown";
  const digits = Number.isInteger(value) ? 0 : 2;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} ${unit}`;
}

function captureFromViewer(
  result: RobViewerReportCaptureResult,
  fallbackLayerIndex: number,
): PlanningReportCapture {
  if (result.status === "captured") {
    return {
      status: "captured",
      dataUrl: result.dataUrl,
      width: result.width,
      height: result.height,
      cameraPreset: "right-top",
      provenance:
        "Captured from the shared 3D viewer with the fixed right-top camera preset.",
    };
  }
  return {
    status: "fallback",
    reason: result.reason,
    message: result.message,
    fallbackLayerIndex,
  };
}

export function ReportWorkspace({
  project,
  materialization,
  previewData,
}: ReportWorkspaceProps) {
  const viewerRef = useRef<RobViewerHandle>(null);
  const captureRequestRef = useRef(0);
  const [capture, setCapture] = useState<PlanningReportCapture | undefined>();
  const [capturePending, setCapturePending] = useState(false);
  const fallbackLayerIndex = Math.max(0, (previewData?.layer_count ?? 1) - 1);

  const captureFixedView = useCallback(async () => {
    if (!previewData || previewData.layer_count === 0) return;
    const request = ++captureRequestRef.current;
    setCapturePending(true);
    try {
      const result = (await viewerRef.current?.captureReportFrame({
        width: 1_200,
        height: 800,
        cameraPreset: "right-top",
        fallbackLayerIndex,
      })) ?? {
        status: "fallback" as const,
        reason: "viewer-unavailable" as const,
        fallback: "layer-pattern-svg" as const,
        message:
          "The 3D viewer is not ready; the deterministic layer-pattern SVG is used instead.",
        layerPattern: null,
      };
      if (request === captureRequestRef.current) {
        setCapture(captureFromViewer(result, fallbackLayerIndex));
      }
    } finally {
      if (request === captureRequestRef.current) setCapturePending(false);
    }
  }, [fallbackLayerIndex, previewData]);

  useEffect(() => {
    captureRequestRef.current += 1;
    setCapture(undefined);
    setCapturePending(false);
    if (!previewData || previewData.layer_count === 0) return;
    const timeout = window.setTimeout(() => void captureFixedView(), 250);
    return () => {
      window.clearTimeout(timeout);
      captureRequestRef.current += 1;
    };
  }, [captureFixedView, previewData]);

  const report = useMemo(
    () =>
      createPlanningReportModel({
        project,
        materialization,
        previewData,
        ...(capture ? { capture } : {}),
      }),
    [capture, materialization, previewData, project],
  );

  const uniquePatterns = useMemo(() => {
    const unique = new Map<
      string,
      (typeof report.twoDimensional.layers)[number]
    >();
    for (const layer of report.twoDimensional.layers) {
      const key =
        layer.metadata.source === "pallet-layer"
          ? (layer.metadata.patternRef ?? layer.id)
          : layer.id;
      if (!unique.has(key)) unique.set(key, layer);
    }
    return [...unique.values()];
  }, [report]);
  const fallbackPreview =
    report.twoDimensional.layers[
      report.fixedView3d.status === "fallback"
        ? report.fixedView3d.fallbackLayerIndex
        : fallbackLayerIndex
    ] ??
    report.twoDimensional.layers[0] ??
    null;

  return (
    <div className="print-report report-sheet grid gap-4 border border-zinc-800 bg-zinc-900 p-4 text-zinc-200">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-3">
        <button
          type="button"
          disabled={!previewData || capturePending}
          onClick={() => void captureFixedView()}
          className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-zinc-800 focus:ring-2 focus:ring-amber-400/30 focus:outline-none disabled:cursor-not-allowed disabled:text-zinc-600"
        >
          {capturePending
            ? "Capturing fixed view…"
            : "Capture fixed right-top 3D view"}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-amber-400 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 focus:ring-2 focus:ring-amber-200 focus:outline-none"
        >
          Print / Save as PDF
        </button>
        <span className="text-xs text-zinc-500">
          Browser print via window.print() is the supported PDF path.
        </span>
      </div>

      <nav
        aria-label="Report sections"
        className="no-print flex flex-wrap gap-2"
      >
        {(
          [
            ["report-summary", "Summary"],
            ["report-geometry", "Geometry"],
            ["report-robotics", "Robotics"],
            ["report-warnings", "Warnings"],
            ["report-provenance", "Provenance"],
          ] as const
        ).map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 hover:bg-zinc-800 focus:ring-2 focus:ring-amber-400/30 focus:outline-none"
          >
            {label}
          </a>
        ))}
      </nav>

      <header className="report-header border-b border-zinc-700 pb-3">
        <h1 className="text-xl font-semibold text-zinc-100">
          Pallet planner report
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Product {report.project.productNumber || "not set"} · Line{" "}
          {report.project.projectNumber || "not set"}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          Project schema {report.project.schemaVersion} · Last updated{" "}
          {new Date(report.project.updatedAt).toLocaleString()} ·{" "}
          {report.project.source}
        </p>
      </header>

      <section id="report-summary" className="report-section scroll-mt-4">
        <h2 className="text-sm font-semibold text-zinc-100">
          Line and product data
        </h2>
        <div className="mt-2 overflow-hidden border border-zinc-800">
          <table className="report-table w-full border-collapse text-left text-xs">
            <tbody>
              {[
                ["Project ID", report.project.id],
                ["Line number", report.project.projectNumber || "Not set"],
                ["Product number", report.project.productNumber || "Not set"],
                ["Package shape", report.product.shape],
                [
                  "Package dimensions",
                  `${report.product.dimensionsMm.length} × ${report.product.dimensionsMm.width} × ${report.product.dimensionsMm.height} mm`,
                ],
                [
                  "Package weight",
                  report.product.weightKg === null
                    ? "Unknown"
                    : `${report.product.weightKg} kg`,
                ],
                ["Clearance", `${report.product.clearanceMm} mm`],
                ["Inlet orientation", report.product.inletOrientation],
                [
                  "Multipick",
                  report.product.multiPickAllowed ? "Allowed" : "Not allowed",
                ],
                [
                  "Pallet",
                  report.pallet
                    ? `${report.pallet.name} · ${report.pallet.dimensionsMm.length} × ${report.pallet.dimensionsMm.width} × ${report.pallet.dimensionsMm.height} mm`
                    : "Unknown / not selected",
                ],
                [
                  "Selected gripper",
                  report.selectedResources.gripperName ??
                    report.selectedResources.gripperId ??
                    "Unknown / not selected",
                ],
                [
                  "Selected station",
                  report.selectedResources.stationName ??
                    report.selectedResources.stationId ??
                    "Unknown / not selected",
                ],
              ].map(([label, value]) => (
                <tr
                  key={label}
                  className="border-b border-zinc-800 last:border-b-0"
                >
                  <th className="w-[220px] bg-zinc-950 px-3 py-2 font-medium text-zinc-500">
                    {label}
                  </th>
                  <td className="px-3 py-2 text-zinc-300">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {uniquePatterns.length === 0 &&
      (!previewData || previewData.layer_count === 0) ? (
        <details id="report-geometry" className="report-section scroll-mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-100">
            Geometry — no layers available yet
          </summary>
          <p className="mt-2 text-xs text-zinc-500">
            Finish the stack to render the 2D drawings and the 3D capture.
          </p>
        </details>
      ) : (
        <section
          id="report-geometry"
          className="report-section grid scroll-mt-4 gap-3 xl:grid-cols-2"
        >
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Deterministic 2D SVG
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Read-only layer geometry rendered without canvas or WebGL.
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {uniquePatterns.map((preview) => (
                <figure
                  key={preview.id}
                  className="break-inside-avoid border border-zinc-800 p-2"
                >
                  <LayerPattern
                    preview={preview}
                    className="h-auto w-full"
                    showGrid={false}
                    showGroupLabels
                    showLabelSides
                  />
                  <figcaption className="mt-2 text-xs text-zinc-500">
                    {preview.label}
                  </figcaption>
                </figure>
              ))}
              {uniquePatterns.length === 0 ? (
                <p className="border border-dashed border-zinc-800 p-3 text-xs text-zinc-600">
                  No physical layer is available for a 2D report drawing.
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-zinc-100">
              Fixed-view 3D capture
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Fixed right-top preset. A deterministic 2D SVG is used when
              capture is unavailable.
            </p>
            <div className="report-capture-source no-print mt-2 min-h-[360px] overflow-hidden border border-zinc-800 bg-[#101013]">
              {previewData && previewData.layer_count > 0 ? (
                <RobViewer
                  ref={viewerRef}
                  data={previewData}
                  cameraResetKey={`report:${project.id}:${project.updatedAt}`}
                  cameraPreset="right-top"
                  visibleUpToLayer={previewData.layer_count}
                  showSceneControls={false}
                  showLayerLabels
                />
              ) : (
                <div className="flex min-h-[360px] items-center justify-center p-4 text-center text-xs text-zinc-600">
                  No stack is available for 3D capture.
                </div>
              )}
            </div>
            <div className="report-capture-output mt-2 overflow-hidden border border-zinc-800 bg-zinc-950">
              {report.fixedView3d.status === "captured" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={report.fixedView3d.dataUrl}
                  width={report.fixedView3d.width}
                  height={report.fixedView3d.height}
                  alt="Fixed right-top 3D pallet view"
                  className="h-auto w-full"
                />
              ) : fallbackPreview ? (
                <div className="p-3">
                  <LayerPattern
                    preview={fallbackPreview}
                    className="h-auto max-h-[420px] w-full"
                    showGrid={false}
                    showGroupLabels
                    showLabelSides
                  />
                  <p className="mt-2 text-xs text-amber-200">
                    3D fallback: {report.fixedView3d.message}
                  </p>
                </div>
              ) : (
                <p className="p-3 text-xs text-zinc-600">
                  No 3D or 2D fallback image is available.
                </p>
              )}
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
              {report.fixedView3d.status === "captured"
                ? report.fixedView3d.provenance
                : `Fallback reason: ${report.fixedView3d.reason}`}
            </p>
          </div>
        </section>
      )}

      <section id="report-metrics" className="report-section scroll-mt-4">
        <h2 className="text-sm font-semibold text-zinc-100">
          Metrics and provenance
        </h2>
        <div className="mt-2 overflow-auto border border-zinc-800">
          <table className="report-table w-full min-w-[860px] border-collapse text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Metric</th>
                <th className="px-3 py-2 font-medium">Value</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">
                  Formula operands / detail
                </th>
              </tr>
            </thead>
            <tbody>
              {report.metrics.map((metric) => (
                <tr key={metric.id} className="border-t border-zinc-800">
                  <td className="px-3 py-2 text-zinc-200">{metric.label}</td>
                  <td className="px-3 py-2 font-mono text-zinc-200">
                    {metricValue(metric.value, metric.unit)}
                  </td>
                  <td className="px-3 py-2">{metric.provenance.status}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {metric.provenance.source}
                  </td>
                  <td className="px-3 py-2 text-zinc-400">
                    {metric.numeratorName || metric.denominatorName
                      ? `${metric.numeratorName ?? "value"} / ${metric.denominatorName ?? "no denominator"}. `
                      : ""}
                    {metric.provenance.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="report-warnings" className="report-section scroll-mt-4">
        <h2 className="text-sm font-semibold text-zinc-100">
          Warnings and validation
        </h2>
        {report.warnings.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">
            No stack or robotics diagnostics were emitted.
          </p>
        ) : (
          <table className="report-table mt-2 w-full border-collapse text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Message / provenance</th>
              </tr>
            </thead>
            <tbody>
              {report.warnings.map((warning) => (
                <tr key={warning.id} className="border-t border-zinc-800">
                  <td
                    className={
                      warning.severity === "error"
                        ? "px-3 py-2 text-red-300"
                        : "px-3 py-2 text-amber-300"
                    }
                  >
                    {warning.severity}
                  </td>
                  <td className="px-3 py-2">{warning.source}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {warning.code}
                  </td>
                  <td className="px-3 py-2 text-zinc-300">
                    {warning.message}
                    {warning.provenance ? (
                      <span className="mt-1 block text-[11px] text-zinc-500">
                        {warning.provenance.status} ·{" "}
                        {warning.provenance.source} ·{" "}
                        {warning.provenance.detail}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section id="report-layers" className="report-section scroll-mt-4">
        <h2 className="text-sm font-semibold text-zinc-100">Layer sequence</h2>
        <div className="mt-2 overflow-auto border border-zinc-800">
          <table className="report-table w-full min-w-[760px] border-collapse text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-500">
              <tr>
                {[
                  "Layer",
                  "Pattern",
                  "Packages",
                  "Cycles",
                  "Interlayers before",
                  "Z bottom",
                  "Z top",
                  "Source",
                ].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.layerSequence.map((layer) => (
                <tr key={layer.id} className="border-t border-zinc-800">
                  <td className="px-3 py-2 font-mono">{layer.layerNumber}</td>
                  <td className="px-3 py-2 font-mono text-[11px]">
                    {layer.patternRef}
                  </td>
                  <td className="px-3 py-2 font-mono">{layer.packageCount}</td>
                  <td className="px-3 py-2 font-mono">
                    {layer.cycleCount ?? "Unknown"}
                  </td>
                  <td className="px-3 py-2 font-mono">
                    {layer.interlayerBeforeCount}
                  </td>
                  <td className="px-3 py-2 font-mono">{layer.zBottomMm} mm</td>
                  <td className="px-3 py-2 font-mono">{layer.zTopMm} mm</td>
                  <td className="px-3 py-2">{layer.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {report.robotCycles.rows.length === 0 ? (
        <details id="report-robotics" className="report-section scroll-mt-4">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-100">
            Robot cycles — none calculated yet
          </summary>
          <p className="mt-2 text-xs text-zinc-500">
            Complete the stack and the Robotics preflight to calculate pickup
            cycles.
          </p>
        </details>
      ) : (
        <section id="report-robotics" className="report-section scroll-mt-4">
          <h2 className="text-sm font-semibold text-zinc-100">Robot cycles</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {report.robotCycles.cycleCount} cycles ·{" "}
            {report.robotCycles.singleCount} single ·{" "}
            {report.robotCycles.doubleCount} double ·{" "}
            {report.robotCycles.largerMultipickCount} larger multipick
          </p>
          <div className="mt-2 overflow-auto border border-zinc-800">
            <table className="report-table w-full min-w-[1120px] border-collapse text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-500">
                <tr>
                  {[
                    "#",
                    "Layer",
                    "Group",
                    "Packages",
                    "Pick X/Y/Z/yaw",
                    "Transfer X/Y/Z/yaw",
                    "Place X/Y/Z/yaw",
                    "Gripper",
                    "Station",
                    "Source",
                  ].map((label) => (
                    <th key={label} className="px-3 py-2 font-medium">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.robotCycles.rows.map((cycle) => (
                  <tr key={cycle.cycleId} className="border-t border-zinc-800">
                    <td className="px-3 py-2 font-mono">
                      {cycle.sequence + 1}
                    </td>
                    <td className="px-3 py-2 font-mono">{cycle.layer}</td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {cycle.groupId}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {cycle.packageCount}
                    </td>
                    {[cycle.pickPose, cycle.transferPose, cycle.placePose].map(
                      (pose, index) => (
                        <td
                          key={index}
                          className="px-3 py-2 font-mono text-[11px]"
                        >
                          {pose.positionMm.x} / {pose.positionMm.y} /{" "}
                          {pose.positionMm.z} / {pose.yawDeg}° ({pose.frame})
                        </td>
                      ),
                    )}
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {cycle.gripperId ?? "Unknown"}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {cycle.stationId ?? "Unknown"}
                    </td>
                    <td className="px-3 py-2">{cycle.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer
        id="report-provenance"
        className="report-footer scroll-mt-4 border-t border-zinc-700 pt-3"
      >
        <h2 className="text-sm font-semibold text-zinc-100">
          Provenance notes
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-zinc-500">
          {report.provenanceNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </footer>
    </div>
  );
}
