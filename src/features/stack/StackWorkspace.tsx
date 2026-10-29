"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LayerPattern } from "~/components/LayerPattern";
import { RobViewer } from "~/components/RobViewer";
import { Notice, Panel } from "~/components/ui";
import { useT } from "~/i18n";
import type { Project } from "~/domain/project/projectSchema";
import type { LayerSolverInput, SolverCandidate } from "~/domain/solver";
import type { MaterializedStackResult } from "~/domain/stack";
import type { GuidedSectionId } from "~/features/project/guidedProjectFormModel";
import {
  GuidedStackWorkspace,
  type GuidedStackSubstep,
} from "~/features/stack/GuidedStackWorkspace";
import { createGuidedInitialState } from "~/features/stack/guidedStackModel";
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
  ) => Promise<"saved" | "cancelled" | void> | "saved" | "cancelled" | void;
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Full-page guided composition (stack, then review/save) instead of the
   * classic panel. Uses the same state, materialization, and save path.
   */
  guided?: boolean;
  /** Guided mode: return to pattern selection. */
  onBack?: () => void;
  /** Guided mode: open the project inputs, optionally at a section. */
  onEditProject?: (section?: GuidedSectionId) => void;
  /** Guided mode: reports whether the stack or the review substep is shown. */
  onSubstepChange?: (substep: GuidedStackSubstep) => void;
};

export function StackWorkspace({
  project,
  candidates,
  solverInput,
  onSave,
  onDirtyChange,
  guided = false,
  onBack,
  onEditProject,
  onSubstepChange,
}: StackWorkspaceProps) {
  const t = useT();
  const candidateSignature = candidates.map(({ id }) => id).join("|");
  const initialState = () =>
    guided
      ? createGuidedInitialState(project, candidates)
      : createInitialStackWorkspaceState(candidates);
  const [state, setState] = useState<StackWorkspaceState>(initialState);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const editRevision = useRef(0);
  const seededFrom = useRef({ projectId: project.id, candidateSignature });
  const [seedSignature, setSeedSignature] = useState(candidateSignature);

  useEffect(() => {
    const previous = seededFrom.current;
    seededFrom.current = { projectId: project.id, candidateSignature };
    // A background solver run that appends patterns, or none, leaves the
    // seed intact.
    if (
      previous.projectId === project.id &&
      previous.candidateSignature !== "" &&
      (candidateSignature === previous.candidateSignature ||
        candidateSignature.startsWith(`${previous.candidateSignature}|`))
    ) {
      return;
    }
    setSeedSignature(candidateSignature);
    editRevision.current += 1;
    setState(initialState());
    setDirty(false);
    setSaveFailure(null);
    setSaveMessage(null);
    // `initialState` reads the same inputs listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          cause instanceof Error ? cause.message : t("stack.materializeFailed"),
      };
    }
  }, [candidates, project, solverInput, state, t]);
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
      const outcome = await onSave(state, materialized.result);
      if (outcome === "cancelled") return;
      if (editRevision.current === revisionAtSaveStart) {
        setDirty(false);
        setSaveMessage(
          guided ? t("stack.save.saved") : t("stack.classic.saved"),
        );
      } else {
        setSaveMessage(
          guided
            ? t("stack.save.savedEarlier")
            : t("stack.classic.savedEarlier"),
        );
      }
    } catch (cause) {
      console.error("Failed to save stack", cause);
      setSaveFailure(
        guided
          ? cause instanceof Error
            ? t("stack.save.failedWith", { message: cause.message })
            : t("stack.save.failed")
          : cause instanceof Error
            ? t("stack.classic.saveFailedWith", { message: cause.message })
            : t("stack.classic.saveFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  if (guided) {
    return (
      <GuidedStackWorkspace
        key={`${project.id}:${seedSignature}`}
        project={project}
        candidates={candidates}
        solverInput={solverInput}
        state={state}
        change={change}
        result={materialized.result}
        error={materialized.error}
        previewData={previewData}
        capacity={capacity}
        candidateByRef={candidateByRef}
        dirty={dirty}
        saving={saving}
        saveFailure={saveFailure}
        saveMessage={saveMessage}
        onSaveClick={() => void save()}
        onBack={onBack}
        onEditProject={onEditProject}
        onSubstepChange={onSubstepChange}
      />
    );
  }

  return (
    <Panel
      title={t("stack.classic.title")}
      actions={
        <>
          <span
            className={`text-micro ${dirty ? "text-caution" : "text-muted"}`}
          >
            {dirty
              ? t("stack.classic.unsavedEdits")
              : t("stack.classic.savedState")}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={
              saving || !materialized.result || state.layers.length === 0
            }
            className="ui-btn-primary text-micro"
          >
            {saving
              ? t("stack.classic.saving")
              : t("stack.classic.saveAndContinue")}
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
                <div className="text-viewport-ink/60 text-body flex h-full min-h-[420px] items-center justify-center">
                  {t("stack.classic.buildToPreview")}
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
                  <div className="text-muted text-micro flex min-h-[164px] items-center justify-center">
                    {t("stack.classic.noTopLayer")}
                  </div>
                )}
              </div>
            </div>
          </div>

          {materialized.result ? (
            <StackResultPanel result={materialized.result} />
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
