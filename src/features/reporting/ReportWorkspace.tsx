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
import { useLocale, type MessageKey, type Translate } from "~/i18n";
import { downloadBlob } from "~/lib/download";

export type ReportWorkspaceProps = {
  project: Project;
  materialization: RobotCycleMaterialization;
  previewData: PalletData | null;
};

function metricValue(value: number | null, unit: string, t: Translate): string {
  if (value === null) return t("reporting.unknown");
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
  t: Translate,
): PlanningReportCapture {
  if (result.status === "captured") {
    return {
      status: "captured",
      dataUrl: result.dataUrl,
      width: result.width,
      height: result.height,
      cameraPreset: "right-top",
      provenance: t("reporting.capture.provenance"),
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
  const { t, tag } = useLocale();
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
        message: t("reporting.capture.viewerUnavailable"),
        layerPattern: null,
      };
      if (request === captureRequestRef.current) {
        setCapture(captureFromViewer(result, fallbackLayerIndex, t));
      }
    } finally {
      if (request === captureRequestRef.current) setCapturePending(false);
    }
  }, [fallbackLayerIndex, previewData, t]);

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
        t,
      }),
    [capture, materialization, previewData, project, t],
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
            t,
            tag,
          })
        : null,
    [previewData, project, t, tag],
  );
  const downloadSheetPdf = () => {
    if (!sheet) return;
    const bytes = renderSheetPdf(sheet);
    downloadBlob(
      new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" }),
      sheetFileName(project.productNumber, project.projectNumber, t),
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
        aria-label={t("reporting.sheet.aria")}
        className="border-line bg-surface grid gap-3 border p-4"
      >
        <header className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h2 className="text-ink text-body font-semibold">
              {t("reporting.sheet.title")}
            </h2>
          </div>
          <button
            type="button"
            disabled={!sheet}
            onClick={downloadSheetPdf}
            className="ui-btn-primary"
          >
            {t("reporting.sheet.downloadPdf")}
          </button>
        </header>
        {sheet ? (
          <PalletSheetSvg
            sheet={sheet}
            className="border-line mx-auto block aspect-[210/297] w-full max-w-[760px] border shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
          />
        ) : (
          <p className="text-muted text-micro">{t("reporting.sheet.empty")}</p>
        )}
      </section>

      <details className="border-line bg-surface border">
        <summary className="text-muted text-micro cursor-pointer px-4 py-2.5 font-semibold">
          {t("reporting.technical.summary")}
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
                ? t("reporting.technical.capturing")
                : t("reporting.technical.capture")}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="ui-btn"
            >
              {t("reporting.technical.print")}
            </button>
          </div>

          <nav
            aria-label={t("reporting.nav.aria")}
            className="no-print flex flex-wrap gap-2"
          >
            {(
              [
                ["report-summary", t("reporting.nav.summary")],
                ["report-geometry", t("reporting.nav.geometry")],
                ["report-robotics", t("reporting.nav.robotics")],
                ["report-warnings", t("reporting.nav.warnings")],
                ["report-provenance", t("reporting.nav.provenance")],
              ] as const
            ).map(([id, label]) => (
              <a key={id} href={`#${id}`} className="ui-btn ui-btn-sm">
                {label}
              </a>
            ))}
          </nav>

          <header className="report-header border-line border-b pb-3">
            <h1 className="text-ink text-xl font-semibold">
              {t("reporting.header.title")}
            </h1>
            <p className="text-muted text-body mt-1">
              {t("reporting.header.productLine", {
                product:
                  report.project.productNumber || t("reporting.notSetLower"),
                line:
                  report.project.projectNumber || t("reporting.notSetLower"),
              })}
            </p>
          </header>

          <section id="report-summary" className="report-section scroll-mt-4">
            <h2 className="text-ink text-body font-semibold">
              {t("reporting.data.title")}
            </h2>
            <div className="border-line mt-2 overflow-hidden border">
              <table className="report-table ui-table w-full text-left">
                <tbody>
                  {[
                    [t("reporting.data.projectId"), report.project.id],
                    [
                      t("reporting.data.lineNumber"),
                      report.project.projectNumber || t("reporting.notSet"),
                    ],
                    [
                      t("reporting.data.productNumber"),
                      report.project.productNumber || t("reporting.notSet"),
                    ],
                    [t("reporting.data.shape"), report.product.shape],
                    [
                      t("reporting.data.dimensions"),
                      `${report.product.dimensionsMm.length} × ${report.product.dimensionsMm.width} × ${report.product.dimensionsMm.height} mm`,
                    ],
                    [
                      t("reporting.data.weight"),
                      report.product.weightKg === null
                        ? t("reporting.unknown")
                        : `${report.product.weightKg} kg`,
                    ],
                    [
                      t("reporting.data.clearance"),
                      `${report.product.clearanceMm} mm`,
                    ],
                    [
                      t("reporting.data.inlet"),
                      report.product.inletOrientation,
                    ],
                    [
                      t("reporting.data.multipick"),
                      report.product.multiPickAllowed
                        ? t("reporting.data.allowed")
                        : t("reporting.data.notAllowed"),
                    ],
                    [
                      t("reporting.data.pallet"),
                      report.pallet
                        ? `${report.pallet.name} · ${report.pallet.dimensionsMm.length} × ${report.pallet.dimensionsMm.width} × ${report.pallet.dimensionsMm.height} mm`
                        : t("reporting.unknownNotSelected"),
                    ],
                    [
                      t("reporting.data.gripper"),
                      report.selectedResources.gripperName ??
                        report.selectedResources.gripperId ??
                        t("reporting.unknownNotSelected"),
                    ],
                    [
                      t("reporting.data.station"),
                      report.selectedResources.stationName ??
                        report.selectedResources.stationId ??
                        t("reporting.unknownNotSelected"),
                    ],
                  ].map(([label, value]) => (
                    <tr key={label} className="last:[&>*]:border-b-0!">
                      <th className="static! w-[40%] font-medium! sm:w-[220px]">
                        {label}
                      </th>
                      <td className="text-ink break-words">{value}</td>
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
                {t("reporting.geometry.emptySummary")}
              </summary>
              <p className="text-muted text-micro mt-2">
                {t("reporting.geometry.emptyNote")}
              </p>
            </details>
          ) : (
            <section
              id="report-geometry"
              className="report-section grid scroll-mt-4 gap-3 xl:grid-cols-2"
            >
              <div>
                <h2 className="text-ink text-body font-semibold">
                  {t("reporting.geometry.svgTitle")}
                </h2>
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
                      {t("reporting.geometry.noLayer")}
                    </p>
                  ) : null}
                </div>
              </div>

              <div>
                <h2 className="text-ink text-body font-semibold">
                  {t("reporting.geometry.captureTitle")}
                </h2>
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
                      {t("reporting.geometry.noStack")}
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
                      alt={t("reporting.geometry.imageAlt")}
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
                        {t("reporting.geometry.fallback", {
                          message: report.fixedView3d.message,
                        })}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted text-micro p-3">
                      {t("reporting.geometry.noFallback")}
                    </p>
                  )}
                </div>
                {report.fixedView3d.status === "captured" ? null : (
                  <p className="text-micro text-muted mt-2">
                    {t("reporting.geometry.fallbackReason", {
                      reason: report.fixedView3d.reason,
                    })}
                  </p>
                )}
              </div>
            </section>
          )}

          <section id="report-metrics" className="report-section scroll-mt-4">
            <h2 className="text-ink text-body font-semibold">
              {t("reporting.metrics.title")}
            </h2>
            <div className="border-line mt-2 overflow-auto border">
              <table className="report-table ui-table w-full min-w-[860px] text-left">
                <thead className="text-muted">
                  <tr>
                    <th className="font-medium">
                      {t("reporting.metrics.metric")}
                    </th>
                    <th className="font-medium">
                      {t("reporting.metrics.value")}
                    </th>
                    <th className="font-medium">
                      {t("reporting.metrics.status")}
                    </th>
                    <th className="font-medium">
                      {t("reporting.metrics.source")}
                    </th>
                    <th className="font-medium">
                      {t("reporting.metrics.operands")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {report.metrics.map((metric) => (
                    <tr key={metric.id}>
                      <td className="text-ink">{metric.label}</td>
                      <td className="text-ink font-mono">
                        {metricValue(metric.value, metric.unit, t)}
                      </td>
                      <td>{metric.provenance.status}</td>
                      <td className="text-micro font-mono">
                        {metric.provenance.source}
                      </td>
                      <td className="text-muted">
                        {metric.numeratorName || metric.denominatorName
                          ? t("reporting.metrics.operandsText", {
                              numerator:
                                metric.numeratorName ??
                                t("reporting.metrics.operandValue"),
                              denominator:
                                metric.denominatorName ??
                                t("reporting.metrics.noDenominator"),
                            })
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
              {t("reporting.warnings.title")}
            </h2>
            {report.warnings.length === 0 ? (
              <p className="text-muted text-micro mt-2">
                {t("reporting.warnings.none")}
              </p>
            ) : (
              <table className="report-table ui-table mt-2 w-full text-left">
                <thead className="text-muted">
                  <tr>
                    <th className="font-medium">
                      {t("reporting.warnings.severity")}
                    </th>
                    <th className="font-medium">
                      {t("reporting.warnings.source")}
                    </th>
                    <th className="font-medium">
                      {t("reporting.warnings.code")}
                    </th>
                    <th className="font-medium">
                      {t("reporting.warnings.message")}
                    </th>
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
                      <td className="text-micro font-mono break-all">
                        {warning.code}
                      </td>
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
            <h2 className="text-ink text-body font-semibold">
              {t("reporting.layers.title")}
            </h2>
            <div className="border-line mt-2 overflow-auto border">
              <table className="report-table ui-table w-full min-w-[760px] text-left">
                <thead className="text-muted">
                  <tr>
                    {(
                      [
                        "reporting.layers.layer",
                        "reporting.layers.pattern",
                        "reporting.layers.packages",
                        "reporting.layers.cycles",
                        "reporting.layers.interlayersBefore",
                        "reporting.layers.zBottom",
                        "reporting.layers.zTop",
                        "reporting.layers.source",
                      ] as const satisfies readonly MessageKey[]
                    ).map((label) => (
                      <th key={label} className="font-medium">
                        {t(label)}
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
                        {layer.cycleCount ?? t("reporting.unknown")}
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
                {t("reporting.cycles.emptySummary")}
              </summary>
              <p className="text-muted text-micro mt-2">
                {t("reporting.cycles.emptyNote")}
              </p>
            </details>
          ) : (
            <section
              id="report-robotics"
              className="report-section scroll-mt-4"
            >
              <h2 className="text-ink text-body font-semibold">
                {t("reporting.cycles.title")}
              </h2>
              <p className="text-muted text-micro mt-1">
                {t("reporting.cycles.summary", {
                  count: report.robotCycles.cycleCount,
                  single: report.robotCycles.singleCount,
                  double: report.robotCycles.doubleCount,
                  larger: report.robotCycles.largerMultipickCount,
                })}
              </p>
              <div className="border-line mt-2 overflow-auto border">
                <table className="report-table ui-table w-full min-w-[1120px] text-left">
                  <thead className="text-muted">
                    <tr>
                      {(
                        [
                          "#",
                          "reporting.layers.layer",
                          "reporting.cycles.group",
                          "reporting.layers.packages",
                          "reporting.cycles.pick",
                          "reporting.cycles.transfer",
                          "reporting.cycles.place",
                          "reporting.cycles.gripper",
                          "reporting.cycles.station",
                          "reporting.layers.source",
                        ] as const satisfies readonly (MessageKey | "#")[]
                      ).map((label) => (
                        <th key={label} className="font-medium">
                          {label === "#" ? label : t(label)}
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
                          {cycle.gripperId ?? t("reporting.unknown")}
                        </td>
                        <td className="text-micro font-mono">
                          {cycle.stationId ?? t("reporting.unknown")}
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
              {t("reporting.provenance.title")}
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
