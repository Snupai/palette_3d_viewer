import { toneForReadiness } from "~/components/ui";
import { useT } from "~/i18n";
import type { RobotReadinessItem } from "~/features/robotics/robotWorkspaceModel";

/** One row per readiness check, with the evidence it is based on. */
export function ReadinessPanel({
  readiness,
  cycleDataValid,
}: {
  readiness: readonly RobotReadinessItem[];
  cycleDataValid: boolean;
}) {
  const t = useT();
  const allComplete = readiness.every((item) => item.status === "complete");
  return (
    <section className="ed-panel" aria-labelledby="rb-readiness-title">
      <div className="ed-panel-head">
        <h3 id="rb-readiness-title">{t("robotics.readiness")}</h3>
        <small>
          {!cycleDataValid
            ? t("robotics.readinessBlocked")
            : allComplete
              ? t("robotics.readinessAllPassed")
              : t("robotics.readinessChecked")}
        </small>
      </div>
      <ul className="ed-readiness">
        {readiness.map((item) => (
          <li key={item.id}>
            <span
              className="ed-badge"
              data-tone={toneForReadiness(item.status)}
            >
              {t(`robotics.status.${item.status}`)}
            </span>
            <span>
              <strong>{item.label}</strong>
              <small>{item.evidence}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="ed-warn">
        <strong>{t("robotics.readinessDisclaimerStrong")}</strong>{" "}
        {t("robotics.readinessDisclaimer")}
      </p>
    </section>
  );
}
