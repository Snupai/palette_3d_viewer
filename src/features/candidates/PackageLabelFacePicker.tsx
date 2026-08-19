"use client";

import { useId } from "react";
import type { Project } from "~/domain/project/projectSchema";
import type { Side } from "~/domain/palletTypes";

export type PackageInletOrientation = Project["package"]["inletOrientation"];

export type PackageLabelFacePickerProps = {
  packageLengthMm: number;
  packageWidthMm: number;
  inletOrientation: PackageInletOrientation;
  selectedPackageSide: Side | null;
  disabled?: boolean;
  onInletOrientationChange: (orientation: PackageInletOrientation) => void;
  onPackageSideChange: (side: Side | null) => void;
};

const displayedEdges = [
  "top",
  "right",
  "bottom",
  "left",
] as const satisfies readonly Side[];

const packageSideByDisplayedEdge: Record<
  PackageInletOrientation,
  Record<Side, Side>
> = {
  lengthwise: {
    top: "top",
    right: "right",
    bottom: "bottom",
    left: "left",
  },
  crosswise: {
    top: "right",
    right: "bottom",
    bottom: "left",
    left: "top",
  },
};

const edgePositionClass: Record<Side, string> = {
  top: "inset-x-0 top-0 h-3 -translate-y-1/2",
  right: "inset-y-0 right-0 w-3 translate-x-1/2",
  bottom: "inset-x-0 bottom-0 h-3 translate-y-1/2",
  left: "inset-y-0 left-0 w-3 -translate-x-1/2",
};

const selectedEdgeInset: Record<Side, string> = {
  top: "inset 0 8px 0 var(--brand)",
  right: "inset -8px 0 0 var(--brand)",
  bottom: "inset 0 -8px 0 var(--brand)",
  left: "inset 8px 0 0 var(--brand)",
};

const physicalSideLabel: Record<Side, string> = {
  top: "0° top face (+Y)",
  right: "0° right face (+X)",
  bottom: "0° bottom face (−Y)",
  left: "0° left face (−X)",
};

function displayedEdgeForPackageSide(
  orientation: PackageInletOrientation,
  packageSide: Side,
): Side {
  return displayedEdges.find(
    (displayedEdge) =>
      packageSideByDisplayedEdge[orientation][displayedEdge] === packageSide,
  )!;
}

function fittedPackageSize(
  packageLengthMm: number,
  packageWidthMm: number,
  orientation: PackageInletOrientation,
): { width: number; height: number } {
  const length =
    Number.isFinite(packageLengthMm) && packageLengthMm > 0
      ? packageLengthMm
      : 1;
  const width =
    Number.isFinite(packageWidthMm) && packageWidthMm > 0 ? packageWidthMm : 1;
  const displayedWidth = orientation === "lengthwise" ? length : width;
  const displayedHeight = orientation === "lengthwise" ? width : length;
  const scale = Math.min(148 / displayedWidth, 96 / displayedHeight);

  return {
    width: Math.max(48, Math.min(148, displayedWidth * scale)),
    height: Math.max(48, Math.min(96, displayedHeight * scale)),
  };
}

