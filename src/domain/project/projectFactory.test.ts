import { describe, expect, it } from "vitest";
import {
  MULTIPACK_GRIPPER_ID,
  MULTIPACK_PALLET_STATION_ID,
  resolveMultipackEquipmentProfile,
} from "~/domain/project/equipmentProfiles";
import {
  createProject,
  createProjectV2,
  duplicateProjectModel,
  updateProject,
} from "~/domain/project/projectFactory";
import {
  createCustomPallet,
  getPalletTemplate,
  palletLoadFootprintMm,
  validatePalletLoad,
} from "~/domain/project/palletTemplates";
import {
  PROJECT_SCHEMA_VERSION,
  palletSpecSchema,
} from "~/domain/project/projectSchema";

describe("project factories and updates", () => {
  it("uses injectable ids and timestamps for deterministic defaults", () => {
    const project = createProject(
      {
        projectNumber: "AP-1",
        productNumber: "PRODUCT-1",
        pallet: "industrial",
        package: {
          dimensionsMm: { length: 500, width: 250, height: 180 },
          weightKg: 2.5,
        },
      },
      {
        createId: (kind) => `${kind}-fixed`,
        now: () => 100,
      },
    );

    expect(project).toMatchObject({
      id: "project-fixed",
      projectNumber: "AP-1",
      productNumber: "PRODUCT-1",
      createdAt: 100,
      updatedAt: 100,
      activeSolutionId: "solution-fixed",
    });
    expect(project.package.dimensionsMm).toEqual({
      length: 500,
      width: 250,
      height: 180,
    });
    expect(project.pallet?.kind).toBe("industrial");
    expect(project.solutions[0]).toMatchObject({
      id: "solution-fixed",
      patterns: [],
      robotCycles: [],
    });
  });

  it("preselects independent observed Multipack resources for ordinary new projects", () => {
    const first = createProject(
      { id: "first" },
      { createId: (kind) => `${kind}-first`, now: () => 1 },
    );
    const second = createProject(
      { id: "second" },
      { createId: (kind) => `${kind}-second`, now: () => 2 },
    );

    expect(first.selectedGripperId).toBe(MULTIPACK_GRIPPER_ID);
    expect(first.selectedPalletStationId).toBe(MULTIPACK_PALLET_STATION_ID);
    expect(first.grippers).toHaveLength(1);
    expect(first.palletStations).toHaveLength(1);
    expect(resolveMultipackEquipmentProfile(first)?.version).toBe(1);

    first.grippers[0]!.tcpMm.x = 99;
    expect(second.grippers[0]!.tcpMm.x).toBe(0);
    expect(resolveMultipackEquipmentProfile(first)).toBeNull();
    expect(resolveMultipackEquipmentProfile(second)?.version).toBe(1);
  });

  it("preserves explicit empty equipment and keeps ROB imports profile-free", () => {
    const explicitEmpty = createProject(
      {
        id: "empty",
        grippers: [],
        palletStations: [],
        selectedGripperId: null,
        selectedPalletStationId: null,
      },
      { createId: (kind) => `${kind}-empty`, now: () => 1 },
    );
    const imported = createProject(
      {
        id: "imported",
        source: { kind: "rob-import", fileName: "fixture.rob" },
      },
      { createId: (kind) => `${kind}-imported`, now: () => 1 },
    );

    expect(explicitEmpty.grippers).toEqual([]);
    expect(explicitEmpty.palletStations).toEqual([]);
    expect(explicitEmpty.selectedGripperId).toBeNull();
    expect(explicitEmpty.selectedPalletStationId).toBeNull();
    expect(imported.grippers).toEqual([]);
    expect(imported.palletStations).toEqual([]);
    expect(imported.selectedGripperId).toBeNull();
    expect(imported.selectedPalletStationId).toBeNull();
  });

  it("updates and duplicates without changing protected identity fields", () => {
    const original = createProject(
      { id: "source", projectNumber: "P-1" },
      { createId: (kind) => `${kind}-1`, now: () => 10 },
    );
    const updated = updateProject(
      original,
      { projectNumber: "P-2" },
      { now: () => 20 },
    );
    const duplicate = duplicateProjectModel(
      updated,
      { projectNumber: "P-2 copy" },
      { createId: () => "copy", now: () => 30 },
    );

    expect(updated).toMatchObject({
      id: "source",
      createdAt: 10,
      updatedAt: 20,
      projectNumber: "P-2",
    });
    expect(duplicate).toMatchObject({
      id: "copy",
      createdAt: 30,
      updatedAt: 30,
      projectNumber: "P-2 copy",
    });
    expect(original.projectNumber).toBe("P-1");
  });

  it("can still create the exact V2 compatibility contract", () => {
    const project = createProjectV2(
      { id: "v2" },
      { createId: (kind) => `${kind}-v2`, now: () => 1 },
    );

    expect(project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(project.grippers).toEqual([]);
    expect(project.palletStations).toEqual([]);
    expect(project.solutions[0]).not.toHaveProperty("robotCycles");
  });
});

describe("pallet templates and load validation", () => {
  it("provides independent EURO and industrial template copies", () => {
    const euro = getPalletTemplate("euro");
    const industrial = getPalletTemplate("industrial");

    expect(euro.dimensionsMm).toEqual({
      length: 1200,
      width: 800,
      height: 144,
    });
    expect(industrial.dimensionsMm).toEqual({
      length: 1200,
      width: 1000,
      height: 144,
    });
    euro.dimensionsMm.length = 1;
    expect(getPalletTemplate("euro").dimensionsMm.length).toBe(1200);
  });

  it("supports valid custom underhang and computes the usable footprint", () => {
    const pallet = createCustomPallet(
      {
        id: "underhang",
        dimensionsMm: { length: 1200, width: 800, height: 144 },
        allowedOverhangMm: { length: -50, width: -50 },
        storageEnvelopeMm: { length: 1100, width: 700, height: 2000 },
      },
      () => "unused",
    );

    expect(palletLoadFootprintMm(pallet)).toEqual({
      length: 1100,
      width: 700,
    });
  });

  it("rejects impossible underhang, undersized envelopes, and gross limits below tare", () => {
    const base = {
      id: "invalid",
      name: "Invalid pallet",
      kind: "custom" as const,
      dimensionsMm: { length: 1200, width: 800, height: 144 },
      storageEnvelopeMm: { length: 1200, width: 800, height: 100 },
      allowedOverhangMm: { length: 50, width: -400 },
      tareKg: 50,
      maxGrossKg: 40,
      subPalletPattern: "none" as const,
    };

    const result = palletSpecSchema.safeParse(base);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map(({ message }) => message)).toEqual(
      expect.arrayContaining([
        "must be greater than or equal to tareKg",
        "underhang leaves no usable load width",
        "must contain the allowed load length",
        "must be at least the pallet height",
      ]),
    );
  });

  it("reports loaded gross-weight and storage-height violations", () => {
    const result = validatePalletLoad(getPalletTemplate("euro"), {
      packageCount: 15,
      packageWeightKg: 100,
      loadHeightMm: null,
    });
    const withEnvelope = createCustomPallet({
      id: "envelope",
      dimensionsMm: { length: 1200, width: 800, height: 144 },
      storageEnvelopeMm: { length: 1200, width: 800, height: 1500 },
    });
    const heightResult = validatePalletLoad(withEnvelope, {
      packageCount: 0,
      packageWeightKg: null,
      loadHeightMm: 1501,
    });

    expect(result.grossWeightKg).toBe(1525);
    expect(result.diagnostics[0]?.code).toBe("gross-weight-exceeded");
    expect(heightResult.diagnostics[0]?.code).toBe("storage-height-exceeded");
  });
});
