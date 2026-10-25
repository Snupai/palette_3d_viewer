import type { RobotDiagnostic } from "~/domain/robotics";
import { useT } from "~/i18n";
import {
  diagnosticCategories,
  diagnosticCategory,
  diagnosticKey,
} from "~/features/robotics/robotDiagnostics";

/** Technik: unique preflight diagnostics grouped by category. */
export function DiagnosticsPanel({
  diagnostics,
  obstacleCount,
}: {
  diagnostics: readonly RobotDiagnostic[];
  obstacleCount: number;
}) {
  const t = useT();
  return (
    <details className="ed-sub-details" data-testid="robotics-diagnostics">
      <summary>
        {t("robotics.diagnosticsDetail")} <small>{diagnostics.length}</small>
      </summary>
      <div>
        {diagnosticCategories.map((category) => {
          const items = diagnostics.filter(
            (diagnostic) => diagnosticCategory(diagnostic) === category,
          );
          return (
            <section key={category}>
              <h4 className="ed-panel-note">
                <strong>{t(`robotics.category.${category}`)}</strong>
              </h4>
              {items.length === 0 ? (
                <p className="ed-panel-note">
                  {category === "collision" && obstacleCount === 0
                    ? t("robotics.diagnosticsNoCollision")
                    : t("robotics.diagnosticsNone")}
                </p>
              ) : (
                <ul className="ed-diag">
                  {items.map((diagnostic) => (
                    <li
                      key={diagnosticKey(diagnostic)}
                      data-severity={diagnostic.severity}
                    >
                      <small className="ed-panel-note">{diagnostic.code}</small>
                      <br />
                      {diagnostic.message}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </details>
  );
}
