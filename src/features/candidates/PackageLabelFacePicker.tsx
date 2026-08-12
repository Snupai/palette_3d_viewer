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
  top: "top-0 left-3 right-3 h-4 -translate-y-1/2",
  right: "top-3 right-0 bottom-3 w-4 translate-x-1/2",
  bottom: "right-3 bottom-0 left-3 h-4 translate-y-1/2",
  left: "top-3 bottom-3 left-0 w-4 -translate-x-1/2",
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
    <div className="grid gap-2 border border-zinc-700 bg-zinc-950/70 p-2.5">
      <fieldset disabled={disabled} className="grid gap-1.5">
        <legend className="text-[10px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">
          Infeed orientation
        </legend>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-zinc-700 bg-zinc-700">
          {(["lengthwise", "crosswise"] as const).map((orientation) => (
            <label
              key={orientation}
              className="relative cursor-pointer bg-zinc-900 text-center text-[10px] font-semibold text-zinc-400 uppercase has-[:checked]:bg-amber-400/15 has-[:checked]:text-amber-300 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-zinc-600"
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
              <span className="block px-2 py-2 outline-none peer-focus-visible:ring-2 peer-focus-visible:ring-amber-300 peer-focus-visible:ring-inset">
                {orientation === "lengthwise" ? "Lengthwise" : "Crosswise"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset disabled={disabled} className="grid gap-2">
        <legend className="text-[10px] font-semibold tracking-[0.1em] text-zinc-400 uppercase">
          Physical label face
        </legend>
        <p className="text-[10px] leading-4 text-zinc-500">
          Click the package edge where the label is attached.
        </p>

        <div className="relative flex h-40 items-center justify-center overflow-hidden border border-zinc-800 bg-[#111619]">
          <div
            aria-hidden="true"
            className="absolute inset-x-3 top-[42%] h-px bg-zinc-700"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-3 top-[58%] h-px bg-zinc-700"
          />
          <div
            aria-hidden="true"
            className="absolute top-1/2 right-3 h-0 w-0 -translate-y-1/2 border-y-[5px] border-l-[8px] border-y-transparent border-l-zinc-500"
          />

          <div
            className="relative grid place-items-center border border-zinc-500 bg-[#20282D] shadow-[0_8px_24px_rgba(0,0,0,0.38)]"
            style={{
              width: `${packageSize.width}px`,
              height: `${packageSize.height}px`,
            }}
          >
            <div
              aria-hidden="true"
              className="grid place-items-center gap-0.5 font-mono text-[9px] leading-none text-zinc-400"
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
                  className={`${edgePositionClass[displayedEdge]} absolute z-10 grid place-items-center border border-zinc-400 bg-zinc-700 transition-colors outline-none hover:border-amber-200 hover:bg-amber-400/60 focus-visible:ring-2 focus-visible:ring-amber-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-zinc-800 ${
                    selected
                      ? "border-amber-200 bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.55)]"
                      : ""
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`rounded-full ${selected ? "h-1.5 w-1.5 bg-zinc-950" : "h-1 w-1 bg-zinc-500"}`}
                  />
                </button>
              );
            })}
          </div>

          <div
            aria-label="Infeed direction: left to right"
            data-infeed-direction="left-to-right"
            className="absolute right-2 bottom-1.5 left-2 flex items-center justify-between font-mono text-[8px] tracking-[0.08em] text-zinc-500 uppercase"
          >
            <span>Infeed</span>
            <span aria-hidden="true">Left → right</span>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
          <p aria-live="polite" className="text-[10px] leading-4 text-zinc-400">
            {selectedPackageSide && selectedDisplayedEdge
              ? `${physicalSideLabel[selectedPackageSide]} · shown on ${selectedDisplayedEdge} edge`
              : "No nearest-edge label preference"}
          </p>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={selectedPackageSide === null}
            onClick={() => onPackageSideChange(null)}
            className="min-h-7 rounded-sm border border-zinc-700 px-2 text-[9px] font-semibold text-zinc-400 uppercase outline-none hover:border-zinc-500 hover:text-zinc-200 focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:text-zinc-600"
          >
            No label
          </button>
        </div>
      </fieldset>
    </div>
  );
}
