import type { RobotDiagnostic } from "~/domain/robotics";
import {
  categoryLabels,
  diagnosticCategory,
  diagnosticKey,
  type ResourceDiagnosticCategory,
} from "~/features/robotics/robotDiagnostics";
import {
  disclosureSummaryClass,
  sectionClass,
} from "~/features/robotics/roboticsStyles";

const severityClass = (severity: RobotDiagnostic["severity"]) =>
  severity === "error"
    ? "text-xs leading-5 text-danger"
    : severity === "warning"
      ? "text-xs leading-5 text-caution"
      : "text-xs leading-5 text-ink";

/** Advanced engineering: unique preflight diagnostics grouped by category. */
export function DiagnosticsPanel({
  diagnostics,
  obstacleCount,
}: {
  diagnostics: readonly RobotDiagnostic[];
  obstacleCount: number;
}) {
  return (
    <details className={sectionClass} data-testid="robotics-diagnostics">
      <summary className={disclosureSummaryClass}>
        Detailed diagnostics ({diagnostics.length})
      </summary>
      <div className="border-line bg-line grid gap-px border-t md:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(categoryLabels) as ResourceDiagnosticCategory[]).map(
          (category) => {
            const items = diagnostics.filter(
              (diagnostic) => diagnosticCategory(diagnostic) === category,
            );
            return (
              <div key={category} className="bg-surface p-3">
                <h3 className="text-ink text-xs font-semibold">
                  {categoryLabels[category]}
                </h3>
                {items.length === 0 ? (
                  <p className="text-muted mt-2 text-xs leading-5">
                    {category === "collision" && obstacleCount === 0
                      ? "No fixed obstacles are modeled; no collision claim is made."
                      : "No diagnostics in this category."}
                  </p>
                ) : (
                  <ul className="mt-2 grid gap-2">
                    {items.map((diagnostic) => (
                      <li
                        key={diagnosticKey(diagnostic)}
                        className={severityClass(diagnostic.severity)}
                      >
                        <span className="text-micro text-muted font-mono">
                          {diagnostic.code}
                        </span>
                        <br />
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          },
        )}
      </div>
    </details>
  );
}
