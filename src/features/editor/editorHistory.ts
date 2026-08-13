import type { Project } from "~/domain/project/projectSchema";
import {
  applyProjectEditorCommand,
  describeProjectEditorCommand,
  normalizeProjectForEditor,
  ProjectEditorCommandError,
  type ProjectEditorCommand,
  type ProjectEditorDiagnostic,
} from "~/features/editor/editorModel";

const MAX_EDITOR_HISTORY = 100;

export type ProjectEditorHistoryEntry = {
  project: Project;
  description: string;
  mode: ProjectEditorCommand["mode"];
};

export type ProjectEditorHistoryState = {
  original: Project;
  persisted: Project;
  present: Project;
  past: readonly ProjectEditorHistoryEntry[];
  future: readonly ProjectEditorHistoryEntry[];
  lastDescription: string | null;
  error: string | null;
  diagnostics: readonly ProjectEditorDiagnostic[];
};

export type ProjectEditorHistoryAction =
  | { type: "execute"; command: ProjectEditorCommand }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset-to-original" }
  | { type: "discard" }
  | { type: "mark-saved"; project?: Project; snapshot?: Project }
  | { type: "replace"; project: Project }
  | { type: "clear-error" };

export function createProjectEditorHistory(
  project: Project,
): ProjectEditorHistoryState {
  const normalizedProject = normalizeProjectForEditor(project);
  return {
    original: normalizedProject,
    persisted: normalizedProject,
    present: normalizedProject,
    past: [],
    future: [],
    lastDescription: null,
    error: null,
    diagnostics: [],
  };
}

function fingerprint(project: Project): string {
  return JSON.stringify(project);
}

export function projectEditorHistoryDirty(
  state: ProjectEditorHistoryState,
): boolean {
  return fingerprint(state.present) !== fingerprint(state.persisted);
}

export function projectEditorCanReset(
  state: ProjectEditorHistoryState,
): boolean {
  return fingerprint(state.present) !== fingerprint(state.original);
}

export function projectEditorHistoryPosition(
  state: ProjectEditorHistoryState,
): { position: number; length: number } {
  return {
    position: state.past.length + 1,
    length: state.past.length + state.future.length + 1,
  };
}

function pushEntry(
  entries: readonly ProjectEditorHistoryEntry[],
  entry: ProjectEditorHistoryEntry,
): ProjectEditorHistoryEntry[] {
  return [...entries, entry].slice(-MAX_EDITOR_HISTORY);
}

export function projectEditorHistoryReducer(
  state: ProjectEditorHistoryState,
  action: ProjectEditorHistoryAction,
): ProjectEditorHistoryState {
  switch (action.type) {
    case "execute": {
      try {
        const next = applyProjectEditorCommand(state.present, action.command);
        if (fingerprint(next) === fingerprint(state.present)) {
          return {
            ...state,
            error: null,
            diagnostics: [],
            lastDescription: describeProjectEditorCommand(action.command),
          };
        }
        const description = describeProjectEditorCommand(action.command);
        return {
          ...state,
          present: next,
          past: pushEntry(state.past, {
            project: state.present,
            description,
            mode: action.command.mode,
          }),
          future: [],
          lastDescription: description,
          error: null,
          diagnostics: [],
        };
      } catch (cause) {
        if (cause instanceof ProjectEditorCommandError) {
          return {
            ...state,
            error: cause.message,
            diagnostics: cause.diagnostics,
          };
        }
        return {
          ...state,
          error:
            cause instanceof Error
              ? cause.message
              : "The editor command could not be applied.",
          diagnostics: [],
        };
      }
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        present: previous.project,
        past: state.past.slice(0, -1),
        future: [
          {
            project: state.present,
            description: previous.description,
            mode: previous.mode,
          },
          ...state.future,
        ],
        lastDescription: `Undo ${previous.description}`,
        error: null,
        diagnostics: [],
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        present: next.project,
        past: pushEntry(state.past, {
          project: state.present,
          description: next.description,
          mode: next.mode,
        }),
        future: state.future.slice(1),
        lastDescription: `Redo ${next.description}`,
        error: null,
        diagnostics: [],
      };
    }
    case "reset-to-original": {
      if (!projectEditorCanReset(state)) return state;
      return {
        ...state,
        present: state.original,
        past: pushEntry(state.past, {
          project: state.present,
          description: "Reset to original project",
          mode: "pattern",
        }),
        future: [],
        lastDescription: "Reset to original project",
        error: null,
        diagnostics: [],
      };
    }
    case "discard":
      return {
        ...state,
        present: state.persisted,
        past: [],
        future: [],
        lastDescription: "Discard unsaved editor changes",
        error: null,
        diagnostics: [],
      };
    case "mark-saved": {
      const project = action.project ?? state.present;
      const snapshot = action.snapshot ?? state.present;
      const snapshotFingerprint = fingerprint(snapshot);
      const rebaseEntries = (entries: readonly ProjectEditorHistoryEntry[]) =>
        entries.map((entry) =>
          fingerprint(entry.project) === snapshotFingerprint
            ? { ...entry, project }
            : entry,
        );
      return {
        ...state,
        persisted: project,
        present:
          fingerprint(state.present) === snapshotFingerprint
            ? project
            : state.present,
        past: rebaseEntries(state.past),
        future: rebaseEntries(state.future),
        lastDescription: "Save project editor changes",
        error: null,
        diagnostics: [],
      };
    }
    case "replace":
      return createProjectEditorHistory(action.project);
    case "clear-error":
      return { ...state, error: null, diagnostics: [] };
  }
}
