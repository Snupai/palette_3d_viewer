import type { RobotDiagnostic } from "~/domain/robotics";
import {
  categoryLabels,
  diagnosticCategory,
  diagnosticKey,
  type ResourceDiagnosticCategory,
} from "~/features/robotics/robotDiagnostics";

/** Technik: unique preflight diagnostics grouped by category. */
export function DiagnosticsPanel({
  diagnostics,
  obstacleCount,
}: {
  diagnostics: readonly RobotDiagnostic[];
  obstacleCount: number;
}) {
  return (
    <details className="ed-sub-details" data-testid="robotics-diagnostics">
      <summary>
        Diagnose im Detail <small>{diagnostics.length}</small>
      </summary>
      <div>
        {(Object.keys(categoryLabels) as ResourceDiagnosticCategory[]).map(
          (category) => {
            const items = diagnostics.filter(
              (diagnostic) => diagnosticCategory(diagnostic) === category,
            );
            return (
              <section key={category}>
                <h4 className="ed-panel-note">
                  <strong>{categoryLabels[category]}</strong>
                </h4>
                {items.length === 0 ? (
                  <p className="ed-panel-note">
                    {category === "collision" && obstacleCount === 0
                      ? "Keine festen Hindernisse modelliert; keine Aussage zur Kollision."
                      : "Keine Hinweise."}
                  </p>
                ) : (
                  <ul className="ed-diag">
                    {items.map((diagnostic) => (
                      <li
                        key={diagnosticKey(diagnostic)}
                        data-severity={diagnostic.severity}
                      >
                        <small className="ed-panel-note">
                          {diagnostic.code}
                        </small>
                        <br />
                        {diagnostic.message}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          },
        )}
      </div>
    </details>
  );
}