export function PackageLabelFacePicker({
  packageLengthMm,
  packageWidthMm,
  inletOrientation,
  selectedPackageSide,
  disabled = false,
  onInletOrientationChange,
  onPackageSideChange,
}: PackageLabelFacePickerProps) {
  const radioName = useId();
  const packageSize = fittedPackageSize(
    packageLengthMm,
    packageWidthMm,
    inletOrientation,
  );
  const selectedDisplayedEdge = selectedPackageSide
    ? displayedEdgeForPackageSide(inletOrientation, selectedPackageSide)
    : null;

  return (
    <div className="grid gap-2 border border-[var(--line)] bg-[var(--canvas)] p-2.5">
      <fieldset disabled={disabled} className="grid gap-1.5">
        <legend className="text-[11px] font-semibold text-[var(--muted)]">
          Infeed orientation
        </legend>
        <div className="grid grid-cols-2 gap-px overflow-hidden border border-[var(--line)] bg-[var(--line)]">
          {(["lengthwise", "crosswise"] as const).map((orientation) => (
            <label
              key={orientation}
              className="relative cursor-pointer bg-[var(--surface)] text-center text-[11px] font-semibold text-[var(--muted)] has-[:checked]:bg-[var(--plan-fill)] has-[:checked]:text-[var(--brand)] has-[:disabled]:cursor-not-allowed has-[:disabled]:text-[var(--muted)]"
            >
              <input
                type="radio"
                name={radioName}
                value={orientation}
                checked={inletOrientation === orientation}
                disabled={disabled}
                onChange={() => onInletOrientationChange(orientation)}
                className="peer sr-only"
              />
              <span className="block px-2 py-2 outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--focus)] peer-focus-visible:ring-inset">
                {orientation === "lengthwise" ? "Lengthwise" : "Crosswise"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={disabled} className="grid gap-2">
        <legend className="text-[11px] font-semibold text-[var(--muted)]">
          Physical label face
        </legend>
        <p className="text-[11px] leading-4 text-[var(--muted)]">
          Click the package edge where the label is attached.
        </p>

        <div className="relative flex h-40 items-center justify-center overflow-hidden border border-[var(--line)] bg-[var(--canvas)]">
          <div
            aria-hidden="true"
            className="absolute inset-x-3 top-[42%] h-px bg-[var(--line)]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-3 top-[58%] h-px bg-[var(--line)]"
          />
          <div
            aria-hidden="true"
            className="absolute top-1/2 right-3 h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[8px] border-y-transparent border-l-[var(--muted)]"
          />

          <div
            className="relative grid place-items-center border border-[var(--line)] bg-[var(--surface)]"
            style={{
              width: `${packageSize.width}px`,
              height: `${packageSize.height}px`,
              boxShadow: selectedDisplayedEdge
                ? selectedEdgeInset[selectedDisplayedEdge]
                : undefined,
            }}
          >
            <div
              aria-hidden="true"
              className="grid place-items-center gap-0.5 font-mono text-[9px] leading-none text-[var(--muted)]"
            >
              <span>{inletOrientation === "lengthwise" ? "L →" : "W →"}</span>
              <span>{inletOrientation === "lengthwise" ? "W ↕" : "L ↕"}</span>
            </div>

            {displayedEdges.map((displayedEdge) => {
              const packageSide =
                packageSideByDisplayedEdge[inletOrientation][displayedEdge];
              const selected = selectedPackageSide === packageSide;
              return (
                <button
                  key={displayedEdge}
                  type="button"
                  disabled={disabled}
                  aria-label={`Select label on displayed ${displayedEdge} edge`}
                  aria-pressed={selected}
                  title={`Physical package face: ${physicalSideLabel[packageSide]}`}
                  onClick={() => onPackageSideChange(packageSide)}
                  className={`${edgePositionClass[displayedEdge]} absolute z-10 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] disabled:cursor-not-allowed ${
                    selected
                      ? "bg-[var(--brand)]"
                      : "bg-[var(--line)] hover:bg-[var(--brand-hover)]"
                  }`}
                />
              );
            })}
          </div>

          <div
            aria-label="Infeed direction: left to right"
            data-infeed-direction="left-to-right"
            className="absolute right-2 bottom-1.5 left-2 flex items-center justify-between font-mono text-[8px] text-[var(--muted)]"
          >
            <span>Infeed</span>
            <span aria-hidden="true">Left → right</span>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <p
            aria-live="polite"
            className={`text-[11px] leading-4 ${
              selectedPackageSide
                ? "text-[var(--ink)]"
                : "text-[var(--muted)]"
            }`}
          >
            {selectedPackageSide && selectedDisplayedEdge
              ? `${physicalSideLabel[selectedPackageSide]} · shown on ${selectedDisplayedEdge} edge`
              : "No nearest-edge label preference"}
          </p>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={selectedPackageSide === null}
            onClick={() => onPackageSideChange(null)}
            className={`${
              selectedPackageSide === null ? "ui-btn-primary" : "ui-btn"
            } min-h-7 px-2 text-[11px]`}
          >
            No label
          </button>
        </div>
      </fieldset>
    </div>
  );
}
