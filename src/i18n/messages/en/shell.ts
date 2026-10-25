import type { shellDe } from "../de/shell";

export const shellEn = {
  "shell.appName": "Pallet Planner",
  "shell.home": "Pallet Planner home",
  "shell.plans": "Plans",
  "shell.planLibrary": "Plan library",
  "shell.newPlan": "New plan",
  "shell.editAndCheck": "Edit & check",
  "shell.tool.editor": "Pattern editor",
  "shell.tool.robotics": "Robotics & gripper",
  "shell.tool.simulation": "Simulation",
  "shell.tool.report": "Pallet sheet",
  "shell.locked": "Locked",
  "shell.language": "Language",
  "shell.unsaved": "The plan has unsaved changes.",
  "shell.saved": "The plan is saved locally.",
} as const satisfies Record<keyof typeof shellDe, string>;
