"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LayerPattern } from "~/components/LayerPattern";
import { RobViewer } from "~/components/RobViewer";
import { Notice, Panel } from "~/components/ui";
import type { Project } from "~/domain/project/projectSchema";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import type { MaterializedStackResult } from "~/domain/stack";
import { StackLayerSequence } from "~/features/stack/StackLayerSequence";
import { StackResultPanel } from "~/features/stack/StackResultPanel";
import { StackSettingsPanel } from "~/features/stack/StackSettingsPanel";
import {
  calculateWorkspaceCapacity,
  candidatePatternRef,
  createInitialStackWorkspaceState,
  materializeStackWorkspace,
  type StackWorkspaceState,
} from "~/features/stack/stackWorkspaceModel";
import type { StackWorkspaceChange } from "~/features/stack/stackWorkspaceUi";
import { materializedStackToPalletData } from "~/lib/projectAdapters";
import { palletLayerToPatternPreview } from "~/lib/previewAdapters";

export type StackWorkspaceProps = {
  project: Project;
  candidates: readonly SolverCandidate[];
  solverInput: LayerSolverInput;
  onSave: (
    state: StackWorkspaceState,
    materialized: MaterializedStackResult,
  ) => Promise<void> | void;
  onDirtyChange?: (dirty: boolean) => void;
};

export function StackWorkspace({
  project,
  candidates,
  solverInput,
  onSave,
  onDirtyChange,
}: StackWorkspaceProps) {
  const candidateSignature = candidates.map(({ id }) => id).join("|");
  const [state, setState] = useState<StackWorkspaceState>(() =>
    createInitialStackWorkspaceState(candidates),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const editRevision = useRef(0);

  useEffect(() => {
    editRevision.current += 1;
    setState(createInitialStackWorkspaceState(candidates));
    setDirty(false);
    setSaveFailure(null);
    setSaveMessage(null);
  }, [candidateSignature, candidates, project.id]);

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  const change: StackWorkspaceChange = (updater) => {
    editRevision.current += 1;
    setState(updater);
    setDirty(true);
    setSaveFailure(null);
    setSaveMessage(null);
  };

  const materialized = useMemo(() => {
    try {
      return {
        result: materializeStackWorkspace(
          project,
          candidates,
          solverInput,
          state,
        ),
        error: null,
      };
    } catch (cause) {
      return {
        result: null,
        error:
          cause instanceof Error
            ? cause.message
            : "Unable to materialize the current stack.",
      };
    }
  }, [candidates, project, solverInput, state]);
  const previewData = useMemo(
    () =>
      materialized.result
        ? materializedStackToPalletData(materialized.result)
        : null,
    [materialized.result],
  );
  const topPreview = useMemo(() => {
    if (!previewData || previewData.layer_count === 0) return null;
    return palletLayerToPatternPreview(
      previewData,
      previewData.layer_count - 1,
    );
  }, [previewData]);
  const capacity = useMemo(
    () => calculateWorkspaceCapacity(project, state),
    [project, state],
  );
  const candidateByRef = useMemo(
    () =>
      new Map(
        candidates.map((candidate) => [
          candidatePatternRef(candidate),
          candidate,
        ]),
      ),
    [candidates],
  );

  const save = async () => {
    if (!materialized.result) return;
    const revisionAtSaveStart = editRevision.current;
    setSaving(true);
    setSaveFailure(null);
    setSaveMessage(null);
    try {
      await onSave(state, materialized.result);
      if (editRevision.current === revisionAtSaveStart) {
        setDirty(false);
        setSaveMessage("Stack saved to the project repository.");
      } else {
        setSaveMessage(
          "An earlier stack revision was saved. Newer edits remain unsaved.",
        );
      }
    } catch (cause) {
      console.error("Failed to save stack", cause);
      setSaveFailure(
        cause instanceof Error
          ? `Stack save failed: ${cause.message}`
          : "Stack save failed.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel
      title="Stack workspace"
      description="Compose patterns A/B, edit the physical sequence, and materialize production metrics."
      actions={
        <>
          <span className={`text-xs ${dirty ? "text-caution" : "text-muted"}`}>
            {dirty ? "Unsaved stack edits" : "Saved state"}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={
              saving || !materialized.result || state.layers.length === 0
            }
            className="ui-btn-primary text-xs"
          >
            {saving ? "Saving…" : "Save stack and continue to Robotics"}
          </button>
        </>
      }
    >
      {materialized.error ? (
        <Notice tone="blocked" className="m-3">
          {materialized.error}
        </Notice>
      ) : null}
      {saveFailure ? (
        <Notice tone="blocked" className="m-3">
          {saveFailure}
        </Notice>
      ) : null}
      {saveMessage ? (
        <Notice tone="info" className="m-3">
          {saveMessage}
        </Notice>
      ) : null}

      <div className="grid min-h-0 xl:grid-cols-[minmax(440px,0.9fr)_minmax(520px,1.1fr)]">
        <div className="border-line grid content-start gap-4 border-b p-3 xl:border-r xl:border-b-0">
          <StackSettingsPanel
            state={state}
            candidates={candidates}
            capacity={capacity}
            change={change}
          />
          <StackLayerSequence
            state={state}
            candidates={candidates}
            candidateByRef={candidateByRef}
            change={change}
          />
        </div>

        <div className="grid min-h-0 content-start gap-3 p-3">
          <div className="grid min-h-[420px] gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
            <div className="border-line bg-viewport min-h-[420px] overflow-hidden border">
              {previewData && previewData.layer_count > 0 ? (
                <RobViewer
                  data={previewData}
                  cameraResetKey={`${project.id}:${candidateSignature}`}
                  visibleUpToLayer={previewData.layer_count}
                  showSceneControls
                />
              ) : (
                <div className="text-viewport-ink/60 flex h-full min-h-[420px] items-center justify-center text-sm">
                  Build a stack to preview it in 3D.
                </div>
              )}
            </div>
            <div className="grid content-start gap-3">
              <div className="border-line bg-canvas min-h-[180px] overflow-hidden border p-2">
                {topPreview ? (
                  <LayerPattern
                    preview={topPreview}
                    showGroupLabels={false}
                    className="h-full min-h-[164px] w-full"
                  />
                ) : (
                  <div className="text-muted flex min-h-[164px] items-center justify-center text-xs">
                    No top layer
                  </div>
                )}
              </div>
              <p className="text-muted text-xs leading-5">
                The 3D toolbar provides top, front, right-top, lifted-top, and
                layer-label views.
              </p>
            </div>
          </div>

          {materialized.result ? (
            <StackResultPanel result={materialized.result} />
          ) : null}
          <p className="text-micro text-muted leading-5">
            The shared thickness remains the ProjectV2 compatibility fallback;
            exact base, boundary, and deck thickness overrides persist with the
            current project stack.
          </p>
        </div>
      </div>
    </Panel>
  );
}
