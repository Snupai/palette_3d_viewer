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
  top: "inset-x-0 top-0 h-11 -translate-y-1/2",
  right: "inset-y-0 right-0 w-11 translate-x-1/2",
  bottom: "inset-x-0 bottom-0 h-11 translate-y-1/2",
  left: "inset-y-0 left-0 w-11 -translate-x-1/2",
};

const edgeBarPositionClass: Record<Side, string> = {
  top: "inset-x-0 top-1/2 -translate-y-1/2",
  right: "inset-y-0 left-1/2 -translate-x-1/2",
  bottom: "inset-x-0 top-1/2 -translate-y-1/2",
  left: "inset-y-0 left-1/2 -translate-x-1/2",
};

const edgeBarSizeClass = (edge: Side, selected: boolean): string =>
  edge === "top" || edge === "bottom"
    ? selected
      ? "h-[6px]"
      : "h-[3px]"
    : selected
      ? "w-[6px]"
      : "w-[3px]";

const edgeLabelPositionClass: Record<Side, string> = {
  top: "-top-5 left-1/2 -translate-x-1/2",
  right: "top-1/2 -right-9 -translate-y-1/2",
  bottom: "-bottom-5 left-1/2 -translate-x-1/2",
  left: "top-1/2 -left-9 -translate-y-1/2",
};

const edgeLabelText: Record<Side, string> = {
  top: "Top",
  right: "Right",
  bottom: "Bottom",
  left: "Left",
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
    <div className="border-line bg-canvas grid gap-2 border p-2.5">
      <fieldset disabled={disabled} className="grid gap-1.5">
        <legend className="text-micro text-muted font-semibold">
          Infeed orientation
        </legend>
        <div className="border-line bg-line grid grid-cols-2 gap-px overflow-hidden border">
          {(["lengthwise", "crosswise"] as const).map((orientation) => (
            <label
              key={orientation}
              className="bg-surface text-micro text-muted has-[:checked]:bg-plan-fill has-[:checked]:text-brand has-[:disabled]:text-muted relative cursor-pointer text-center font-semibold has-[:disabled]:cursor-not-allowed"
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
              <span className="peer-focus-visible:ring-focus block px-2 py-2 outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-inset">
                {orientation === "lengthwise" ? "Lengthwise" : "Crosswise"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={disabled} className="grid gap-2">
        <legend className="text-micro text-muted font-semibold">
          Physical label face
        </legend>
        <div className="border-line bg-canvas relative flex h-40 items-center justify-center overflow-hidden border">
          <div
            aria-hidden="true"
            className="bg-line absolute inset-x-3 top-[42%] h-px"
          />
          <div
            aria-hidden="true"
            className="bg-line absolute inset-x-3 top-[58%] h-px"
          />
          <div
            aria-hidden="true"
            className="border-l-muted absolute top-1/2 right-3 h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[8px] border-y-transparent"
          />

          <div
            className="border-line bg-surface relative grid place-items-center border"
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
              className="text-micro text-muted grid place-items-center gap-0.5 font-mono leading-none"
            >
              <span>{inletOrientation === "lengthwise" ? "L →" : "W →"}</span>
              <span>{inletOrientation === "lengthwise" ? "W ↕" : "L ↕"}</span>
            </div>

            {displayedEdges.map((displayedEdge) => {
              const packageSide =
                packageSideByDisplayedEdge[inletOrientation][displayedEdge];
              const selected = selectedPackageSide === packageSide;
              return (
                <span key={displayedEdge} className="contents">
                  <span
                    aria-hidden="true"
                    className={`text-micro pointer-events-none absolute z-10 font-mono ${edgeLabelPositionClass[displayedEdge]} ${
                      selected ? "text-ink font-bold" : "text-muted"
                    }`}
                  >
                    {edgeLabelText[displayedEdge]}
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`Select label on displayed ${displayedEdge} edge`}
                    aria-pressed={selected}
                    title={`Physical package face: ${physicalSideLabel[packageSide]}`}
                    onClick={() => onPackageSideChange(packageSide)}
                    className={`${edgePositionClass[displayedEdge]} group focus-visible:ring-focus absolute z-10 cursor-pointer outline-none focus-visible:ring-2 disabled:cursor-not-allowed`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute ${edgeBarPositionClass[displayedEdge]} ${edgeBarSizeClass(displayedEdge, selected)} ${
                        selected
                          ? "bg-brand"
                          : "bg-line group-hover:bg-brand-hover"
                      }`}
                    />
                  </button>
                </span>
              );
            })}
          </div>

          <div
            aria-label="Infeed direction: left to right"
            data-infeed-direction="left-to-right"
            className="text-micro text-muted absolute right-2 bottom-1.5 left-2 flex items-center justify-between font-mono"
          >
            <span>Infeed</span>
            <span aria-hidden="true">Left → right</span>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <p
            aria-live="polite"
            className={`text-micro leading-4 ${
              selectedPackageSide ? "text-ink" : "text-muted"
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
            } text-micro min-h-7 px-2`}
          >
            No label
          </button>
        </div>
      </fieldset>
    </div>
  );
}
