import { describe, expect, it } from "vitest";
import { translateDe } from "~/i18n";
import {
  buildProjectFromForm,
  projectToFormValues,
} from "~/features/project/projectForm";
import {
  firstSectionWithError,
  geometryReviewChanges,
  fieldErrorMessage,
  labelSideLabel,
  loadAreaMm,
  sectionSummary,
  simpleGridCount,
  solverInputChanges,
  validateProjectFormValues,
} from "~/features/project/guidedProjectFormModel";

const deps = { now: () => 1, createId: (kind: string) => `${kind}-guided` };

function filled() {
  return {
    ...projectToFormValues(null),
    productNumber: "A-1",
    packageLengthMm: "400",
    packageWidthMm: "300",
    packageHeightMm: "190",
  };
}

describe("guided project form model", () => {
  it("routes schema errors to the section that owns the field, in form order", () => {
    const errors = validateProjectFormValues(
      { ...filled(), packageHeightMm: "", maxGrossKg: "10", tareKg: "25" },
      null,
      translateDe,
    );
    expect(Object.keys(errors).sort()).toEqual([
      "package.dimensionsMm.height",
      "pallet.maxGrossKg",
    ]);
    expect(firstSectionWithError(errors)).toBe("package");
    expect(firstSectionWithError({ "pallet.maxGrossKg": "x" })).toBe("limits");
    expect(
      firstSectionWithError({ "pallet.allowedOverhangMm.width": "x" }),
    ).toBe("pallet");
    expect(firstSectionWithError({ productNumber: "x" })).toBe("meta");
    expect(fieldErrorMessage(errors["pallet.maxGrossKg"]!, translateDe)).toBe(
      "Muss mindestens so groß wie das Leergewicht sein.",
    );
    expect(
      fieldErrorMessage(errors["package.dimensionsMm.height"]!, translateDe),
    ).toBe("Bitte eine Zahl eingeben.");
  });

  it("summarises collapsed sections in German from the current values", () => {
    const values = {
      ...filled(),
      packageWeightKg: "3.4",
      overhangLengthMm: "40",
      overhangWidthMm: "-20",
      productNumber: "1329-00004",
    };
    expect(sectionSummary("package", values, translateDe, "de-DE")).toBe(
      "400 × 300 × 190 mm, 3,4 kg",
    );
    expect(sectionSummary("pallet", values, translateDe, "de-DE")).toBe(
      "Euro-Palette 1.200 × 800 mm, Überstand +40 / -20 mm gesamt",
    );
    expect(sectionSummary("limits", values, translateDe, "de-DE")).toBe(
      "Lagerhöhe 1.800 mm, max. 1.500 kg brutto",
    );
    expect(sectionSummary("handling", values, translateDe, "de-DE")).toBe(
      "Einlauf längs, Etikett unten, Mehrfachgriff",
    );
    expect(
      sectionSummary(
        "limits",
        {
          ...values,
          maxGrossKg: "",
          hasStorageEnvelope: false,
        },
        translateDe,
        "de-DE",
      ),
    ).toBe("Keine Lagerhöhe, kein Gewichtslimit");
    expect(sectionSummary("meta", values, translateDe, "de-DE")).toBe(
      "Artikel 1329-00004",
    );
    expect(
      sectionSummary(
        "meta",
        { ...values, projectNumber: "AP-5006" },
        translateDe,
        "de-DE",
      ),
    ).toBe("Artikel 1329-00004, Linie AP-5006");
    expect(
      sectionSummary(
        "meta",
        { ...values, productNumber: "" },
        translateDe,
        "de-DE",
      ),
    ).toBe("Artikelnummer fehlt noch");
    // Storage footprint off: the +40 mm overhang would not fit 1200 × 800.
    expect(
      validateProjectFormValues(
        { ...values, productNumber: " ", hasStorageEnvelope: false },
        null,
        translateDe,
      ),
    ).toEqual({ productNumber: "Darf nicht leer sein." });
    expect(
      sectionSummary(
        "package",
        projectToFormValues(null),
        translateDe,
        "de-DE",
      ),
    ).toBe("Länge, Breite und Höhe fehlen noch");
  });

  it("names the label edge as seen at a crosswise infeed", () => {
    expect(labelSideLabel("bottom", "lengthwise", translateDe)).toBe("unten");
    expect(labelSideLabel("bottom", "crosswise", translateDe)).toBe("rechts");
    expect(labelSideLabel("", "crosswise", translateDe)).toBe("ohne Vorgabe");
  });

  it("derives the load area and the single-orientation grid reference", () => {
    const values = {
      ...filled(),
      overhangLengthMm: "40",
      overhangWidthMm: "0",
    };
    expect(loadAreaMm(values)).toEqual({ length: 1240, width: 800 });
    // 1240/400 = 3 × 800/300 = 2 → 6; rotated 1240/300 = 4 × 800/400 = 2 → 8.
    expect(simpleGridCount(values)).toBe(8);
    expect(simpleGridCount({ ...values, packageClearanceMm: "20" })).toBe(6);
    expect(simpleGridCount(projectToFormValues(null))).toBeNull();
  });

  it("detects only edits that change the solver input", () => {
    const project = buildProjectFromForm(filled(), null, deps);
    const values = projectToFormValues(project);
    expect(solverInputChanges(project, values)).toBe(false);
    expect(
      solverInputChanges(project, {
        ...values,
        packageWeightKg: "5",
        productNumber: "A-1",
        hasStorageEnvelope: true,
      }),
    ).toBe(false);
    expect(
      solverInputChanges(project, { ...values, packageLengthMm: "410" }),
    ).toBe(true);
    expect(
      solverInputChanges(project, { ...values, inletOrientation: "crosswise" }),
    ).toBe(true);
    expect(
      solverInputChanges(project, { ...values, packageLengthMm: "" }),
    ).toBeNull();
  });

  it("keeps the footer hint and the persisted review flag on one signature", () => {
    const project = buildProjectFromForm(filled(), null, deps);
    const values = projectToFormValues(project);
    const storageOnly = { ...values, storageHeightMm: "1600" };
    expect(solverInputChanges(project, storageOnly)).toBe(false);
    expect(geometryReviewChanges(project, storageOnly)).toBe(false);
    const palletHeight = { ...values, palletHeightMm: "150" };
    expect(solverInputChanges(project, palletHeight)).toBe(false);
    expect(geometryReviewChanges(project, palletHeight)).toBe(true);
    const packageLength = { ...values, packageLengthMm: "410" };
    expect(solverInputChanges(project, packageLength)).toBe(true);
    expect(geometryReviewChanges(project, packageLength)).toBe(true);
  });
});
