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
import { countLabel } from "~/features/editor/editorLabels";
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

const gripperTypeLabels: Record<Gripper["settings"]["type"], string> = {
  suction: "Sauggreifer",
  clamp: "Klammergreifer",
  fork: "Gabelgreifer",
};

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
        cause instanceof Error
          ? cause.message
          : "Die Vorlagenbibliothek konnte nicht geladen werden.",
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
        cause instanceof Error ? cause.message : "Speichern fehlgeschlagen.",
      );
    }
  };

  const selectGripper = (id: string) =>
    saveProjectChange(
      updateProject(project, { selectedGripperId: id || null }),
      id ? "Greifer übernommen." : "Greiferauswahl entfernt.",
    );
  const selectStation = (id: string) =>
    saveProjectChange(
      updateProject(project, { selectedPalletStationId: id || null }),
      id ? "Palettenstation übernommen." : "Stationsauswahl entfernt.",
    );

  const saveGripper = async () => {
    if (!gripperDraft) return;
    if (isMultipackProfileGripper(gripperDraft)) {
      setError(
        "Der mitgelieferte Multipack-Greifer ist schreibgeschützt. Zuerst eine bearbeitbare Kopie anlegen.",
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
      `Greifer „${parsed.data.name}“ im Plan gespeichert.`,
    );
  };

  const saveStation = async () => {
    if (!stationDraft) return;
    if (isMultipackProfileStation(stationDraft)) {
      setError(
        "Die mitgelieferte Multipack-Station ist schreibgeschützt. Zuerst eine bearbeitbare Kopie anlegen.",
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
      `Palettenstation „${parsed.data.name}“ im Plan gespeichert.`,
    );
  };

  const saveGripperTemplate = async () => {
    if (!gripperDraft) return;
    if (isMultipackProfileGripper(gripperDraft)) {
      setError(
        "Mitgelieferte Profile werden nicht in die Bibliothek übernommen. Zuerst eine bearbeitbare Kopie anlegen.",
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
    setStatus(`Greifervorlage „${resource.name}“ gespeichert.`);
    await refreshLibrary();
  };

  const saveStationTemplate = async () => {
    if (!stationDraft) return;
    if (isMultipackProfileStation(stationDraft)) {
      setError(
        "Mitgelieferte Profile werden nicht in die Bibliothek übernommen. Zuerst eine bearbeitbare Kopie anlegen.",
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
    setStatus(`Stationsvorlage „${resource.name}“ gespeichert.`);
    await refreshLibrary();
  };

  const applyGripperTemplate = async () => {
    const resource = gripperLibrary.find(({ id }) => id === libraryGripperId);
    if (!resource) return;
    setGripperDraft(resource.value);
    await saveProjectChange(
      projectWithGripper(project, resource.value),
      `Greifervorlage „${resource.name}“ in den Plan übernommen.`,
    );
  };

  const applyStationTemplate = async () => {
    const resource = stationLibrary.find(({ id }) => id === libraryStationId);
    if (!resource) return;
    setStationDraft(resource.value);
    await saveProjectChange(
      projectWithStation(project, resource.value),
      `Stationsvorlage „${resource.name}“ in den Plan übernommen.`,
    );
  };

  const removeTemplate = async (kind: "gripper" | "station") => {
    const id = kind === "gripper" ? libraryGripperId : libraryStationId;
    if (!id) return;
    await repository.deleteResource(id);
    if (kind === "gripper") setLibraryGripperId("");
    else setLibraryStationId("");
    setStatus(
      "Vorlage aus der Bibliothek entfernt; die Kopie im Plan bleibt erhalten.",
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
    setStatus(".rob-Datei exportiert und per Parser-Rücklauf geprüft.");
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
          <h2>Robotik & Greifer</h2>
          <p>
            {activeSolution
              ? `${countLabel(activeSolution.stack.layers.length, "Lage", "Lagen")} · ${countLabel(plannedPackageCount, "Paket", "Pakete")} · ${countLabel(materialization.cycles.length, "Griff", "Griffe")} berechnet`
              : "Kein gespeicherter Stapel"}
          </p>
        </div>
        <div className="ed-bar-actions">
          <span
            className="ed-status"
            data-dirty={exportGate.enabled ? undefined : "true"}
          >
            {exportGate.enabled
              ? "Export freigegeben"
              : `${countLabel(exportBlockingIssues, "offener Punkt", "offene Punkte")} unter Technik`}
          </span>
          <button
            type="button"
            className="ui-btn"
            disabled={!onPreviewMotion || materialization.cycles.length === 0}
            onClick={onPreviewMotion}
          >
            Bewegung ansehen
          </button>
          <button
            type="button"
            className="ui-btn-primary"
            disabled={!exportGate.enabled}
            onClick={exportGenerated}
          >
            .rob exportieren
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
              <h3 id="rb-equipment-title">Ausrüstung</h3>
              <small>
                {selectedProfile
                  ? `Multipack-Profil v${selectedProfile.version}`
                  : project.source.kind === "rob-import"
                    ? "aus .rob-Import nicht ableitbar"
                    : "gegen die reale Zelle prüfen"}
              </small>
            </div>
            <div className="ed-grid2">
              <label className="ed-field">
                Greifer
                <select
                  aria-label="Greifer des Plans"
                  value={project.selectedGripperId ?? ""}
                  onChange={(event) => void selectGripper(event.target.value)}
                  className="ui-input"
                >
                  <option value="">Greifer wählen …</option>
                  {project.grippers.map((gripper) => (
                    <option key={gripper.id} value={gripper.id}>
                      {gripper.name} ({gripperTypeLabels[gripper.settings.type]}
                      )
                    </option>
                  ))}
                </select>
              </label>
              <label className="ed-field">
                Palettenstation
                <select
                  aria-label="Palettenstation des Plans"
                  value={project.selectedPalletStationId ?? ""}
                  onChange={(event) => void selectStation(event.target.value)}
                  className="ui-input"
                >
                  <option value="">Station wählen …</option>
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
                Aus „Multipack für Roboter“{" "}
                {selectedProfile.provenance.applicationVersion}, nicht
                vermessen.
              </p>
            ) : null}
          </section>

          <section className="ed-panel" aria-labelledby="rb-pickup-title">
            <div className="ed-panel-head">
              <h3 id="rb-pickup-title">Aufnahme</h3>
              <small>
                {derivedPickup
                  ? "Oberkante Mitte der Paketgruppe"
                  : "vermessener Aufnahmepunkt"}
              </small>
            </div>
            <div className="ed-grid2">
              <NumericDraftField
                label="Pakete je Griff"
                value={settings.maxPackagesPerPick}
                onChange={(value) =>
                  onSettingsChange({ ...settings, maxPackagesPerPick: value })
                }
              />
            </div>
            <p className="ed-panel-note">
              {derivedPickup
                ? `Aufnahme für ${box.length} × ${box.width} × ${box.height} mm: einzeln ${singlePickOffset.x} / ${singlePickOffset.y} mm${
                    project.package.multiPickAllowed
                      ? `, ${groupedPickCount}er-Griff ${groupedPickOffset.x} / ${groupedPickOffset.y} mm`
                      : ""
                  }. Z ${box.height} mm, Drehung ${pickYawDeg}°.`
                : "Es gelten die unter Technik eingetragenen vermessenen Koordinaten."}
            </p>
          </section>

          <details
            className="ed-panel-details"
            data-testid="generated-pickup-list"
          >
            <summary>
              Berechnete Griffe <small>{materialization.cycles.length}</small>
            </summary>
            <div>
              <GeneratedPickupTable materialization={materialization} />
            </div>
          </details>

          <details className="ed-panel-details" data-testid="robotics-advanced">
            <summary>
              Technik{" "}
              <small>
                {exportBlockingIssues === 0
                  ? "keine offenen Punkte"
                  : countLabel(
                      exportBlockingIssues,
                      "offener Punkt",
                      "offene Punkte",
                    )}
              </small>
            </summary>
            <div>
              <p className="ed-warn">
                Greiferentwürfe und Zuordnungen sind ungeprüfte Technikdaten.
                Vor dem Einsatz gegen die reale Zelle prüfen.
              </p>

              <details className="ed-sub-details">
                <summary>Aufnahmepunkt und Nachweis</summary>
                <div>
                  <p className="ed-panel-note">
                    Leer = berechnete Oberkante Mitte.
                  </p>
                  <div className="ed-grid4">
                    {(
                      [
                        ["X (mm)", "pickX"],
                        ["Y (mm)", "pickY"],
                        ["Z (mm)", "pickZ"],
                        ["Drehung (°)", "pickYaw"],
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
                      label="Fahrhöhe über dem Stapel (mm)"
                      value={settings.transferClearanceMm}
                      onChange={(value) =>
                        onSettingsChange({
                          ...settings,
                          transferClearanceMm: value,
                        })
                      }
                    />
                    <label className="ed-field">
                      Stand des Aufnahmepunkts
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
                        <option value="unverified">Nicht geprüft</option>
                        <option value="verified">
                          Gegen die angegebene Quelle geprüft
                        </option>
                      </select>
                    </label>
                  </div>
                  <label className="ed-field">
                    Quelle des Aufnahmepunkts
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
                  Feste Hindernisse <small>{settings.obstacles.length}</small>
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
                title="Greifer: Bibliothek und Editor"
                libraryAriaLabel="Greifervorlagen"
                libraryPlaceholder="Greifervorlage wählen …"
                libraryOptions={gripperLibrary}
                libraryId={libraryGripperId}
                onLibraryIdChange={setLibraryGripperId}
                onApplyTemplate={() => void applyGripperTemplate()}
                onRemoveTemplate={() => void removeTemplate("gripper")}
                createDraftLabel="Neuen Sauggreifer anlegen (ungeprüft)"
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
                      Maximale Grifflänge 450 mm. Paketgrenzen: längs 50–500 ×
                      50–420 mm, quer 50–500 × 50–300 mm, Höhe 50–400 mm.
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
                emptyText="Greifer wählen oder anlegen, um ihn zu bearbeiten."
              />

              <ResourceLibraryPanel
                title="Palettenstation: Bibliothek und Editor"
                libraryAriaLabel="Stationsvorlagen"
                libraryPlaceholder="Stationsvorlage wählen …"
                libraryOptions={stationLibrary}
                libraryId={libraryStationId}
                onLibraryIdChange={setLibraryStationId}
                onApplyTemplate={() => void applyStationTemplate()}
                onRemoveTemplate={() => void removeTemplate("station")}
                createDraftLabel="Neue Station anlegen (ungeprüft)"
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
                      Palettenursprung rechts / unten. TCP-Hüllraum ±2000 mm,
                      Freiraumkontur ±1500 mm. Radius 0 / 0 bleibt als
                      unkalibrierter Platzhalter erhalten, die Reichweite wird
                      nicht geprüft.
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
                emptyText="Station wählen oder anlegen, um sie zu bearbeiten."
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
                  <summary>Importierte Originaldatei</summary>
                  <div>
                    <div className="ed-actions">
                      <button
                        type="button"
                        disabled={!retainedOriginal}
                        onClick={() => downloadRetained("original")}
                        className="ui-btn ui-btn-sm"
                      >
                        Original .rob herunterladen
                      </button>
                      <button
                        type="button"
                        disabled={!retainedEdited}
                        onClick={() => downloadRetained("edited")}
                        className="ui-btn ui-btn-sm"
                      >
                        Bearbeitete .rob herunterladen
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
