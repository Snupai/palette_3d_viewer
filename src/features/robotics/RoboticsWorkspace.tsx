"use client";

import { useEffect, useMemo, useState } from "react";
import { Notice, Panel } from "~/components/ui";
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
  buttonClass,
  cautionNoteClass,
  disclosureSummaryClass,
  fieldLabelClass,
  inputClass,
  sectionClass,
} from "~/features/robotics/roboticsStyles";
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
        cause instanceof Error ? cause.message : "Resource library failed.",
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
      ),
    [
      exportBlockingIssues,
      exportGate.enabled,
      materialization,
      project,
      settings,
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
        cause instanceof Error ? cause.message : "Project update failed.",
      );
    }
  };

  const selectGripper = (id: string) =>
    saveProjectChange(
      updateProject(project, { selectedGripperId: id || null }),
      id ? "Gripper selected." : "Gripper selection cleared.",
    );
  const selectStation = (id: string) =>
    saveProjectChange(
      updateProject(project, { selectedPalletStationId: id || null }),
      id ? "Pallet station selected." : "Pallet station selection cleared.",
    );

  const saveGripper = async () => {
    if (!gripperDraft) return;
    if (isMultipackProfileGripper(gripperDraft)) {
      setError(
        "The built-in Multipack gripper is read-only. Create an editable copy before changing project equipment.",
      );
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
      `Gripper "${parsed.data.name}" saved to the project.`,
    );
  };

  const saveStation = async () => {
    if (!stationDraft) return;
    if (isMultipackProfileStation(stationDraft)) {
      setError(
        "The built-in Multipack station is read-only. Create an editable copy before changing project equipment.",
      );
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
      `Pallet station "${parsed.data.name}" saved to the project.`,
    );
  };

  const saveGripperTemplate = async () => {
    if (!gripperDraft) return;
    if (isMultipackProfileGripper(gripperDraft)) {
      setError(
        "Built-in profile resources are not added to the reusable library. Create an editable copy first.",
      );
      return;
    }
    const value = gripperSchema.parse(gripperDraft);
    const existing = gripperLibrary.find(({ id }) => id === value.id);
    const resource = existing
      ? updateProjectResource(existing, value)
      : createProjectResource({ kind: "gripper", value });
    await repository.saveResource(resource);
    setLibraryGripperId(resource.id);
    setStatus(`Gripper template "${resource.name}" saved.`);
    await refreshLibrary();
  };

  const saveStationTemplate = async () => {
    if (!stationDraft) return;
    if (isMultipackProfileStation(stationDraft)) {
      setError(
        "Built-in profile resources are not added to the reusable library. Create an editable copy first.",
      );
      return;
    }
    const value = palletStationSchema.parse(stationDraft);
    const existing = stationLibrary.find(({ id }) => id === value.id);
    const resource = existing
      ? updateProjectResource(existing, value)
      : createProjectResource({ kind: "pallet-station", value });
    await repository.saveResource(resource);
    setLibraryStationId(resource.id);
    setStatus(`Pallet station template "${resource.name}" saved.`);
    await refreshLibrary();
  };

  const applyGripperTemplate = async () => {
    const resource = gripperLibrary.find(({ id }) => id === libraryGripperId);
    if (!resource) return;
    setGripperDraft(resource.value);
    await saveProjectChange(
      projectWithGripper(project, resource.value),
      `Gripper template "${resource.name}" applied to the project.`,
    );
  };

  const applyStationTemplate = async () => {
    const resource = stationLibrary.find(({ id }) => id === libraryStationId);
    if (!resource) return;
    setStationDraft(resource.value);
    await saveProjectChange(
      projectWithStation(project, resource.value),
      `Pallet station template "${resource.name}" applied to the project.`,
    );
  };

  const removeTemplate = async (kind: "gripper" | "station") => {
    const id = kind === "gripper" ? libraryGripperId : libraryStationId;
    if (!id) return;
    await repository.deleteResource(id);
    if (kind === "gripper") setLibraryGripperId("");
    else setLibraryStationId("");
    setStatus(
      "Template removed from the reusable library; project copies were retained.",
    );
    await refreshLibrary();
  };

  const exportGenerated = () => {
    const result = exportProjectRob(materialization, exportGate.options);
    if (!result.ok || !result.text) {
      setError(result.diagnostics.map(({ message }) => message).join("\n"));
      return;
    }
    downloadText(result.text, robDownloadFileName(project));
    setStatus(
      "Project-derived .rob exported after parser roundtrip verification.",
    );
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

  return (
    <div className="grid gap-3" data-testid="robotics-workspace">
      {error ? (
        <Notice tone="blocked" className="text-body whitespace-pre-line">
          {error}
        </Notice>
      ) : null}
      {status ? (
        <Notice tone="info" className="text-body">
          {status}
        </Notice>
      ) : null}

      <section className="border-brand/30 bg-surface border">
        <header className="border-brand/20 border-b px-3 py-3">
          <p className="text-micro text-brand font-mono tracking-[0.18em] uppercase">
            Operator view
          </p>
          <h2 className="text-ink mt-1 text-base font-semibold">Robot setup</h2>
          <p className="text-muted text-micro mt-1 max-w-3xl leading-5">
            Choose the equipment, review the derived pickup, and check
            readiness. Detailed equipment and export settings stay closed until
            needed.
          </p>
        </header>
        <div className="bg-line grid gap-px sm:grid-cols-3">
          <div className="bg-surface p-3">
            <p className="text-micro text-muted tracking-wide uppercase">
              Package
            </p>
            <p className="text-ink text-body mt-1 font-mono">
              {project.package.dimensionsMm.length} ×{" "}
              {project.package.dimensionsMm.width} ×{" "}
              {project.package.dimensionsMm.height} mm
            </p>
          </div>
          <div className="bg-surface p-3">
            <p className="text-micro text-muted tracking-wide uppercase">
              Pallet plan
            </p>
            <p className="text-ink text-body mt-1">
              {activeSolution
                ? `${activeSolution.stack.layers.length} layer${activeSolution.stack.layers.length === 1 ? "" : "s"} · ${plannedPackageCount} package${plannedPackageCount === 1 ? "" : "s"}`
                : "No active plan"}
            </p>
          </div>
          <div className="bg-surface p-3">
            <p className="text-micro text-muted tracking-wide uppercase">
              Calculated output
            </p>
            <p className="text-ink text-body mt-1">
              {materialization.cycles.length} pickup
              {materialization.cycles.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </section>

      <Panel
        title="1. Select equipment"
        description={
          selectedProfile
            ? `Multipack Roboter observed defaults v${selectedProfile.version} are preselected for this project.`
            : project.source.kind === "rob-import"
              ? "Imported .rob files do not select or infer equipment."
              : "Select equipment that has been checked against the real cell."
        }
        bodyClassName="grid gap-3 p-3 md:grid-cols-2"
      >
        <label className="text-muted text-micro grid gap-1">
          Gripper
          <select
            aria-label="Selected project gripper"
            value={project.selectedGripperId ?? ""}
            onChange={(event) => void selectGripper(event.target.value)}
            className={inputClass}
          >
            <option value="">Select a gripper…</option>
            {project.grippers.map((gripper) => (
              <option key={gripper.id} value={gripper.id}>
                {gripper.name} ({gripper.settings.type})
              </option>
            ))}
          </select>
        </label>
        <label className="text-muted text-micro grid gap-1">
          Pallet station
          <select
            aria-label="Selected project station"
            value={project.selectedPalletStationId ?? ""}
            onChange={(event) => void selectStation(event.target.value)}
            className={inputClass}
          >
            <option value="">Select a pallet station…</option>
            {project.palletStations.map((station) => (
              <option key={station.id} value={station.id}>
                {station.name}
              </option>
            ))}
          </select>
        </label>
        {selectedProfile ? (
          <p className={`${cautionNoteClass} md:col-span-2`}>
            Observed in Multipack für Roboter{" "}
            {selectedProfile.provenance.applicationVersion} and corroborated
            against the active local plan database. This is documented
            configuration evidence, not a station survey or production
            calibration. Radial reach remains uncalibrated.
          </p>
        ) : null}
      </Panel>

      <Panel
        title="2. Pickup point"
        description="Pickup is the top-center of each box group. X/Y come from package size and count; Z is the top of the packages. A surveyed conveyor origin is not required."
        bodyClassName="grid gap-3 p-3"
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
          <NumericDraftField
            label="Packages per pickup"
            value={settings.maxPackagesPerPick}
            onChange={(value) =>
              onSettingsChange({ ...settings, maxPackagesPerPick: value })
            }
          />
        </div>
        {derivedPickup ? (
          <p className="text-micro text-muted leading-5">
            Derived pickup for this package: 1-pack {singlePickOffset.x} ×{" "}
            {singlePickOffset.y} mm
            {project.package.multiPickAllowed
              ? `; ${groupedPickCount}-pack ${groupedPickOffset.x} × ${groupedPickOffset.y} mm`
              : ""}
            . Z {project.package.dimensionsMm.height} mm, yaw {pickYawDeg}°.
          </p>
        ) : (
          <p className="text-micro text-muted leading-5">
            Using the surveyed pickup coordinates entered under Advanced
            engineering.
          </p>
        )}
        <p className="text-micro text-muted leading-5">
          Planning values start at{" "}
          {project.package.multiPickAllowed ? "2" : "1"} package
          {project.package.multiPickAllowed ? "s" : ""} per calculated pickup
          and 200 mm travel clearance. These are editable internal planning
          values, not imported equipment or production defaults.
        </p>
      </Panel>

      <ReadinessPanel
        readiness={readiness}
        cycleDataValid={materialization.valid}
      />

      <Panel
        title="Output"
        description="Preview the calculated motion or export only after the internal preflight is ready."
        bodyClassName="flex flex-wrap items-center gap-3 p-3"
      >
        <button
          type="button"
          disabled={!onPreviewMotion || materialization.cycles.length === 0}
          onClick={onPreviewMotion}
          className="ui-btn"
        >
          Preview calculated motion
        </button>
        <button
          type="button"
          disabled={!exportGate.enabled}
          onClick={exportGenerated}
          className="ui-btn-primary"
        >
          Export project-derived .rob
        </button>
        <span
          className={
            exportGate.enabled ? "text-ok text-micro" : "text-muted text-micro"
          }
        >
          {exportGate.enabled
            ? "Internal export preflight passed."
            : `${exportBlockingIssues} blocking issue${exportBlockingIssues === 1 ? "" : "s"}; review Advanced engineering.`}
        </span>
      </Panel>

      <details className={sectionClass} data-testid="generated-pickup-list">
        <summary className={disclosureSummaryClass}>
          Generated pickup list ({materialization.cycles.length})
        </summary>
        <p className="border-line text-muted text-micro border-t px-3 py-2 leading-5">
          These canonical coordinates are shared with motion preview, reports,
          and project-derived export.
        </p>
        <GeneratedPickupTable materialization={materialization} />
      </details>

      <details className={sectionClass} data-testid="robotics-advanced">
        <summary className={disclosureSummaryClass}>
          Advanced engineering
        </summary>
        <div className="border-line bg-canvas grid gap-3 border-t p-3">
          <p className={cautionNoteClass}>
            Equipment drafts and entered mappings are unverified engineering
            data. Check them against the real cell before use.
          </p>

          <details className={sectionClass}>
            <summary className={disclosureSummaryClass}>
              Motion values and pickup evidence
            </summary>
            <div className="border-line grid gap-3 border-t p-3">
              <p className="text-muted text-micro leading-5">
                Leave X, Y, and Z blank to keep the derived box-group
                top-center. Entering all four values treats pickup as a surveyed
                station pose.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
                {(
                  [
                    ["X (mm)", "pickX"],
                    ["Y (mm)", "pickY"],
                    ["Z (mm)", "pickZ"],
                    ["Yaw (deg)", "pickYaw"],
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
              <div className="grid gap-2 md:grid-cols-2">
                <NumericDraftField
                  label="Travel clearance (mm)"
                  value={settings.transferClearanceMm}
                  onChange={(value) =>
                    onSettingsChange({
                      ...settings,
                      transferClearanceMm: value,
                    })
                  }
                />
                <label className={fieldLabelClass}>
                  Pickup point state
                  <select
                    value={settings.pickReferenceStatus}
                    onChange={(event) =>
                      onSettingsChange({
                        ...settings,
                        pickReferenceStatus: event.target.value as
                          "verified" | "unverified",
                      })
                    }
                    className={inputClass}
                  >
                    <option value="unverified">Not checked</option>
                    <option value="verified">
                      Checked against stated source
                    </option>
                  </select>
                </label>
              </div>
              <label className={fieldLabelClass}>
                Pickup point evidence
                <input
                  value={settings.pickReferenceSource}
                  onChange={(event) =>
                    onSettingsChange({
                      ...settings,
                      pickReferenceSource: event.target.value,
                    })
                  }
                  className={inputClass}
                />
              </label>
            </div>
          </details>

          <details className={sectionClass}>
            <summary className={disclosureSummaryClass}>
              Fixed obstacles ({settings.obstacles.length})
            </summary>
            <div className="border-line border-t p-3">
              <ObstacleEditor
                obstacles={settings.obstacles}
                onChange={(obstacles) =>
                  onSettingsChange({ ...settings, obstacles })
                }
              />
            </div>
          </details>

          <ResourceLibraryPanel
            title="Gripper library and editor"
            libraryAriaLabel="Gripper template library"
            libraryPlaceholder="Choose reusable gripper template…"
            libraryOptions={gripperLibrary}
            libraryId={libraryGripperId}
            onLibraryIdChange={setLibraryGripperId}
            onApplyTemplate={() => void applyGripperTemplate()}
            onRemoveTemplate={() => void removeTemplate("gripper")}
            createDraftLabel="Create unverified suction draft"
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
                <p>
                  Maximum pickup length: 450 mm. Package limits: lengthwise
                  50–500 × 50–420 mm; crosswise 50–500 × 50–300 mm; height
                  50–400 mm.
                </p>
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
            emptyText="Select or create a gripper to edit it."
          />

          <ResourceLibraryPanel
            title="Pallet station library and editor"
            libraryAriaLabel="Station template library"
            libraryPlaceholder="Choose reusable station template…"
            libraryOptions={stationLibrary}
            libraryId={libraryStationId}
            onLibraryIdChange={setLibraryStationId}
            onApplyTemplate={() => void applyStationTemplate()}
            onRemoveTemplate={() => void removeTemplate("station")}
            createDraftLabel="Create unverified station draft"
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
                <p>
                  Pallet origin: right / bottom. TCP envelope: ±2000 mm.
                  Free-space contour: ±1500 mm. Robot radius 0 / 0 is retained
                  as an uncalibrated legacy sentinel, so radial reach is not
                  checked.
                </p>
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
            emptyText="Select or create a pallet station to edit it."
          />

          <DiagnosticsPanel
            diagnostics={diagnostics}
            obstacleCount={settings.obstacles.length}
          />

          <ExportMappingPanel
            exportSettings={exportSettings}
            onChange={setExportSettings}
          />
        </div>
      </details>

      {retainedOriginal || retainedEdited ? (
        <details className="border-measure/50 bg-surface border">
          <summary className={disclosureSummaryClass}>
            Imported source-file downloads
          </summary>
          <div className="border-measure/40 grid gap-3 border-t p-3">
            <p className="text-muted text-micro leading-5">
              These downloads return retained imported text. They are not
              project-derived output and make no compatibility or production
              claim.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!retainedOriginal}
                onClick={() => downloadRetained("original")}
                className={buttonClass}
              >
                Download retained original .rob
              </button>
              <button
                type="button"
                disabled={!retainedEdited}
                onClick={() => downloadRetained("edited")}
                className={buttonClass}
              >
                Download retained edited .rob
              </button>
            </div>
          </div>
        </details>
      ) : null}
    </div>
  );
}
