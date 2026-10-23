import { Panel, StatusBadge, toneForReadiness } from "~/components/ui";
import type {
  RobotReadinessItem,
  RobotReadinessStatus,
} from "~/features/robotics/robotWorkspaceModel";

const readinessLabels: Record<RobotReadinessStatus, string> = {
  complete: "Ready",
  "needs-input": "Needs input",
  engineering: "Engineering",
  "not-checked": "Not checked",
  warning: "Check",
  blocked: "Blocked",
};

/** Step 3: one row per readiness check, with the evidence it is based on. */
export function ReadinessPanel({
  readiness,
  cycleDataValid,
}: {
  readiness: readonly RobotReadinessItem[];
  cycleDataValid: boolean;
}) {
  const allComplete = readiness.every((item) => item.status === "complete");
  return (
    <Panel
      title="3. Review readiness"
      description="Each row states what this workspace actually checked."
      actions={
        <span
          className={`text-micro ${
            !cycleDataValid
              ? "text-danger"
              : allComplete
                ? "text-ok"
                : "text-caution"
          }`}
        >
          {!cycleDataValid
            ? "Cycle data has blocking issues"
            : allComplete
              ? "Cycle data checks passed"
              : "Available project data parsed"}
        </span>
      }
    >
      <ul className="bg-line grid gap-px md:grid-cols-2">
        {readiness.map((item) => (
          <li key={item.id} className="bg-surface flex gap-3 p-3">
            <StatusBadge
              tone={toneForReadiness(item.status)}
              label={readinessLabels[item.status]}
              framed
              className="h-fit min-w-[82px] justify-center"
            />
            <div className="min-w-0">
              <p className="text-ink text-micro font-semibold">{item.label}</p>
              <p className="text-muted text-micro mt-1 leading-5">
                {item.evidence}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-caution/40 bg-caution/5 text-ink text-micro border-t px-3 py-2 leading-5">
        <strong>Production feasibility is not assessed.</strong> Confirm the
        real gripper, station frame, robot program mapping, guarding, and full
        collision model before production use.
      </div>
    </Panel>
  );
}
