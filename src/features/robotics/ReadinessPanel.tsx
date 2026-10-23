import { toneForReadiness } from "~/components/ui";
import type {
  RobotReadinessItem,
  RobotReadinessStatus,
} from "~/features/robotics/robotWorkspaceModel";

const statusLabels: Record<RobotReadinessStatus, string> = {
  complete: "Bereit",
  "needs-input": "Eingabe nötig",
  engineering: "Technik prüfen",
  "not-checked": "Nicht geprüft",
  warning: "Prüfen",
  blocked: "Blockiert",
};

const itemLabels: Record<string, string> = {
  plan: "Plan und Griffliste",
  equipment: "Ausrüstung",
  pickup: "Aufnahmepunkt",
  workspace: "Arbeitsraum der Station",
  obstacles: "Hindernisse",
  export: "Export-Zuordnung",
};

/** One row per readiness check, with the evidence it is based on. */
export function ReadinessPanel({
  readiness,
  cycleDataValid,
}: {
  readiness: readonly RobotReadinessItem[];
  cycleDataValid: boolean;
}) {
  const allComplete = readiness.every((item) => item.status === "complete");
  return (
    <section className="ed-panel" aria-labelledby="rb-readiness-title">
      <div className="ed-panel-head">
        <h3 id="rb-readiness-title">Bereitschaft</h3>
        <small>
          {!cycleDataValid
            ? "Griffdaten blockiert"
            : allComplete
              ? "alle Prüfungen bestanden"
              : "Projektdaten geprüft"}
        </small>
      </div>
      <ul className="ed-readiness">
        {readiness.map((item) => (
          <li key={item.id}>
            <span
              className="ed-badge"
              data-tone={toneForReadiness(item.status)}
            >
              {statusLabels[item.status]}
            </span>
            <span>
              <strong>{itemLabels[item.id] ?? item.label}</strong>
              <small>{item.evidence}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="ed-warn">
        <strong>Produktionsfreigabe wird hier nicht bewertet.</strong> Greifer,
        Stationsrahmen, Programmzuordnung, Schutzeinrichtungen und das
        vollständige Kollisionsmodell vor dem Einsatz an der Anlage prüfen.
      </p>
    </section>
  );
}
