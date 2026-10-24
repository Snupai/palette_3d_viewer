import type { ReactNode } from "react";
import type { MaterializedStackResult } from "~/domain/stack";
import { metric } from "~/features/stack/stackWorkspaceUi";

function MetricTableRow({
  label,
  last = false,
  children,
}: {
  label: string;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <tr className={last ? undefined : "border-line border-b"}>
      <th className="text-muted px-3 py-2 text-left font-normal">{label}</th>
      <td className="text-ink px-3 py-2 text-right font-mono">{children}</td>
    </tr>
  );
}

/** Materialized stack metrics and warnings. */
export function StackResultPanel({
  result,
}: {
  result: MaterializedStackResult;
}) {
  const { metrics, warnings } = result;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="border-line overflow-hidden border">
        <table className="text-micro w-full">
          <caption className="border-line text-ink border-b px-3 py-2 text-left font-semibold">
            Stack metrics
          </caption>
          <tbody>
            <MetricTableRow label="Packages">
              {metrics.packages.totalPackageCount}
            </MetricTableRow>
            <MetricTableRow label="Cycles">
              {metric(metrics.cycles.totalCycleCount)}
            </MetricTableRow>
            <MetricTableRow label="Load height">
              {metric(metrics.height.loadStackHeightMm, " mm")}
            </MetricTableRow>
            <MetricTableRow label="Area use">
              {metric(metrics.area.utilization.percent, "%")}
            </MetricTableRow>
            <MetricTableRow label="Volume use">
              {metric(metrics.volume.utilization.percent, "%")}
            </MetricTableRow>
            <MetricTableRow label="Gross weight">
              {metric(metrics.weight.grossWeightKg, " kg")}
            </MetricTableRow>
            <MetricTableRow label="Block L × W" last>
              {metrics.block.lengthMm} × {metrics.block.widthMm} mm
            </MetricTableRow>
          </tbody>
        </table>
      </div>
      <div className="border-line text-micro border p-3">
        <h3 className="text-ink font-semibold">Warnings ({warnings.length})</h3>
        {warnings.length === 0 ? (
          <p className="text-muted mt-2">No stack warnings.</p>
        ) : (
          <ul className="text-muted scrollbar-thin mt-2 max-h-52 space-y-1 overflow-auto pr-2">
            {warnings.map((warning) => (
              <li key={warning.id} className="border-line border-b pb-1">
                <span
                  className={
                    warning.severity === "error"
                      ? "text-danger"
                      : "text-caution"
                  }
                >
                  {warning.code}
                </span>{" "}
                {warning.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
