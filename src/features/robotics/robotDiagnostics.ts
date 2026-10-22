import type { RobotDiagnostic } from "~/domain/robotics";

export type ResourceDiagnosticCategory =
  | "package"
  | "gripper"
  | "station"
  | "reach"
  | "envelope"
  | "collision"
  | "export";

export const categoryLabels: Record<ResourceDiagnosticCategory, string> = {
  package: "Plan and groups",
  gripper: "Gripper",
  station: "Pallet station",
  reach: "Robot reach",
  envelope: "Entered envelopes",
  collision: "Fixed obstacles",
  export: "Internal export",
};

export function diagnosticCategory(
  diagnostic: RobotDiagnostic,
): ResourceDiagnosticCategory {
  if (diagnostic.phase === "export") return "export";
  if (diagnostic.phase === "reach") return "reach";
  if (diagnostic.phase === "envelope") return "envelope";
  if (diagnostic.phase === "collision") return "collision";
  if (
    diagnostic.code.includes("gripper") ||
    diagnostic.phase === "compatibility"
  ) {
    return "gripper";
  }
  if (
    diagnostic.code.includes("station") ||
    diagnostic.code === "missing-pallet" ||
    diagnostic.phase === "resources"
  ) {
    return "station";
  }
  return "package";
}

export function diagnosticKey(diagnostic: RobotDiagnostic): string {
  return [
    diagnostic.severity,
    diagnostic.phase,
    diagnostic.code,
    diagnostic.cycleId ?? "",
    diagnostic.resourceId ?? "",
    diagnostic.message,
  ].join("|");
}

export function uniqueDiagnostics(
  diagnostics: readonly RobotDiagnostic[],
): RobotDiagnostic[] {
  return [
    ...new Map(diagnostics.map((item) => [diagnosticKey(item), item])).values(),
  ];
}
