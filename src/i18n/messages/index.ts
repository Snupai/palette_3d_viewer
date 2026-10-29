import type { Locale } from "../locales";
import { shellDe } from "./de/shell";
import { projectDe } from "./de/project";
import { projectFormDe } from "./de/projectForm";
import { candidatesDe } from "./de/candidates";
import { editorDe } from "./de/editor";
import { stackDe } from "./de/stack";
import { roboticsDe } from "./de/robotics";
import { simulationDe } from "./de/simulation";
import { reportingDe } from "./de/reporting";
import { planningCaseDe } from "./de/planningCase";
import { plannerDe } from "./de/planner";
import { componentsDe } from "./de/components";
import { shellEn } from "./en/shell";
import { projectEn } from "./en/project";
import { projectFormEn } from "./en/projectForm";
import { candidatesEn } from "./en/candidates";
import { editorEn } from "./en/editor";
import { stackEn } from "./en/stack";
import { roboticsEn } from "./en/robotics";
import { simulationEn } from "./en/simulation";
import { reportingEn } from "./en/reporting";
import { planningCaseEn } from "./en/planningCase";
import { plannerEn } from "./en/planner";
import { componentsEn } from "./en/components";

/**
 * German is the source language: its key set defines `MessageKey`. Every other
 * locale file is checked with `satisfies Record<keyof typeof <ns>De, string>`
 * so missing or extra keys fail the typecheck.
 *
 * One file per namespace in `de/` and `en/`; namespaces are merged here. Keys
 * are flat, dotted and prefixed with the namespace (`"stack.save"`).
 */
export const de = {
  ...shellDe,
  ...projectDe,
  ...projectFormDe,
  ...candidatesDe,
  ...editorDe,
  ...stackDe,
  ...roboticsDe,
  ...simulationDe,
  ...reportingDe,
  ...planningCaseDe,
  ...plannerDe,
  ...componentsDe,
} as const;

export type MessageKey = keyof typeof de;
export type Messages = Record<MessageKey, string>;

export const en: Messages = {
  ...shellEn,
  ...projectEn,
  ...projectFormEn,
  ...candidatesEn,
  ...editorEn,
  ...stackEn,
  ...roboticsEn,
  ...simulationEn,
  ...reportingEn,
  ...planningCaseEn,
  ...plannerEn,
  ...componentsEn,
};

export const MESSAGES: Record<Locale, Messages> = { de, en };
