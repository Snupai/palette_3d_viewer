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
import { PalletSheetSvg } from "~/features/reporting/PalletSheetSvg";
import {
  buildPalletSheet,
  sheetFileName,
} from "~/features/reporting/palletSheet";
import { renderSheetPdf } from "~/features/reporting/pdfWriter";
import {
  createPlanningReportModel,
  type PlanningReportCapture,
} from "~/features/reporting/reportModel";
import { downloadBlob } from "~/lib/download";

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

function sheetDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
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
  const sheet = useMemo(
    () =>
      previewData && previewData.layer_count > 0
        ? buildPalletSheet({
            data: previewData,
            storageHeightMm: project.pallet?.storageEnvelopeMm?.height ?? null,
            productNumber: project.productNumber,
            lineNumber: project.projectNumber,
            palletName: project.pallet?.name ?? null,
            date: sheetDate(new Date()),
          })
        : null,
    [previewData, project],
  );
  const downloadSheetPdf = () => {
    if (!sheet) return;
    const bytes = renderSheetPdf(sheet);
    downloadBlob(
      new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
      sheetFileName(project.productNumber, project.projectNumber),
    );
  };

  const fallbackPreview =
    report.twoDimensional.layers[
      report.fixedView3d.status === "fallback"
        ? report.fixedView3d.fallbackLayerIndex
        : fallbackLayerIndex
    ] ??
    report.twoDimensional.layers[0] ??
    null;

  return (
    <div className="grid gap-4 p-4">
      <section
        aria-label="Pallet sheet"
        className="border-line bg-surface grid gap-3 border p-4"
      >
        <header className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-ink text-body font-semibold">
              Palettierschema
            </h2>
            <p className="text-muted text-micro">
              One-page A4 sheet for the line: figures and an isometric drawing
              with the top layer lifted off.
            </p>
          </div>
          <button
            type="button"
            disabled={!sheet}
            onClick={downloadSheetPdf}
            className="ui-btn-primary"
          >
            Download PDF
          </button>
        </header>
        {sheet ? (
          <PalletSheetSvg
            sheet={sheet}
            className="border-line mx-auto block aspect-[210/297] w-full max-w-[760px] border shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
          />
        ) : (
          <p className="text-muted text-micro">
            Save a stack to create the pallet sheet.
          </p>
        )}
      </section>

      <details className="border-line bg-surface border">
        <summary className="text-muted text-micro cursor-pointer px-4 py-2.5 font-semibold">
          Technical report (validation, robotics, provenance)
        </summary>
        <div className="print-report report-sheet border-line bg-surface text-ink grid gap-4 border-t p-4">
          <div className="no-print border-line flex flex-wrap items-center gap-2 border-b pb-3">
            <button
              type="button"
              disabled={!previewData || capturePending}
              onClick={() => void captureFixedView()}
              className="ui-btn"
            >
              {capturePending
                ? "Capturing fixed view…"
                : "Capture fixed right-top 3D view"}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="ui-btn"
            >
              Print technical report
            </button>
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
              <a key={id} href={`#${id}`} className="ui-btn ui-btn-sm">
                {label}
              </a>
            ))}
          </nav>

          <header className="report-header border-line border-b pb-3">
            <h1 className="text-ink text-xl font-semibold">
              Pallet planner report
            </h1>
            <p className="text-muted text-body mt-1">
              Product {report.project.productNumber || "not set"} · Line{" "}
              {report.project.projectNumber || "not set"}
            </p>
            <p className="text-muted text-micro mt-1">
              Project schema {report.project.schemaVersion} · Last updated{" "}
              {new Date(report.project.updatedAt).toLocaleString()} ·{" "}
              {report.project.source}
            </p>
          </header>

          <section id="report-summary" className="report-section scroll-mt-4">
            <h2 className="text-ink text-body font-semibold">
              Line and product data
            </h2>
            <div className="border-line mt-2 overflow-hidden border">
              <table className="report-table ui-table w-full text-left">
                <tbody>
                  {[
                    ["Project ID", report.project.id],
                    ["Line number", report.project.projectNumber || "Not set"],
                    [
                      "Product number",
                      report.project.productNumber || "Not set",
                    ],
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
                      report.product.multiPickAllowed
                        ? "Allowed"
                        : "Not allowed",
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
                    <tr key={label} className="last:[&>*]:border-b-0!">
                      <th className="static! w-[220px] font-medium!">
                        {label}
                      </th>
                      <td className="text-ink">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {uniquePatterns.length === 0 &&
          (!previewData || previewData.layer_count === 0) ? (
            <details
              id="report-geometry"
              className="report-section scroll-mt-4"
            >
              <summary className="text-ink text-body cursor-pointer font-semibold">
                Geometry — no layers available yet
              </summary>
              <p className="text-muted text-micro mt-2">
                Finish the stack to render the 2D drawings and the 3D capture.
              </p>
            </details>
          ) : (
            <section
              id="report-geometry"
              className="report-section grid scroll-mt-4 gap-3 xl:grid-cols-2"
            >
              <div>
                <h2 className="text-ink text-body font-semibold">
                  Deterministic 2D SVG
                </h2>
                <p className="text-muted text-micro mt-1">
                  Read-only layer geometry rendered without canvas or WebGL.
                </p>
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {uniquePatterns.map((preview) => (
                    <figure
                      key={preview.id}
                      className="border-line break-inside-avoid border p-2"
                    >
                      <LayerPattern
                        preview={preview}
                        className="h-auto w-full"
                        showGrid={false}
                        showGroupLabels
                        showLabelSides
                      />
                      <figcaption className="text-muted text-micro mt-2">
                        {preview.label}
                      </figcaption>
                    </figure>
                  ))}
                  {uniquePatterns.length === 0 ? (
                    <p className="border-line text-muted text-micro border border-dashed p-3">
                      No physical layer is available for a 2D report drawing.
                    </p>
                  ) : null}
                </div>
              </div>

              <div>
                <h2 className="text-ink text-body font-semibold">
                  Fixed-view 3D capture
                </h2>
                <p className="text-muted text-micro mt-1">
                  Fixed right-top preset. A deterministic 2D SVG is used when
                  capture is unavailable.
                </p>
                <div className="report-capture-source no-print border-line bg-viewport mt-2 min-h-[360px] overflow-hidden border">
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
                    <div className="text-viewport-ink/60 text-micro flex min-h-[360px] items-center justify-center p-4 text-center">
                      No stack is available for 3D capture.
                    </div>
                  )}
                </div>
                <div className="report-capture-output border-line bg-canvas mt-2 overflow-hidden border">
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
                      <p className="text-caution text-micro mt-2">
                        3D fallback: {report.fixedView3d.message}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted text-micro p-3">
                      No 3D or 2D fallback image is available.
                    </p>
                  )}
                </div>
                <p className="text-micro text-muted mt-2">
                  {report.fixedView3d.status === "captured"
                    ? report.fixedView3d.provenance
                    : `Fallback reason: ${report.fixedView3d.reason}`}
                </p>
              </div>
            </section>
          )}

          <section id="report-metrics" className="report-section scroll-mt-4">
            <h2 className="text-ink text-body font-semibold">
              Metrics and provenance
            </h2>
            <div className="border-line mt-2 overflow-auto border">
              <table className="report-table ui-table w-full min-w-[860px] text-left">
                <thead className="text-muted">
                  <tr>
                    <th className="font-medium">Metric</th>
                    <th className="font-medium">Value</th>
                    <th className="font-medium">Status</th>
                    <th className="font-medium">Source</th>
                    <th className="font-medium">Formula operands / detail</th>
                  </tr>
                </thead>
                <tbody>
                  {report.metrics.map((metric) => (
                    <tr key={metric.id}>
                      <td className="text-ink">{metric.label}</td>
                      <td className="text-ink font-mono">
                        {metricValue(metric.value, metric.unit)}
                      </td>
                      <td>{metric.provenance.status}</td>
                      <td className="text-micro font-mono">
                        {metric.provenance.source}
                      </td>
                      <td className="text-muted">
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
            <h2 className="text-ink text-body font-semibold">
              Warnings and validation
            </h2>
            {report.warnings.length === 0 ? (
              <p className="text-muted text-micro mt-2">
                No stack or robotics diagnostics were emitted.
              </p>
            ) : (
              <table className="report-table ui-table mt-2 w-full text-left">
                <thead className="text-muted">
                  <tr>
                    <th className="font-medium">Severity</th>
                    <th className="font-medium">Source</th>
                    <th className="font-medium">Code</th>
                    <th className="font-medium">Message / provenance</th>
                  </tr>
                </thead>
                <tbody>
                  {report.warnings.map((warning) => (
                    <tr key={warning.id}>
                      <td
                        className={
                          warning.severity === "error"
                            ? "text-danger"
                            : "text-caution"
                        }
                      >
                        {warning.severity}
                      </td>
                      <td>{warning.source}</td>
                      <td className="text-micro font-mono">{warning.code}</td>
                      <td className="text-ink">
                        {warning.message}
                        {warning.provenance ? (
                          <span className="text-micro text-muted mt-1 block">
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
            <h2 className="text-ink text-body font-semibold">Layer sequence</h2>
            <div className="border-line mt-2 overflow-auto border">
              <table className="report-table ui-table w-full min-w-[760px] text-left">
                <thead className="text-muted">
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
                      <th key={label} className="font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.layerSequence.map((layer) => (
                    <tr key={layer.id}>
                      <td className="font-mono">{layer.layerNumber}</td>
                      <td className="text-micro font-mono">
                        {layer.patternRef}
                      </td>
                      <td className="font-mono">{layer.packageCount}</td>
                      <td className="font-mono">
                        {layer.cycleCount ?? "Unknown"}
                      </td>
                      <td className="font-mono">
                        {layer.interlayerBeforeCount}
                      </td>
                      <td className="font-mono">{layer.zBottomMm} mm</td>
                      <td className="font-mono">{layer.zTopMm} mm</td>
                      <td>{layer.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {report.robotCycles.rows.length === 0 ? (
            <details
              id="report-robotics"
              className="report-section scroll-mt-4"
            >
              <summary className="text-ink text-body cursor-pointer font-semibold">
                Robot cycles — none calculated yet
              </summary>
              <p className="text-muted text-micro mt-2">
                Complete the stack and the Robotics preflight to calculate
                pickup cycles.
              </p>
            </details>
          ) : (
            <section
              id="report-robotics"
              className="report-section scroll-mt-4"
            >
              <h2 className="text-ink text-body font-semibold">Robot cycles</h2>
              <p className="text-muted text-micro mt-1">
                {report.robotCycles.cycleCount} cycles ·{" "}
                {report.robotCycles.singleCount} single ·{" "}
                {report.robotCycles.doubleCount} double ·{" "}
                {report.robotCycles.largerMultipickCount} larger multipick
              </p>
              <div className="border-line mt-2 overflow-auto border">
                <table className="report-table ui-table w-full min-w-[1120px] text-left">
                  <thead className="text-muted">
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
                        <th key={label} className="font-medium">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.robotCycles.rows.map((cycle) => (
                      <tr key={cycle.cycleId}>
                        <td className="font-mono">{cycle.sequence + 1}</td>
                        <td className="font-mono">{cycle.layer}</td>
                        <td className="text-micro font-mono">
                          {cycle.groupId}
                        </td>
                        <td className="font-mono">{cycle.packageCount}</td>
                        {[
                          cycle.pickPose,
                          cycle.transferPose,
                          cycle.placePose,
                        ].map((pose, index) => (
                          <td key={index} className="text-micro font-mono">
                            {pose.positionMm.x} / {pose.positionMm.y} /{" "}
                            {pose.positionMm.z} / {pose.yawDeg}° ({pose.frame})
                          </td>
                        ))}
                        <td className="text-micro font-mono">
                          {cycle.gripperId ?? "Unknown"}
                        </td>
                        <td className="text-micro font-mono">
                          {cycle.stationId ?? "Unknown"}
                        </td>
                        <td>{cycle.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <footer
            id="report-provenance"
            className="report-footer border-line scroll-mt-4 border-t pt-3"
          >
            <h2 className="text-ink text-body font-semibold">
              Provenance notes
            </h2>
            <ul className="text-muted text-micro mt-2 list-disc space-y-1 pl-5 leading-5">
              {report.provenanceNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </footer>
        </div>
      </details>
    </div>
  );
}
