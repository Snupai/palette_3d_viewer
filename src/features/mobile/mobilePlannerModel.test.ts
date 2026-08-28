import { describe, expect, it } from "vitest";
import type { ProjectFactoryDependencies } from "~/domain/project/projectFactory";
import { MULTIPACK_GRIPPER_ID } from "~/domain/project/equipmentProfiles";
import { solveLayer } from "~/domain/solver";
import {
  buildMobilePlanProject,
  createMobilePlanDraft,
  createMobilePlanSolverInput,
  createMobilePlanStackState,
  parseMobilePlanDraft,
  projectWithMobilePlanStack,
  savedProjectPatternPreview,
  stepFieldErrors,
  summarizeMobilePlan,
  summarizeSavedProject,
  MOBILE_PACKAGE_STEP_FIELDS,
  MOBILE_PALLET_STEP_FIELDS,
  type MobilePlanDraft,
} from "~/features/mobile/mobilePlannerModel";

function deterministicDeps(): ProjectFactoryDependencies {
  let sequence = 0;
  return {
    createId: (kind) => `${kind}-test-${++sequence}`,
    now: () => 1_700_000_000_000,
  };
}

function validDraft(overrides: Partial<MobilePlanDraft> = {}): MobilePlanDraft {
  return {
    ...createMobilePlanDraft(),
    packagesPerLayer: "12",
    ...overrides,
  };
}

describe("mobilePlannerModel draft", () => {
  it("starts from the desktop defaults on a EURO pallet", () => {
    expect(createMobilePlanDraft()).toEqual({
      lineNumber: "",
      productNumber: "",
      packageLengthMm: "400",
      packageWidthMm: "300",
      packageHeightMm: "200",
      packageWeightKg: "",
      palletKind: "euro",
      palletLengthMm: "1200",
      palletWidthMm: "800",
      palletHeightMm: "144",
      packagesPerLayer: "",
      layerCount: "10",
    });
  });
});

describe("parseMobilePlanDraft", () => {
  it("rejects empty required dimensions with per-field messages", () => {
    const { plan, errors } = parseMobilePlanDraft(
      validDraft({
        packageLengthMm: "",
        packageWidthMm: "abc",
        packageHeightMm: "-200",
        packagesPerLayer: "",
        layerCount: "1.5",
      }),
    );
    expect(plan).toBeNull();
    expect(errors).toEqual({
      packageLengthMm: "Package length must be a positive number.",
      packageWidthMm: "Package width must be a positive number.",
      packageHeightMm: "Package height must be a positive number.",
      packagesPerLayer: "Packages per layer must be a positive whole number.",
      layerCount: "Layers must be a positive whole number.",
    });
  });

  it("rejects a negative optional weight", () => {
    const { errors } = parseMobilePlanDraft(
      validDraft({ packageWeightKg: "-1" }),
    );
    expect(errors).toEqual({
      packageWeightKg: "Package weight must be zero or more.",
    });
  });

  it("ignores custom pallet dimensions while a template is selected", () => {
    const { plan, errors } = parseMobilePlanDraft(
      validDraft({ palletKind: "euro", palletLengthMm: "", palletWidthMm: "" }),
    );
    expect(errors).toEqual({});
    expect(plan?.palletDimensionsMm).toEqual({
      length: 1200,
      width: 800,
      height: 144,
    });
  });

  it("requires positive custom pallet dimensions", () => {
    const { plan, errors } = parseMobilePlanDraft(
      validDraft({ palletKind: "custom", palletWidthMm: "0" }),
    );
    expect(plan).toBeNull();
    expect(errors).toEqual({
      palletWidthMm: "Pallet width must be a positive number.",
    });
  });

  it("parses a valid custom-pallet draft into exact numbers", () => {
    const { plan, errors } = parseMobilePlanDraft(
      validDraft({
        lineNumber: "  AP-5006 ",
        productNumber: " 1329-00004 ",
        packageWeightKg: "8.5",
        palletKind: "custom",
        palletLengthMm: "1000",
        palletWidthMm: "600",
        palletHeightMm: "150",
        packagesPerLayer: "9",
        layerCount: "6",
      }),
    );
    expect(errors).toEqual({});
    expect(plan).toEqual({
      lineNumber: "AP-5006",
      productNumber: "1329-00004",
      packageDimensionsMm: { length: 400, width: 300, height: 200 },
      packageWeightKg: 8.5,
      palletKind: "custom",
      palletDimensionsMm: { length: 1000, width: 600, height: 150 },
      packagesPerLayer: 9,
      layerCount: 6,
    });
  });
});

