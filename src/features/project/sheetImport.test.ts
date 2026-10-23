import { expect, it } from "vitest";
import {
  rawPalletSheetSchema,
  validatePalletSheet,
} from "~/domain/sheetExtraction";
import {
  buildProjectFromForm,
  projectToFormValues,
} from "~/features/project/projectForm";
import { applySheetToFormValues } from "~/features/project/sheetImport";
import { createLayerSolverInputFromProject } from "~/domain/solver/projectInput";

function sheetFor(overrides: Record<string, unknown>) {
  return validatePalletSheet(
    rawPalletSheetSchema.parse({
      productNumber: "483-00815",
      cartonMm: { length: 148, width: 148, height: 122 },
      blockMm: { length: 1184, width: 740, height: 1586 },
      palletMm: { length: 1200, width: 800 },
      cartonsPerLayer: 40,
      layers: 13,
      cartonsPerPallet: 520,
      ...overrides,
    }),
  ).sheet;
}

it("turns the sheet block into the solver load area", () => {
  const { values, exactPackageCount } = applySheetToFormValues(
    projectToFormValues(null),
    sheetFor({}),
  );
  expect(exactPackageCount).toBe("40");
  const project = buildProjectFromForm(values, null, {
    now: () => 0,
    createId: (kind) => `${kind}-1`,
  });
  expect(project.productNumber).toBe("483-00815");
  expect(project.package.dimensionsMm).toEqual({
    length: 148,
    width: 148,
    height: 122,
  });
  expect(project.pallet?.allowedOverhangMm).toEqual({ length: -8, width: -30 });
  expect(project.pallet?.storageEnvelopeMm).toEqual({
    length: 1200,
    width: 800,
    height: 1586,
  });
  expect(createLayerSolverInputFromProject(project).envelopeMm).toEqual({
    minX: 8,
    minY: 30,
    maxX: 1192,
    maxY: 770,
  });
});

it("keeps half-millimetre underhang for odd block sides", () => {
  const { values } = applySheetToFormValues(
    projectToFormValues(null),
    sheetFor({
      cartonMm: { length: 135, width: 91, height: 196 },
      blockMm: { length: 1183, width: 766, height: 784 },
      cartonsPerLayer: 73,
      layers: 4,
      cartonsPerPallet: 292,
    }),
  );
  expect([values.overhangLengthMm, values.overhangWidthMm]).toEqual([
    "-8.5",
    "-17",
  ]);
  expect(values.palletKind).toBe("euro");
});

it("always uses the EURO pallet and (1200 − block) / 2 per side", () => {
  const { values } = applySheetToFormValues(
    projectToFormValues(null),
    sheetFor({
      cartonMm: { length: 172, width: 130, height: 104 },
      blockMm: { length: 1162, width: 780, height: 832 },
      palletMm: { length: 1190, width: 790 },
      cartonsPerLayer: 40,
      layers: 8,
      cartonsPerPallet: 320,
    }),
  );
  expect([
    values.palletKind,
    values.palletLengthMm,
    values.palletWidthMm,
    values.overhangLengthMm,
    values.overhangWidthMm,
  ]).toEqual(["euro", "1200", "800", "-19", "-10"]);
});
