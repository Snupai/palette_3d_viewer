/**
 * One status vocabulary for the whole planner. Every workspace maps its own
 * states (ledger PASS/FAIL, robotics readiness, …) onto these tones so the
 * same meaning always gets the same colour and symbol.
 */
export type StatusTone =
  | "pass"
  | "caution"
  | "blocked"
  | "observed"
  | "info"
  | "unknown";

export const statusToneText: Record<StatusTone, string> = {
  pass: "text-ok",
  caution: "text-caution",
  blocked: "text-danger",
  observed: "text-measure",
  info: "text-info",
  unknown: "text-muted",
};

export const statusToneBorder: Record<StatusTone, string> = {
  pass: "border-ok",
  caution: "border-caution",
  blocked: "border-danger",
  observed: "border-measure",
  info: "border-info",
  unknown: "border-line",
};

export const statusToneSymbol: Record<StatusTone, string> = {
  pass: "■",
  caution: "▲",
  blocked: "×",
  observed: "◇",
  info: "●",
  unknown: "–",
};

export type LedgerStatus = "PASS" | "FAIL" | "BLOCKED" | "OBSERVED" | "SKIPPED";

export function toneForLedgerStatus(status: LedgerStatus): StatusTone {
  switch (status) {
    case "PASS":
      return "pass";
    case "FAIL":
      return "blocked";
    case "BLOCKED":
      return "caution";
    case "OBSERVED":
      return "observed";
    case "SKIPPED":
      return "unknown";
  }
}

export type ReadinessStatus =
  | "complete"
  | "needs-input"
  | "engineering"
  | "not-checked"
  | "warning"
  | "blocked";

export function toneForReadiness(status: ReadinessStatus): StatusTone {
  switch (status) {
    case "complete":
      return "pass";
    case "needs-input":
    case "warning":
      return "caution";
    case "engineering":
      return "info";
    case "not-checked":
      return "unknown";
    case "blocked":
      return "blocked";
  }
}