describe("stepFieldErrors", () => {
  it("splits errors by step", () => {
    const errors = {
      packageLengthMm: "Package length must be a positive number.",
      packagesPerLayer: "Packages per layer must be a positive whole number.",
    };
    expect(stepFieldErrors(errors, MOBILE_PACKAGE_STEP_FIELDS)).toEqual({
      packageLengthMm: "Package length must be a positive number.",
    });
    expect(stepFieldErrors(errors, MOBILE_PALLET_STEP_FIELDS)).toEqual({
      packagesPerLayer: "Packages per layer must be a positive whole number.",
    });
  });
});

describe("buildMobilePlanProject", () => {
  it("creates a solve-ready project on the EURO template", () => {
    const { plan } = parseMobilePlanDraft(validDraft({ lineNumber: "AP-5006" }));
    const project = buildMobilePlanProject(
      plan!,
      {
        id: "project-mobile-1",
      },
      deterministicDeps(),
    );

    expect(project.id).toBe("project-mobile-1");
    expect(project.projectNumber).toBe("AP-5006");
    expect(project.productNumber).toBe("");
    expect(project.source).toEqual({ kind: "new" });
    expect(project.package.dimensionsMm).toEqual({
      length: 400,
      width: 300,
      height: 200,
    });
    expect(project.package.clearanceMm).toBe(0);
    expect(project.package.multiPickAllowed).toBe(false);
    expect(project.pallet?.id).toBe("pallet-euro");
    expect(project.pallet?.dimensionsMm).toEqual({
      length: 1200,
      width: 800,
      height: 144,
    });
    expect(project.selectedGripperId).toBe(MULTIPACK_GRIPPER_ID);
    expect(project.solutions).toHaveLength(1);
    expect(project.activeSolutionId).toBe(project.solutions[0]!.id);
    expect(project.createdAt).toBe(1_700_000_000_000);
  });

  it("stores the product number for .rob naming", () => {
    const { plan } = parseMobilePlanDraft(
      validDraft({
        lineNumber: "AP-5006",
        productNumber: "1329-00004",
      }),
    );
    const project = buildMobilePlanProject(plan!, {}, deterministicDeps());
    expect(project.projectNumber).toBe("AP-5006");
    expect(project.productNumber).toBe("1329-00004");
  });

  it("creates a custom pallet with zero overhang", () => {
    const { plan } = parseMobilePlanDraft(
      validDraft({
        palletKind: "custom",
        palletLengthMm: "1000",
        palletWidthMm: "600",
        palletHeightMm: "150",
      }),
    );
    const project = buildMobilePlanProject(plan!, {}, deterministicDeps());
    expect(project.pallet?.kind).toBe("custom");
    expect(project.pallet?.dimensionsMm).toEqual({
      length: 1000,
      width: 600,
      height: 150,
    });
    expect(project.pallet?.allowedOverhangMm).toEqual({ length: 0, width: 0 });
  });
});

describe("createMobilePlanSolverInput", () => {
  it("pins the exact package count on the full pallet envelope", () => {
    const { plan } = parseMobilePlanDraft(
      validDraft({ packagesPerLayer: "8" }),
    );
    const project = buildMobilePlanProject(plan!, {}, deterministicDeps());
    const input = createMobilePlanSolverInput(project, 8);

    expect(input.package.dimensionsMm).toEqual({ length: 400, width: 300 });
    expect(input.physicalPalletBoundsMm).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1200,
      maxY: 800,
    });
    expect(input.envelopeMm).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1200,
      maxY: 800,
    });
    expect(input.generationBoundsMm).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1200,
      maxY: 800,
    });
    expect(input.constraints).toEqual({
      minimumPackageCount: 8,
      maximumPackageCount: 8,
      maxCandidatesPerGenerator: 500,
      provisionalPackagesPerCycle: 1,
      allowMixedPackageOrientations: true,
      unrotatedPackageLabelSide: null,
      requiredShape: "any",
      rectangularBlockFootprintPolicy: "compact-centered",
      allowedRotations: [0, 90, 180, 270],
    });
  });
});

