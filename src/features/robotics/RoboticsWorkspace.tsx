"use client";

import { useEffect, useMemo, useState } from "react";
import { pickOffsetForCount } from "~/domain/palletGeometry";
import {
  getMultipackEquipmentProfile,
  isMultipackProfileGripper,
  isMultipackProfileStation,
  resolveMultipackEquipmentProfile,
} from "~/domain/project/equipmentProfiles";
import { updateProject } from "~/domain/project/projectFactory";
import {
  createProjectResource,
  updateProjectResource,
  type ProjectResource,
} from "~/domain/project/projectResource";
import {
  gripperSchema,
  palletStationSchema,
  type Gripper,
  type PalletStation,
  type Project,
} from "~/domain/project/projectSchema";
import {
  exportProjectRob,
  getRetainedRawRobDownload,
  type RobotCycleMaterialization,
} from "~/domain/robotics";
import { DiagnosticsPanel } from "~/features/robotics/DiagnosticsPanel";
import { ExportMappingPanel } from "~/features/robotics/ExportMappingPanel";
import { GeneratedPickupTable } from "~/features/robotics/GeneratedPickupTable";
import { NumericDraftField } from "~/features/robotics/NumericDraftField";
import { ObstacleEditor } from "~/features/robotics/ObstacleEditor";
import { ReadinessPanel } from "~/features/robotics/ReadinessPanel";
import {
  GripperEditor,
  StationEditor,
} from "~/features/robotics/ResourceEditors";
import {
  BuiltInProfileNotice,
  ResourceLibraryPanel,
} from "~/features/robotics/ResourceLibraryPanel";
import { uniqueDiagnostics } from "~/features/robotics/robotDiagnostics";
import {
  createEditableGripperCopy,
  createEditableStationCopy,
  createPalletStationDraft,
  createSuctionGripperDraft,
  projectWithGripper,
  projectWithStation,
} from "~/features/robotics/resourceTemplates";
import {
  createInitialRobotExportSettings,
  createRobotReadiness,
  projectRobExportGate,
  robDownloadFileName,
  workspaceUsesDerivedPickReference,
  type RobotExportWorkspaceSettings,
  type RobotWorkspaceSettings,
} from "~/features/robotics/robotWorkspaceModel";
import { useT } from "~/i18n";
import { downloadText } from "~/lib/download";
import type { ProjectRepository } from "~/lib/projectRepository";

export type RoboticsWorkspaceProps = {
  project: Project;
  repository: ProjectRepository;
  materialization: RobotCycleMaterialization;
  settings: RobotWorkspaceSettings;
  onSettingsChange: (settings: RobotWorkspaceSettings) => void;
  onSaveProject: (project: Project) => Promise<Project>;
  onPreviewMotion?: () => void;
};

function safeFilename(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  return normalized || fallback;
}

function resourceGrippers(
  resources: readonly ProjectResource[],
): Extract<ProjectResource, { kind: "gripper" }>[] {
  return resources.filter(
    (resource): resource is Extract<ProjectResource, { kind: "gripper" }> =>
      resource.kind === "gripper",
  );
}

function resourceStations(
  resources: readonly ProjectResource[],
): Extract<ProjectResource, { kind: "pallet-station" }>[] {
  return resources.filter(
    (
      resource,
    ): resource is Extract<ProjectResource, { kind: "pallet-station" }> =>
      resource.kind === "pallet-station",
  );
}

