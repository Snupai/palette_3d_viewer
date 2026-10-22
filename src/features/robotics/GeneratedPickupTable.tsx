import type { RobotCycleMaterialization } from "~/domain/robotics";

const columns = [
  "#",
  "Layer",
  "Group",
  "Packages",
  "Pick X",
  "Pick Y",
  "Pick Z",
  "Pick yaw",
  "Transfer X/Y/Z",
  "Place X",
  "Place Y",
  "Place Z",
  "Place yaw",
  "Frame",
  "Source",
] as const;

export function GeneratedPickupTable({
  materialization,
}: {
  materialization: RobotCycleMaterialization;
}) {
  return (
    <div className="scrollbar-thin border-line overflow-auto border-t">
      <table className="ui-table min-w-[1120px]">
        <thead>
          <tr>
            {columns.map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono">
          {materialization.cycles.map((cycle) => (
            <tr key={cycle.id}>
              <td>{cycle.sequence + 1}</td>
              <td>{cycle.physicalLayerIndex + 1}</td>
              <td className="max-w-[180px] truncate" title={cycle.groupId}>
                G{cycle.groupNumber}
              </td>
              <td>{cycle.packageCount}</td>
              <td>{cycle.pickPose.positionMm.x}</td>
              <td>{cycle.pickPose.positionMm.y}</td>
              <td>{cycle.pickPose.positionMm.z}</td>
              <td>{cycle.pickPose.yawDeg}°</td>
              <td>
                {cycle.transferPose.positionMm.x} /{" "}
                {cycle.transferPose.positionMm.y} /{" "}
                {cycle.transferPose.positionMm.z}
              </td>
              <td>{cycle.placePose.positionMm.x}</td>
              <td>{cycle.placePose.positionMm.y}</td>
              <td>{cycle.placePose.positionMm.z}</td>
              <td>{cycle.placePose.yawDeg}°</td>
              <td>{cycle.placePose.frame}</td>
              <td className="font-sans">{cycle.provenance.cycleSource}</td>
            </tr>
          ))}
          {materialization.cycles.length === 0 ? (
            <tr>
              <td
                colSpan={15}
                className="text-muted px-3! py-6! text-center font-sans"
              >
                No calculated pickups are available.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