describe("projectWithMobilePlanStack", () => {
  it("persists the selected pattern as a calculated stack with all layers", () => {
    const { plan } = parseMobilePlanDraft(
      validDraft({ packagesPerLayer: "8", layerCount: "5" }),
    );
    const project = buildMobilePlanProject(plan!, {}, deterministicDeps());
    const input = createMobilePlanSolverInput(project, 8);
    const candidate = solveLayer(input, {
      includeSymmetryVariants: true,
      progressBatchSize: 25,
    }).candidates[0];
    expect(candidate).toBeDefined();

    const stackState = createMobilePlanStackState(candidate!, 5);
    expect(stackState.layers).toHaveLength(5);
    expect(stackState.compositionMode).toBe("tower");

    const persisted = projectWithMobilePlanStack(project, candidate!, input, 5);
    const solution = persisted.solutions.find(
      ({ id }) => id === persisted.activeSolutionId,
    )!;
    expect(solution.origin).toBe("calculated");
    expect(solution.patterns).toHaveLength(1);
    expect(solution.patterns[0]!.placements).toHaveLength(8);
    expect(solution.stack.layers).toHaveLength(5);
    expect(solution.robotCycles).toEqual([]);
  });
});

describe("summarizeMobilePlan", () => {
  it("reports exact totals for the success readout", () => {
    const { plan } = parseMobilePlanDraft(
      validDraft({ packagesPerLayer: "12", layerCount: "7" }),
    );
    const project = buildMobilePlanProject(plan!, {}, deterministicDeps());
    expect(summarizeMobilePlan(plan!, project)).toEqual({
      packageLabel: "400 × 300 × 200 mm",
      palletLabel: "EURO pallet · 1200 × 800 mm",
      packagesPerLayer: 12,
      layerCount: 7,
      totalPackages: 84,
    });
  });
});

function persistedProject() {
  const { plan } = parseMobilePlanDraft(
    validDraft({
      lineNumber: "AP-5006",
      productNumber: "1329-00004",
      packagesPerLayer: "8",
      layerCount: "5",
    }),
  );
  const project = buildMobilePlanProject(plan!, {}, deterministicDeps());
  const input = createMobilePlanSolverInput(project, 8);
  const candidate = solveLayer(input, {
    includeSymmetryVariants: true,
    progressBatchSize: 25,
  }).candidates[0]!;
  return projectWithMobilePlanStack(project, candidate, input, 5);
}

describe("summarizeSavedProject", () => {
  it("summarizes a persisted plan with exact totals", () => {
    expect(summarizeSavedProject(persistedProject())).toEqual({
      title: "1329-00004",
      packageLabel: "400 × 300 × 200 mm",
      palletLabel: "EURO pallet",
      packagesPerLayer: 8,
      layerCount: 5,
      totalPackages: 40,
    });
  });

  it("falls back to an untitled plan without a pattern", () => {
    const { plan } = parseMobilePlanDraft(validDraft());
    const project = buildMobilePlanProject(plan!, {}, deterministicDeps());
    expect(summarizeSavedProject(project)).toEqual({
      title: "Untitled project",
      packageLabel: "400 × 300 × 200 mm",
      palletLabel: "EURO pallet",
      packagesPerLayer: null,
      layerCount: 0,
      totalPackages: null,
    });
  });
});

describe("savedProjectPatternPreview", () => {
  it("projects the persisted pattern into the pallet bounds", () => {
    const preview = savedProjectPatternPreview(persistedProject());
    expect(preview).not.toBeNull();
    expect(preview!.palletBoundsMm).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1200,
      maxY: 800,
    });
    expect(preview!.items).toHaveLength(8);
    expect(preview!.metadata).toMatchObject({
      source: "pallet-layer",
      packageCount: 8,
      cycleCount: 8,
    });
    expect(
      preview!.items.every(
        (item) =>
          (item.sizeMm.x === 400 && item.sizeMm.y === 300) ||
          (item.sizeMm.x === 300 && item.sizeMm.y === 400),
      ),
    ).toBe(true);
  });

  it("returns null for a project without a pattern", () => {
    const { plan } = parseMobilePlanDraft(validDraft());
    const project = buildMobilePlanProject(plan!, {}, deterministicDeps());
    expect(savedProjectPatternPreview(project)).toBeNull();
  });
});
