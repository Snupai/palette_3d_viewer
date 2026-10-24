import type { RobotCycleMaterialization } from "~/domain/robotics";

const columns = [
  "#",
  "Lage",
  "Griff",
  "Pakete",
  "Aufnahme X",
  "Aufnahme Y",
  "Aufnahme Z",
  "Aufnahme Drehung",
  "Transfer X/Y/Z",
  "Ablage X",
  "Ablage Y",
  "Ablage Z",
  "Ablage Drehung",
  "Rahmen",
  "Quelle",
] as const;

export function GeneratedPickupTable({
  materialization,
}: {
  materialization: RobotCycleMaterialization;
}) {
  return (
    <div className="ed-table-wide">
      <table className="ed-table">
        <thead>
          <tr>
            {columns.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {materialization.cycles.map((cycle) => (
            <tr key={cycle.id}>
              <td className="num">{cycle.sequence + 1}</td>
              <td className="num">{cycle.physicalLayerIndex + 1}</td>
              <td title={cycle.groupId}>G{cycle.groupNumber}</td>
              <td className="num">{cycle.packageCount}</td>
              <td className="num">{cycle.pickPose.positionMm.x}</td>
              <td className="num">{cycle.pickPose.positionMm.y}</td>
              <td className="num">{cycle.pickPose.positionMm.z}</td>
              <td className="num">{cycle.pickPose.yawDeg}°</td>
              <td className="num">
                {cycle.transferPose.positionMm.x} /{" "}
                {cycle.transferPose.positionMm.y} /{" "}
                {cycle.transferPose.positionMm.z}
              </td>
              <td className="num">{cycle.placePose.positionMm.x}</td>
              <td className="num">{cycle.placePose.positionMm.y}</td>
              <td className="num">{cycle.placePose.positionMm.z}</td>
              <td className="num">{cycle.placePose.yawDeg}°</td>
              <td>{cycle.placePose.frame}</td>
              <td>{cycle.provenance.cycleSource}</td>
            </tr>
          ))}
          {materialization.cycles.length === 0 ? (
            <tr>
              <td colSpan={15} className="ed-panel-note">
                Noch keine Griffe berechnet.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
