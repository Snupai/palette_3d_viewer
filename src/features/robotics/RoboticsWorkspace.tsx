"use client";

import { useEffect, useMemo, useState } from "react";
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
  type RobotDiagnostic,
  type RobotObstacle,
} from "~/domain/robotics";
import {
  GripperEditor,
  StationEditor,
} from "~/features/robotics/ResourceEditors";
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
  type RobotExportWorkspaceSettings,
  type RobotReadinessStatus,
  type RobotWorkspaceSettings,
} from "~/features/robotics/robotWorkspaceModel";
import type { ProjectRepository } from "~/lib/projectRepository";

const inputClass =
  "rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20 disabled:cursor-not-allowed disabled:text-zinc-600";
const buttonClass =
  "rounded-md border border-zinc-700 px-2.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-amber-400/30 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent";
const primaryButtonClass =
  "rounded-md bg-amber-400 px-3 py-2 text-xs font-semibold text-zinc-950 hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500";
const sectionClass = "border border-zinc-800 bg-zinc-900";
const disclosureSummaryClass =
  "cursor-pointer px-3 py-2 text-sm font-semibold text-zinc-100 marker:text-zinc-500 hover:bg-zinc-800/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-amber-400/30";

export type RoboticsWorkspaceProps = {
  project: Project;
  repository: ProjectRepository;
  materialization: RobotCycleMaterialization;
  settings: RobotWorkspaceSettings;
  onSettingsChange: (settings: RobotWorkspaceSettings) => void;
  onSaveProject: (project: Project) => Promise<Project>;
  onPreviewMotion?: () => void;
};

type ResourceDiagnosticCategory =
  | "package"
  | "gripper"
  | "station"
  | "reach"
  | "envelope"
  | "collision"
  | "export";

const categoryLabels: Record<ResourceDiagnosticCategory, string> = {
  package: "Plan and groups",
  gripper: "Gripper",
  station: "Pallet station",
  reach: "Robot reach",
  envelope: "Entered envelopes",
  collision: "Fixed obstacles",
  export: "Internal export",
};

const readinessLabels: Record<RobotReadinessStatus, string> = {
  complete: "Ready",
  "needs-input": "Needs input",
  engineering: "Engineering",
  "not-checked": "Not checked",
  warning: "Check",
  blocked: "Blocked",
};

const readinessClasses: Record<RobotReadinessStatus, string> = {
  complete: "border-emerald-500/35 bg-emerald-500/10 text-emerald-200",
  "needs-input": "border-amber-500/35 bg-amber-500/10 text-amber-200",
  engineering: "border-sky-500/35 bg-sky-500/10 text-sky-200",
  "not-checked": "border-zinc-700 bg-zinc-800 text-zinc-400",
  warning: "border-amber-500/35 bg-amber-500/10 text-amber-200",
  blocked: "border-red-500/35 bg-red-500/10 text-red-200",
};

function diagnosticCategory(
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

function diagnosticKey(diagnostic: RobotDiagnostic): string {
  return [
    diagnostic.severity,
    diagnostic.phase,
    diagnostic.code,
    diagnostic.cycleId ?? "",
    diagnostic.resourceId ?? "",
    diagnostic.message,
  ].join("|");
}

function uniqueDiagnostics(
  diagnostics: readonly RobotDiagnostic[],
): RobotDiagnostic[] {
  return [
    ...new Map(diagnostics.map((item) => [diagnosticKey(item), item])).values(),
  ];
}

function downloadText(filename: string, text: string, type: string): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

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

function NumericDraftField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-[11px] text-zinc-500">
      {label}
      <input
        type="number"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </label>
  );
}