export function RoboticsWorkspace({
  project,
  repository,
  materialization,
  settings,
  onSettingsChange,
  onSaveProject,
  onPreviewMotion,
}: RoboticsWorkspaceProps) {
  const t = useT();
  const selectedGripper =
    project.grippers.find(({ id }) => id === project.selectedGripperId) ?? null;
  const selectedStation =
    project.palletStations.find(
      ({ id }) => id === project.selectedPalletStationId,
    ) ?? null;
  const selectedProfile = resolveMultipackEquipmentProfile(project);
  const multipackProfile = useMemo(() => getMultipackEquipmentProfile(), []);
  const [gripperDraft, setGripperDraft] = useState<Gripper | null>(
    selectedGripper,
  );
  const [stationDraft, setStationDraft] = useState<PalletStation | null>(
    selectedStation,
  );
  const [libraryResources, setLibraryResources] = useState<ProjectResource[]>(
    [],
  );
  const [libraryGripperId, setLibraryGripperId] = useState("");
  const [libraryStationId, setLibraryStationId] = useState("");
  const [exportSettings, setExportSettings] =
    useState<RobotExportWorkspaceSettings>(() =>
      createInitialRobotExportSettings(),
    );
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setGripperDraft(selectedGripper), [selectedGripper]);
  useEffect(() => setStationDraft(selectedStation), [selectedStation]);
  useEffect(() => {
    setExportSettings(createInitialRobotExportSettings());
  }, [project.id]);

  const refreshLibrary = async () => {
    const result = await repository.listResources({
      sortBy: "name",
      sortDirection: "asc",
    });
    setLibraryResources(result.resources);
    if (result.diagnostics.length > 0) {
      setError(result.diagnostics.map(({ message }) => message).join("\n"));
    }
  };

  useEffect(() => {
    void refreshLibrary().catch((cause: unknown) => {
      setError(
        cause instanceof Error
          ? cause.message
          : t("robotics.errorTemplateLibraryLoad"),
      );
    });
    // Repository identity is stable for the workspace lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  const gripperLibrary = resourceGrippers(libraryResources);
  const stationLibrary = resourceStations(libraryResources);
  const gripperDraftIsBuiltIn = isMultipackProfileGripper(gripperDraft);
  const stationDraftIsBuiltIn = isMultipackProfileStation(stationDraft);
  const exportGate = useMemo(
    () => projectRobExportGate(materialization, exportSettings),
    [exportSettings, materialization],
  );
  const diagnostics = useMemo(
    () => uniqueDiagnostics(exportGate.preflight.diagnostics),
    [exportGate.preflight.diagnostics],
  );
  const exportBlockingIssues = diagnostics.filter(
    ({ severity }) => severity === "error",
  ).length;
  const readiness = useMemo(
    () =>
      createRobotReadiness(
        project,
        materialization,
        settings,
        exportGate.enabled,
        exportBlockingIssues,
        t,
      ),
    [
      exportBlockingIssues,
      exportGate.enabled,
      materialization,
      project,
      settings,
      t,
    ],
  );
  const activeSolution =
    project.solutions.find(({ id }) => id === project.activeSolutionId) ?? null;
  const patternById = new Map(
    activeSolution?.patterns.map((pattern) => [pattern.id, pattern]) ?? [],
  );
  const plannedPackageCount =
    activeSolution?.stack.layers.reduce(
      (sum, layer) =>
        sum + (patternById.get(layer.patternId)?.placements.length ?? 0),
      0,
    ) ?? 0;
  const derivedPickup = workspaceUsesDerivedPickReference(settings);
  const pickInputDirection =
    project.package.inletOrientation === "crosswise" ? 1 : 0;
  const pickYawDeg = 0 as const;
  const singlePickOffset = pickOffsetForCount(
    project.package.dimensionsMm.length,
    project.package.dimensionsMm.width,
    pickInputDirection,
    pickYawDeg,
    1,
  );
  const groupedPickCount = Math.max(
    1,
    Math.trunc(Number(settings.maxPackagesPerPick) || 1),
  );
  const groupedPickOffset = pickOffsetForCount(
    project.package.dimensionsMm.length,
    project.package.dimensionsMm.width,
    pickInputDirection,
    pickYawDeg,
    groupedPickCount,
  );

  const saveProjectChange = async (nextProject: Project, message: string) => {
    setError(null);
    setStatus(null);
    try {
      await onSaveProject(nextProject);
      setStatus(message);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("robotics.errorSaveFailed"),
      );
    }
  };

  const selectGripper = (id: string) =>
    saveProjectChange(
      updateProject(project, { selectedGripperId: id || null }),
      id
        ? t("robotics.statusGripperApplied")
        : t("robotics.statusGripperRemoved"),
    );
  const selectStation = (id: string) =>
    saveProjectChange(
      updateProject(project, { selectedPalletStationId: id || null }),
      id
        ? t("robotics.statusStationApplied")
        : t("robotics.statusStationRemoved"),
    );

  const saveGripper = async () => {
    if (!gripperDraft) return;
    if (isMultipackProfileGripper(gripperDraft)) {
      setError(t("robotics.errorBuiltInGripperReadOnly"));
      return;
    }
    const parsed = gripperSchema.safeParse(gripperDraft);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("\n"),
      );
      return;
    }
    await saveProjectChange(
      projectWithGripper(project, parsed.data),
      t("robotics.statusGripperSaved", { name: parsed.data.name }),
    );
  };

  const saveStation = async () => {
    if (!stationDraft) return;
    if (isMultipackProfileStation(stationDraft)) {
      setError(t("robotics.errorBuiltInStationReadOnly"));
      return;
    }
    const parsed = palletStationSchema.safeParse(stationDraft);
    if (!parsed.success) {
      setError(
        parsed.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("\n"),
      );
      return;
    }
    await saveProjectChange(
      projectWithStation(project, parsed.data),
      t("robotics.statusStationSaved", { name: parsed.data.name }),
    );
  };

  const saveGripperTemplate = async () => {
    if (!gripperDraft) return;
    if (isMultipackProfileGripper(gripperDraft)) {
      setError(t("robotics.errorBuiltInNotInLibrary"));
      return;
    }
    const value = gripperSchema.parse(gripperDraft);
    const existing = gripperLibrary.find(({ id }) => id === value.id);
    const resource = existing
      ? updateProjectResource(existing, value)
      : createProjectResource({ kind: "gripper", value });
    await repository.saveResource(resource);
    setLibraryGripperId(resource.id);
    setStatus(
      t("robotics.statusGripperTemplateSaved", { name: resource.name }),
    );
    await refreshLibrary();
  };

  const saveStationTemplate = async () => {
    if (!stationDraft) return;
    if (isMultipackProfileStation(stationDraft)) {
      setError(t("robotics.errorBuiltInNotInLibrary"));
      return;
    }
    const value = palletStationSchema.parse(stationDraft);
    const existing = stationLibrary.find(({ id }) => id === value.id);
    const resource = existing
      ? updateProjectResource(existing, value)
      : createProjectResource({ kind: "pallet-station", value });
    await repository.saveResource(resource);
    setLibraryStationId(resource.id);
    setStatus(
      t("robotics.statusStationTemplateSaved", { name: resource.name }),
    );
    await refreshLibrary();
  };

  const applyGripperTemplate = async () => {
    const resource = gripperLibrary.find(({ id }) => id === libraryGripperId);
    if (!resource) return;
    setGripperDraft(resource.value);
    await saveProjectChange(
      projectWithGripper(project, resource.value),
      t("robotics.statusGripperTemplateApplied", { name: resource.name }),
    );
  };

  const applyStationTemplate = async () => {
    const resource = stationLibrary.find(({ id }) => id === libraryStationId);
    if (!resource) return;
    setStationDraft(resource.value);
    await saveProjectChange(
      projectWithStation(project, resource.value),
      t("robotics.statusStationTemplateApplied", { name: resource.name }),
    );
  };

  const removeTemplate = async (kind: "gripper" | "station") => {
    const id = kind === "gripper" ? libraryGripperId : libraryStationId;
    if (!id) return;
    await repository.deleteResource(id);
    if (kind === "gripper") setLibraryGripperId("");
    else setLibraryStationId("");
    setStatus(t("robotics.statusTemplateRemoved"));
    await refreshLibrary();
  };

  const exportGenerated = () => {
    const result = exportProjectRob(materialization, exportGate.options);
    if (!result.ok || !result.text) {
      setError(result.diagnostics.map(({ message }) => message).join("\n"));
      return;
    }
    downloadText(result.text, robDownloadFileName(project));
    setStatus(t("robotics.statusRobExported"));
  };

  const downloadRetained = (variant: "original" | "edited") => {
    const retained = getRetainedRawRobDownload(project, variant);
    if (!retained) return;
    downloadText(
      retained.text,
      `${safeFilename(retained.fileName, "import.rob")}.${variant}.rob`,
    );
  };

  const retainedOriginal = getRetainedRawRobDownload(project, "original");
  const retainedEdited = getRetainedRawRobDownload(project, "edited");
  const box = project.package.dimensionsMm;

  return (
    <div className="ed" data-testid="robotics-workspace">
      <div className="ed-bar">
        <div className="ed-bar-title">
          <h2>{t("robotics.title")}</h2>
          <p>
            {activeSolution
              ? t("robotics.summaryCalculated", {
                  layers: t("robotics.layerCount", {
                    count: activeSolution.stack.layers.length,
                  }),
                  packages: t("robotics.packageCount", {
                    count: plannedPackageCount,
                  }),
                  pickups: t("robotics.pickupCount", {
                    count: materialization.cycles.length,
                  }),
                })
              : t("robotics.noStack")}
          </p>
        </div>
        <div className="ed-bar-actions">
          <span
            className="ed-status"
            data-dirty={exportGate.enabled ? undefined : "true"}
          >
            {exportGate.enabled
              ? t("robotics.exportEnabled")
              : t("robotics.openItemsUnderAdvanced", {
                  items: t("robotics.openItems", {
                    count: exportBlockingIssues,
                  }),
                })}
          </span>
          <button
            type="button"
            className="ui-btn"
            disabled={!onPreviewMotion || materialization.cycles.length === 0}
            onClick={onPreviewMotion}
          >
            {t("robotics.previewMotion")}
          </button>
          <button
            type="button"
            className="ui-btn-primary"
            disabled={!exportGate.enabled}
            onClick={exportGenerated}
          >
            {t("robotics.exportRob")}
          </button>
        </div>
      </div>

      <div className="ed-alerts">
        {error ? (
          <div
            role="alert"
            className="fw-alert"
            style={{ whiteSpace: "pre-line" }}
          >
            {error}
          </div>
        ) : null}
        {status ? (
          <div role="status" className="fw-info">
            {status}
          </div>
        ) : null}
      </div>

      <div className="ed-layout">
        <div className="ed-main">
          <section className="ed-panel" aria-labelledby="rb-equipment-title">
            <div className="ed-panel-head">
              <h3 id="rb-equipment-title">{t("robotics.equipment")}</h3>
              <small>
                {selectedProfile
                  ? t("robotics.multipackProfile", {
                      version: selectedProfile.version,
                    })
                  : project.source.kind === "rob-import"
                    ? t("robotics.notDerivableFromImport")
                    : t("robotics.checkAgainstRealCell")}
              </small>
            </div>
            <div className="ed-grid2">
              <label className="ed-field">
                {t("robotics.gripper")}
                <select
                  aria-label={t("robotics.gripperOfPlan")}
                  value={project.selectedGripperId ?? ""}
                  onChange={(event) => void selectGripper(event.target.value)}
                  className="ui-input"
                >
                  <option value="">{t("robotics.selectGripper")}</option>
                  {project.grippers.map((gripper) => (
                    <option key={gripper.id} value={gripper.id}>
                      {gripper.name} (
                      {t(`robotics.gripperType.${gripper.settings.type}`)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="ed-field">
                {t("robotics.palletStation")}
                <select
                  aria-label={t("robotics.palletStationOfPlan")}
                  value={project.selectedPalletStationId ?? ""}
                  onChange={(event) => void selectStation(event.target.value)}
                  className="ui-input"
                >
                  <option value="">{t("robotics.selectStation")}</option>
                  {project.palletStations.map((station) => (
                    <option key={station.id} value={station.id}>
                      {station.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedProfile ? (
              <p className="ed-panel-note">
                {t("robotics.profileNote", {
                  version: selectedProfile.provenance.applicationVersion,
                })}
              </p>
            ) : null}
          </section>

          <section className="ed-panel" aria-labelledby="rb-pickup-title">
            <div className="ed-panel-head">
              <h3 id="rb-pickup-title">{t("robotics.pickup")}</h3>
              <small>
                {derivedPickup
                  ? t("robotics.pickupDerivedTop")
                  : t("robotics.pickupSurveyed")}
              </small>
            </div>
            <div className="ed-grid2">
              <NumericDraftField
                label={t("robotics.packagesPerPickup")}
                value={settings.maxPackagesPerPick}
                onChange={(value) =>
                  onSettingsChange({ ...settings, maxPackagesPerPick: value })
                }
              />
            </div>
            <p className="ed-panel-note">
              {derivedPickup
                ? t("robotics.pickupDerivedNote", {
                    length: box.length,
                    width: box.width,
                    height: box.height,
                    singleX: singlePickOffset.x,
                    singleY: singlePickOffset.y,
                    grouped: project.package.multiPickAllowed
                      ? t("robotics.pickupGroupedNote", {
                          count: groupedPickCount,
                          groupedX: groupedPickOffset.x,
                          groupedY: groupedPickOffset.y,
                        })
                      : "",
                    yaw: pickYawDeg,
                  })
                : t("robotics.pickupSurveyedNote")}
            </p>
          </section>

          <details
            className="ed-panel-details"
            data-testid="generated-pickup-list"
          >
            <summary>
              {t("robotics.calculatedPickups")}{" "}
              <small>{materialization.cycles.length}</small>
            </summary>
            <div>
              <GeneratedPickupTable materialization={materialization} />
            </div>
          </details>

          <details className="ed-panel-details" data-testid="robotics-advanced">
            <summary>
              {t("robotics.advanced")}{" "}
              <small>
                {exportBlockingIssues === 0
                  ? t("robotics.noOpenItems")
                  : t("robotics.openItems", { count: exportBlockingIssues })}
              </small>
            </summary>
            <div>
              <p className="ed-warn">{t("robotics.advancedWarning")}</p>

              <details className="ed-sub-details">
                <summary>{t("robotics.pickPointAndEvidence")}</summary>
                <div>
                  <p className="ed-panel-note">{t("robotics.pickPointHint")}</p>
                  <div className="ed-grid4">
                    {(
                      [
                        [t("robotics.xMm"), "pickX"],
                        [t("robotics.yMm"), "pickY"],
                        [t("robotics.zMm"), "pickZ"],
                        [t("robotics.rotationDeg"), "pickYaw"],
                      ] as const
                    ).map(([label, field]) => (
                      <NumericDraftField
                        key={field}
                        label={label}
                        value={settings[field]}
                        onChange={(value) =>
                          onSettingsChange({ ...settings, [field]: value })
                        }
                      />
                    ))}
                  </div>
                  <div className="ed-grid2">
                    <NumericDraftField
                      label={t("robotics.transferClearance")}
                      value={settings.transferClearanceMm}
                      onChange={(value) =>
                        onSettingsChange({
                          ...settings,
                          transferClearanceMm: value,
                        })
                      }
                    />
                    <label className="ed-field">
                      {t("robotics.pickReferenceStatus")}
                      <select
                        value={settings.pickReferenceStatus}
                        onChange={(event) =>
                          onSettingsChange({
                            ...settings,
                            pickReferenceStatus: event.target.value as
                              | "verified"
                              | "unverified",
                          })
                        }
                        className="ui-input"
                      >
                        <option value="unverified">
                          {t("robotics.statusUnverified")}
                        </option>
                        <option value="verified">
                          {t("robotics.statusVerified")}
                        </option>
                      </select>
                    </label>
                  </div>
                  <label className="ed-field">
                    {t("robotics.pickReferenceSource")}
                    <input
                      value={settings.pickReferenceSource}
                      onChange={(event) =>
                        onSettingsChange({
                          ...settings,
                          pickReferenceSource: event.target.value,
                        })
                      }
                      className="ui-input"
                    />
                  </label>
                </div>
              </details>

              <details className="ed-sub-details">
                <summary>
                  {t("robotics.fixedObstacles")}{" "}
                  <small>{settings.obstacles.length}</small>
                </summary>
                <div>
                  <ObstacleEditor
                    obstacles={settings.obstacles}
                    onChange={(obstacles) =>
                      onSettingsChange({ ...settings, obstacles })
                    }
                  />
                </div>
              </details>

              <ResourceLibraryPanel
                title={t("robotics.gripperLibraryTitle")}
                libraryAriaLabel={t("robotics.gripperTemplates")}
                libraryPlaceholder={t("robotics.selectGripperTemplate")}
                libraryOptions={gripperLibrary}
                libraryId={libraryGripperId}
                onLibraryIdChange={setLibraryGripperId}
                onApplyTemplate={() => void applyGripperTemplate()}
                onRemoveTemplate={() => void removeTemplate("gripper")}
                createDraftLabel={t("robotics.createSuctionGripper")}
                onCreateDraft={() =>
                  setGripperDraft(createSuctionGripperDraft(project))
                }
                hasDraft={gripperDraft !== null}
                draftIsBuiltIn={gripperDraftIsBuiltIn}
                onCreateEditableCopy={() => {
                  if (gripperDraft) {
                    setGripperDraft(createEditableGripperCopy(gripperDraft));
                  }
                }}
                onSaveToProject={() => void saveGripper()}
                onSaveTemplate={() => void saveGripperTemplate()}
                builtInNote={
                  <>
                    <BuiltInProfileNotice version={multipackProfile.version} />
                    <p>{t("robotics.gripperBuiltInLimits")}</p>
                  </>
                }
                editor={
                  gripperDraft ? (
                    <GripperEditor
                      value={gripperDraft}
                      onChange={setGripperDraft}
                    />
                  ) : null
                }
                emptyText={t("robotics.gripperEmpty")}
              />

              <ResourceLibraryPanel
                title={t("robotics.stationLibraryTitle")}
                libraryAriaLabel={t("robotics.stationTemplates")}
                libraryPlaceholder={t("robotics.selectStationTemplate")}
                libraryOptions={stationLibrary}
                libraryId={libraryStationId}
                onLibraryIdChange={setLibraryStationId}
                onApplyTemplate={() => void applyStationTemplate()}
                onRemoveTemplate={() => void removeTemplate("station")}
                createDraftLabel={t("robotics.createStation")}
                onCreateDraft={() =>
                  setStationDraft(createPalletStationDraft(project))
                }
                hasDraft={stationDraft !== null}
                draftIsBuiltIn={stationDraftIsBuiltIn}
                onCreateEditableCopy={() => {
                  if (stationDraft) {
                    setStationDraft(createEditableStationCopy(stationDraft));
                  }
                }}
                onSaveToProject={() => void saveStation()}
                onSaveTemplate={() => void saveStationTemplate()}
                builtInNote={
                  <>
                    <BuiltInProfileNotice version={multipackProfile.version} />
                    <p>{t("robotics.stationBuiltInLimits")}</p>
                  </>
                }
                editor={
                  stationDraft ? (
                    <StationEditor
                      value={stationDraft}
                      onChange={setStationDraft}
                    />
                  ) : null
                }
                emptyText={t("robotics.stationEmpty")}
              />

              <DiagnosticsPanel
                diagnostics={diagnostics}
                obstacleCount={settings.obstacles.length}
              />

              <ExportMappingPanel
                exportSettings={exportSettings}
                onChange={setExportSettings}
              />

              {retainedOriginal || retainedEdited ? (
                <details className="ed-sub-details">
                  <summary>{t("robotics.importedOriginal")}</summary>
                  <div>
                    <div className="ed-actions">
                      <button
                        type="button"
                        disabled={!retainedOriginal}
                        onClick={() => downloadRetained("original")}
                        className="ui-btn ui-btn-sm"
                      >
                        {t("robotics.downloadOriginal")}
                      </button>
                      <button
                        type="button"
                        disabled={!retainedEdited}
                        onClick={() => downloadRetained("edited")}
                        className="ui-btn ui-btn-sm"
                      >
                        {t("robotics.downloadEdited")}
                      </button>
                    </div>
                  </div>
                </details>
              ) : null}
            </div>
          </details>
        </div>

        <aside className="ed-side">
          <ReadinessPanel
            readiness={readiness}
            cycleDataValid={materialization.valid}
          />
        </aside>
      </div>
    </div>
  );
}