function ObstacleEditor({
  obstacles,
  onChange,
}: {
  obstacles: readonly RobotObstacle[];
  onChange: (obstacles: readonly RobotObstacle[]) => void;
}) {
  const update = (index: number, obstacle: RobotObstacle) =>
    onChange(
      obstacles.map((current, itemIndex) =>
        itemIndex === index ? obstacle : current,
      ),
    );

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs leading-5 text-zinc-500">
          Add measured fixed objects in the station coordinate system. Without
          them, collision against individual station objects is not checked.
        </p>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...obstacles,
              {
                id: `obstacle-${obstacles.length + 1}`,
                name: `Obstacle ${obstacles.length + 1}`,
                boundsMm: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
                minZMm: 0,
                maxZMm: 1_000,
              },
            ])
          }
          className={`${buttonClass} shrink-0`}
        >
          Add obstacle
        </button>
      </div>
      {obstacles.length === 0 ? (
        <p className="border border-dashed border-zinc-800 px-3 py-2 text-xs leading-5 text-zinc-500">
          No fixed obstacles are modeled. Collision against individual station
          objects has not been checked.
        </p>
      ) : (
        obstacles.map((obstacle, index) => (
          <div
            key={`${obstacle.id}-${index}`}
            className="grid gap-2 border border-zinc-800 p-2"
          >
            <div className="flex items-center gap-2">
              <input
                aria-label={`Obstacle ${index + 1} name`}
                value={obstacle.name ?? ""}
                onChange={(event) =>
                  update(index, { ...obstacle, name: event.target.value })
                }
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() =>
                  onChange(
                    obstacles.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                className={`${buttonClass} text-red-300`}
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ["Min X", "minX"],
                  ["Min Y", "minY"],
                  ["Max X", "maxX"],
                  ["Max Y", "maxY"],
                ] as const
              ).map(([label, field]) => (
                <label
                  key={field}
                  className="grid gap-1 text-[11px] text-zinc-500"
                >
                  {label}
                  <input
                    type="number"
                    step="any"
                    value={obstacle.boundsMm[field]}
                    onChange={(event) =>
                      update(index, {
                        ...obstacle,
                        boundsMm: {
                          ...obstacle.boundsMm,
                          [field]: Number(event.target.value),
                        },
                      })
                    }
                    className={inputClass}
                  />
                </label>
              ))}
              {(
                [
                  ["Min Z", "minZMm"],
                  ["Max Z", "maxZMm"],
                ] as const
              ).map(([label, field]) => (
                <label
                  key={field}
                  className="grid gap-1 text-[11px] text-zinc-500"
                >
                  {label}
                  <input
                    type="number"
                    step="any"
                    value={obstacle[field] ?? ""}
                    onChange={(event) =>
                      update(index, {
                        ...obstacle,
                        [field]:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                    className={inputClass}
                  />
                </label>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function GeneratedPickupTable({
  materialization,
}: {
  materialization: RobotCycleMaterialization;
}) {
  return (
    <div className="scrollbar-thin overflow-auto border-t border-zinc-800">
      <table className="w-full min-w-[1120px] border-collapse text-left text-xs">
        <thead className="bg-zinc-950 text-zinc-500">
          <tr>
            {[
              "#",
              "Layer",
              "Group",
              "Packages",
              "Pick X",
              "Pick Y",
              "Pick Z",
              "Pick yaw",
              "Transfer X/Y/Z",
              "Place X",
              "Place Y",
              "Place Z",
              "Place yaw",
              "Frame",
              "Source",
            ].map((label) => (
              <th
                key={label}
                className="border-b border-zinc-800 px-2 py-2 font-medium"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {materialization.cycles.map((cycle) => (
            <tr
              key={cycle.id}
              className="border-b border-zinc-800/80 text-zinc-300"
            >
              <td className="px-2 py-2 font-mono">{cycle.sequence + 1}</td>
              <td className="px-2 py-2 font-mono">
                {cycle.physicalLayerIndex + 1}
              </td>
              <td
                className="max-w-[180px] truncate px-2 py-2 font-mono"
                title={cycle.groupId}
              >
                G{cycle.groupNumber}
              </td>
              <td className="px-2 py-2 font-mono">{cycle.packageCount}</td>
              <td className="px-2 py-2 font-mono">
                {cycle.pickPose.positionMm.x}
              </td>
              <td className="px-2 py-2 font-mono">
                {cycle.pickPose.positionMm.y}
              </td>
              <td className="px-2 py-2 font-mono">
                {cycle.pickPose.positionMm.z}
              </td>
              <td className="px-2 py-2 font-mono">{cycle.pickPose.yawDeg}°</td>
              <td className="px-2 py-2 font-mono">
                {cycle.transferPose.positionMm.x} /{" "}
                {cycle.transferPose.positionMm.y} /{" "}
                {cycle.transferPose.positionMm.z}
              </td>
              <td className="px-2 py-2 font-mono">
                {cycle.placePose.positionMm.x}
              </td>
              <td className="px-2 py-2 font-mono">
                {cycle.placePose.positionMm.y}
              </td>
              <td className="px-2 py-2 font-mono">
                {cycle.placePose.positionMm.z}
              </td>
              <td className="px-2 py-2 font-mono">{cycle.placePose.yawDeg}°</td>
              <td className="px-2 py-2 font-mono">{cycle.placePose.frame}</td>
              <td className="px-2 py-2">{cycle.provenance.cycleSource}</td>
            </tr>
          ))}
          {materialization.cycles.length === 0 ? (
            <tr>
              <td colSpan={15} className="px-3 py-6 text-center text-zinc-600">
                No calculated pickups are available.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
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
    downloadText(
      `${safeFilename(project.projectNumber || project.productNumber, "project")}.generated.rob`,
      result.text,
      "text/plain;charset=utf-8",
    );
    setStatus(
      "Project-derived .rob exported after parser roundtrip verification.",
    );
  };

  const downloadRetained = (variant: "original" | "edited") => {
    const retained = getRetainedRawRobDownload(project, variant);
    if (!retained) return;
    downloadText(
      `${safeFilename(retained.fileName, "import.rob")}.${variant}.rob`,
      retained.text,
      "text/plain;charset=utf-8",
    );
  };

  const retainedOriginal = getRetainedRawRobDownload(project, "original");
  const retainedEdited = getRetainedRawRobDownload(project, "edited");

  return (
    <div className="grid gap-3" data-testid="robotics-workspace">
      {error ? (
        <div
          role="alert"
          className="border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm whitespace-pre-line text-red-200"
        >
          {error}
        </div>
      ) : null}
      {status ? (
        <div
          role="status"
          className="border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-300"
        >
          {status}
        </div>
      ) : null}

      <section className="border border-amber-400/30 bg-zinc-900">
        <header className="border-b border-amber-400/20 px-3 py-3">
          <p className="font-mono text-[10px] tracking-[0.18em] text-amber-300 uppercase">
            Operator view
          </p>
          <h2 className="mt-1 text-base font-semibold text-zinc-100">
            Robot setup
          </h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-zinc-400">
            Choose the equipment, enter the pickup point, and review readiness.
            Detailed equipment and export settings stay closed until needed.
          </p>
        </header>
        <div className="grid gap-px bg-zinc-800 sm:grid-cols-3">
          <div className="bg-zinc-900 p-3">
            <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
              Package
            </p>
            <p className="mt-1 font-mono text-sm text-zinc-200">
              {project.package.dimensionsMm.length} ×{" "}
              {project.package.dimensionsMm.width} ×{" "}
              {project.package.dimensionsMm.height} mm
            </p>
          </div>
          <div className="bg-zinc-900 p-3">
            <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
              Pallet plan
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {activeSolution
                ? `${activeSolution.stack.layers.length} layer${activeSolution.stack.layers.length === 1 ? "" : "s"} · ${plannedPackageCount} package${plannedPackageCount === 1 ? "" : "s"}`
                : "No active plan"}
            </p>
          </div>
          <div className="bg-zinc-900 p-3">
            <p className="text-[10px] tracking-wide text-zinc-500 uppercase">
              Calculated output
            </p>
            <p className="mt-1 text-sm text-zinc-200">
              {materialization.cycles.length} pickup
              {materialization.cycles.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <header className="border-b border-zinc-800 px-3 py-2">
          <h2 className="text-sm font-semibold text-zinc-100">
            1. Select equipment
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-zinc-500">
            {selectedProfile
              ? `Multipack Roboter observed defaults v${selectedProfile.version} are preselected for this project.`
              : project.source.kind === "rob-import"
                ? "Imported .rob files do not select or infer equipment."
                : "Select equipment that has been checked against the real cell."}
          </p>
        </header>
        <div className="grid gap-3 p-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-zinc-400">
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
          <label className="grid gap-1 text-xs text-zinc-400">
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
            <p className="border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-100 md:col-span-2">
              Observed in Multipack für Roboter{" "}
              {selectedProfile.provenance.applicationVersion} and corroborated
              against the active local plan database. This is documented
              configuration evidence, not a station survey or production
              calibration. Radial reach remains uncalibrated.
            </p>
          ) : null}
        </div>
      </section>

      <section className={sectionClass}>
        <header className="border-b border-zinc-800 px-3 py-2">
          <h2 className="text-sm font-semibold text-zinc-100">
            2. Enter pickup point
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-zinc-500">
            Enter the package pickup pose in the selected station coordinate
            system. Blank or invalid values keep output blocked.
          </p>
        </header>
        <div className="grid gap-3 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
            {(
              [
                ["X (mm)", "pickX"],
                ["Y (mm)", "pickY"],
                ["Z (mm)", "pickZ"],
                ["Yaw (deg)", "pickYaw"],
                ["Packages per pickup", "maxPackagesPerPick"],
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
          <p className="text-[11px] leading-5 text-zinc-500">
            Planning values start at{" "}
            {project.package.multiPickAllowed ? "2" : "1"} package
            {project.package.multiPickAllowed ? "s" : ""} per calculated pickup
            and 200 mm travel clearance. These are editable internal planning
            values, not imported equipment or production defaults.
          </p>
        </div>
      </section>

      <section className={sectionClass}>
        <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-3 py-2">
          <div className="mr-auto">
            <h2 className="text-sm font-semibold text-zinc-100">
              3. Review readiness
            </h2>
            <p className="mt-0.5 text-xs leading-5 text-zinc-500">
              Each row states what this workspace actually checked.
            </p>
          </div>
          <span
            className={
              materialization.valid
                ? "text-xs text-emerald-300"
                : "text-xs text-red-300"
            }
          >
            {materialization.valid
              ? "Cycle data checks passed"
              : "Cycle data has blocking issues"}
          </span>
        </header>
        <ul className="grid gap-px bg-zinc-800 md:grid-cols-2">
          {readiness.map((item) => (
            <li key={item.id} className="flex gap-3 bg-zinc-900 p-3">
              <span
                className={`h-fit min-w-[82px] border px-2 py-1 text-center text-[10px] font-semibold tracking-wide uppercase ${readinessClasses[item.status]}`}
              >
                {readinessLabels[item.status]}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-zinc-200">
                  {item.label}
                </p>
                <p className="mt-1 text-xs leading-5 text-zinc-500">
                  {item.evidence}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-100">
          <strong>Production feasibility is not assessed.</strong> Confirm the
          real gripper, station frame, robot program mapping, guarding, and full
          collision model before production use.
        </div>
      </section>

      <section className={sectionClass}>
        <header className="border-b border-zinc-800 px-3 py-2">
          <h2 className="text-sm font-semibold text-zinc-100">Output</h2>
          <p className="mt-0.5 text-xs leading-5 text-zinc-500">
            Preview the calculated motion or export only after the internal
            preflight is ready.
          </p>
        </header>
        <div className="flex flex-wrap items-center gap-3 p-3">
          <button
            type="button"
            disabled={!onPreviewMotion || materialization.cycles.length === 0}
            onClick={onPreviewMotion}
            className={buttonClass}
          >
            Preview calculated motion
          </button>
          <button
            type="button"
            disabled={!exportGate.enabled}
            onClick={exportGenerated}
            className={primaryButtonClass}
          >
            Export project-derived .rob
          </button>
          <span
            className={
              exportGate.enabled
                ? "text-xs text-emerald-300"
                : "text-xs text-zinc-500"
            }
          >
            {exportGate.enabled
              ? "Internal export preflight passed."
              : `${exportBlockingIssues} blocking issue${exportBlockingIssues === 1 ? "" : "s"}; review Advanced engineering.`}
          </span>
        </div>
      </section>

      <details className={sectionClass} data-testid="generated-pickup-list">
        <summary className={disclosureSummaryClass}>
          Generated pickup list ({materialization.cycles.length})
        </summary>
        <p className="border-t border-zinc-800 px-3 py-2 text-xs leading-5 text-zinc-500">
          These canonical coordinates are shared with motion preview, reports,
          and project-derived export.
        </p>
        <GeneratedPickupTable materialization={materialization} />
      </details>

      <details className={sectionClass} data-testid="robotics-advanced">
        <summary className={disclosureSummaryClass}>
          Advanced engineering
        </summary>
        <div className="grid gap-3 border-t border-zinc-800 p-3">
          <p className="border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs leading-5 text-amber-100">
            Equipment drafts and entered mappings are unverified engineering
            data. Check them against the real cell before use.
          </p>

          <details className={sectionClass}>
            <summary className={disclosureSummaryClass}>
              Motion values and pickup evidence
            </summary>
            <div className="grid gap-3 border-t border-zinc-800 p-3">
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
                <label className="grid gap-1 text-[11px] text-zinc-500">
                  Pickup point state
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
                    className={inputClass}
                  >
                    <option value="unverified">Not checked</option>
                    <option value="verified">
                      Checked against stated source
                    </option>
                  </select>
                </label>
              </div>
              <label className="grid gap-1 text-[11px] text-zinc-500">
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
            <div className="border-t border-zinc-800 p-3">
              <ObstacleEditor
                obstacles={settings.obstacles}
                onChange={(obstacles) =>
                  onSettingsChange({ ...settings, obstacles })
                }
              />
            </div>
          </details>

          <details className={sectionClass}>
            <summary className={disclosureSummaryClass}>
              Gripper library and editor
            </summary>
            <div className="grid gap-3 border-t border-zinc-800 p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <select
                  aria-label="Gripper template library"
                  value={libraryGripperId}
                  onChange={(event) => setLibraryGripperId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Choose reusable gripper template…</option>
                  {gripperLibrary.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!libraryGripperId}
                  onClick={() => void applyGripperTemplate()}
                  className={buttonClass}
                >
                  Apply
                </button>
                <button
                  type="button"
                  disabled={!libraryGripperId}
                  onClick={() => void removeTemplate("gripper")}
                  className={`${buttonClass} text-red-300`}
                >
                  Remove
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setGripperDraft(createSuctionGripperDraft(project))
                  }
                  className={buttonClass}
                >
                  Create unverified suction draft
                </button>
                {gripperDraftIsBuiltIn && gripperDraft ? (
                  <button
                    type="button"
                    onClick={() =>
                      setGripperDraft(createEditableGripperCopy(gripperDraft))
                    }
                    className={buttonClass}
                  >
                    Create editable copy
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!gripperDraft || gripperDraftIsBuiltIn}
                  onClick={() => void saveGripper()}
                  className={buttonClass}
                >
                  Save to project
                </button>
                <button
                  type="button"
                  disabled={!gripperDraft || gripperDraftIsBuiltIn}
                  onClick={() => void saveGripperTemplate()}
                  className={buttonClass}
                >
                  Save reusable template
                </button>
              </div>
              {gripperDraftIsBuiltIn ? (
                <div className="grid gap-2 border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-zinc-400">
                  <p className="text-amber-100">
                    Built-in Multipack profile v{multipackProfile.version} is
                    read-only. Create an editable copy before changing or saving
                    it as a reusable template.
                  </p>
                  <p>
                    Maximum pickup length: 450 mm. Package limits: lengthwise
                    50–500 × 50–420 mm; crosswise 50–500 × 50–300 mm; height
                    50–400 mm.
                  </p>
                </div>
              ) : gripperDraft ? (
                <GripperEditor
                  value={gripperDraft}
                  onChange={setGripperDraft}
                />
              ) : (
                <p className="text-xs text-zinc-600">
                  Select or create a gripper to edit it.
                </p>
              )}
            </div>
          </details>

          <details className={sectionClass}>
            <summary className={disclosureSummaryClass}>
              Pallet station library and editor
            </summary>
            <div className="grid gap-3 border-t border-zinc-800 p-3">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                <select
                  aria-label="Station template library"
                  value={libraryStationId}
                  onChange={(event) => setLibraryStationId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Choose reusable station template…</option>
                  {stationLibrary.map((resource) => (
                    <option key={resource.id} value={resource.id}>
                      {resource.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!libraryStationId}
                  onClick={() => void applyStationTemplate()}
                  className={buttonClass}
                >
                  Apply
                </button>
                <button
                  type="button"
                  disabled={!libraryStationId}
                  onClick={() => void removeTemplate("station")}
                  className={`${buttonClass} text-red-300`}
                >
                  Remove
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setStationDraft(createPalletStationDraft(project))
                  }
                  className={buttonClass}
                >
                  Create unverified station draft
                </button>
                {stationDraftIsBuiltIn && stationDraft ? (
                  <button
                    type="button"
                    onClick={() =>
                      setStationDraft(createEditableStationCopy(stationDraft))
                    }
                    className={buttonClass}
                  >
                    Create editable copy
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={!stationDraft || stationDraftIsBuiltIn}
                  onClick={() => void saveStation()}
                  className={buttonClass}
                >
                  Save to project
                </button>
                <button
                  type="button"
                  disabled={!stationDraft || stationDraftIsBuiltIn}
                  onClick={() => void saveStationTemplate()}
                  className={buttonClass}
                >
                  Save reusable template
                </button>
              </div>
              {stationDraftIsBuiltIn ? (
                <div className="grid gap-2 border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-5 text-zinc-400">
                  <p className="text-amber-100">
                    Built-in Multipack profile v{multipackProfile.version} is
                    read-only. Create an editable copy before changing or saving
                    it as a reusable template.
                  </p>
                  <p>
                    Pallet origin: right / bottom. TCP envelope: ±2000 mm.
                    Free-space contour: ±1500 mm. Robot radius 0 / 0 is retained
                    as an uncalibrated legacy sentinel, so radial reach is not
                    checked.
                  </p>
                </div>
              ) : stationDraft ? (
                <StationEditor
                  value={stationDraft}
                  onChange={setStationDraft}
                />
              ) : (
                <p className="text-xs text-zinc-600">
                  Select or create a pallet station to edit it.
                </p>
              )}
            </div>
          </details>

          <details className={sectionClass} data-testid="robotics-diagnostics">
            <summary className={disclosureSummaryClass}>
              Detailed diagnostics ({diagnostics.length})
            </summary>
            <div className="grid gap-px border-t border-zinc-800 bg-zinc-800 md:grid-cols-2 xl:grid-cols-3">
              {(
                Object.keys(categoryLabels) as ResourceDiagnosticCategory[]
              ).map((category) => {
                const items = diagnostics.filter(
                  (diagnostic) => diagnosticCategory(diagnostic) === category,
                );
                return (
                  <div key={category} className="bg-zinc-900 p-3">
                    <h3 className="text-xs font-semibold text-zinc-200">
                      {categoryLabels[category]}
                    </h3>
                    {items.length === 0 ? (
                      <p className="mt-2 text-xs leading-5 text-zinc-600">
                        {category === "collision" &&
                        settings.obstacles.length === 0
                          ? "No fixed obstacles are modeled; no collision claim is made."
                          : "No diagnostics in this category."}
                      </p>
                    ) : (
                      <ul className="mt-2 grid gap-2">
                        {items.map((diagnostic) => (
                          <li
                            key={diagnosticKey(diagnostic)}
                            className={
                              diagnostic.severity === "error"
                                ? "text-xs leading-5 text-red-200"
                                : diagnostic.severity === "warning"
                                  ? "text-xs leading-5 text-amber-200"
                                  : "text-xs leading-5 text-zinc-300"
                            }
                          >
                            <span className="font-mono text-[10px] text-zinc-500">
                              {diagnostic.code}
                            </span>
                            <br />
                            {diagnostic.message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </details>

          <details
            className={sectionClass}
            data-testid="robotics-export-settings"
          >
            <summary className={disclosureSummaryClass}>
              Internal .rob export mapping
            </summary>
            <div className="grid gap-3 border-t border-zinc-800 p-3">
              <p className="text-xs leading-5 text-zinc-500">
                These fields describe an internal project export. They do not
                establish compatibility with an external Multipack controller.
              </p>
              <div className="grid gap-3 lg:grid-cols-3">
                <label className="grid gap-1 text-xs text-zinc-400">
                  Integer quantization
                  <select
                    aria-label="ROB integer quantization"
                    value={exportSettings.quantization}
                    onChange={(event) =>
                      setExportSettings({
                        ...exportSettings,
                        quantization: event.target
                          .value as RobotExportWorkspaceSettings["quantization"],
                      })
                    }
                    className={inputClass}
                  >
                    <option value="reject-decimals">Reject decimals</option>
                    <option value="round-half-away-from-zero">
                      Round half away from zero
                    </option>
                    <option value="truncate-toward-zero">
                      Truncate toward zero
                    </option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-zinc-400">
                  Final two .rob fields
                  <select
                    aria-label="ROB unknown field policy"
                    value={exportSettings.unknownFieldMode}
                    onChange={(event) =>
                      setExportSettings({
                        ...exportSettings,
                        unknownFieldMode: event.target
                          .value as RobotExportWorkspaceSettings["unknownFieldMode"],
                      })
                    }
                    className={inputClass}
                  >
                    <option value="block">Block: meaning unknown</option>
                    <option value="preserve-imported">
                      Preserve retained imported values
                    </option>
                    <option value="explicit-values">
                      Enter internal values
                    </option>
                  </select>
                </label>
                <label className="flex items-end gap-2 pb-1 text-xs text-zinc-300">
                  <input
                    type="checkbox"
                    checked={exportSettings.allowCountOnlyInterlayers}
                    onChange={(event) =>
                      setExportSettings({
                        ...exportSettings,
                        allowCountOnlyInterlayers: event.target.checked,
                      })
                    }
                    className="accent-amber-400"
                  />
                  Accept count-only loss for non-3 mm sheets
                </label>
              </div>
              <div className="grid gap-3 border-t border-zinc-800 pt-3 lg:grid-cols-6">
                <label className="grid gap-1 text-[11px] text-zinc-500 lg:col-span-2">
                  Internal mapping ID
                  <input
                    value={exportSettings.mappingId}
                    onChange={(event) =>
                      setExportSettings({
                        ...exportSettings,
                        mappingId: event.target.value,
                      })
                    }
                    className={inputClass}
                  />
                </label>
                {(["xSign", "ySign", "yawSign"] as const).map((field) => (
                  <label
                    key={field}
                    className="grid gap-1 text-[11px] text-zinc-500"
                  >
                    {field}
                    <select
                      value={exportSettings[field]}
                      onChange={(event) =>
                        setExportSettings({
                          ...exportSettings,
                          [field]: Number(event.target.value) as 1 | -1,
                        })
                      }
                      className={inputClass}
                    >
                      <option value={1}>+1</option>
                      <option value={-1}>-1</option>
                    </select>
                  </label>
                ))}
                <NumericDraftField
                  label="Yaw offset (deg)"
                  value={exportSettings.yawOffsetDeg}
                  onChange={(value) =>
                    setExportSettings({
                      ...exportSettings,
                      yawOffsetDeg: value,
                    })
                  }
                />
                <label className="flex items-end gap-2 pb-1 text-xs leading-5 text-zinc-300 lg:col-span-6">
                  <input
                    aria-label="Acknowledge unverified ROB mapping"
                    type="checkbox"
                    checked={exportSettings.mappingAcknowledged}
                    onChange={(event) =>
                      setExportSettings({
                        ...exportSettings,
                        mappingAcknowledged: event.target.checked,
                      })
                    }
                    className="accent-amber-400"
                  />
                  I acknowledge this is a user-entered internal mapping and does
                  not establish external Multipack compatibility.
                </label>
              </div>
              {exportSettings.unknownFieldMode === "explicit-values" ? (
                <div className="grid gap-2 border-t border-zinc-800 pt-3 md:grid-cols-2 lg:grid-cols-4">
                  <NumericDraftField
                    label="Field 8"
                    value={exportSettings.field8}
                    onChange={(value) =>
                      setExportSettings({ ...exportSettings, field8: value })
                    }
                  />
                  <NumericDraftField
                    label="Field 9"
                    value={exportSettings.field9}
                    onChange={(value) =>
                      setExportSettings({ ...exportSettings, field9: value })
                    }
                  />
                  <label className="grid gap-1 text-[11px] text-zinc-500 lg:col-span-2">
                    Meaning of fields 8 and 9
                    <input
                      value={exportSettings.unknownFieldSemantics}
                      onChange={(event) =>
                        setExportSettings({
                          ...exportSettings,
                          unknownFieldSemantics: event.target.value,
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                  <label className="grid gap-1 text-[11px] text-zinc-500 md:col-span-2 lg:col-span-4">
                    Source of these values
                    <input
                      value={exportSettings.unknownFieldProvenance}
                      onChange={(event) =>
                        setExportSettings({
                          ...exportSettings,
                          unknownFieldProvenance: event.target.value,
                        })
                      }
                      className={inputClass}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </details>

      {retainedOriginal || retainedEdited ? (
        <details className="border border-amber-500/35 bg-zinc-900">
          <summary className={disclosureSummaryClass}>
            Imported source-file downloads
          </summary>
          <div className="grid gap-3 border-t border-amber-500/25 p-3">
            <p className="text-xs leading-5 text-amber-200/75">
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
