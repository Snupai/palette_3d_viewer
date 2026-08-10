"use client";

import type {
  Gripper,
  PalletStation,
  PalletizingDirection,
} from "~/domain/project/projectSchema";

const inputClass =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/20";
const labelClass = "grid gap-1 text-[11px] text-zinc-500";

function numberFrom(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function NumberField({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
}) {
  return (
    <label className={labelClass}>
      {label}
      <input
        type="number"
        value={value ?? ""}
        min={min}
        step="any"
        onChange={(event) =>
          onChange(
            event.target.value === ""
              ? null
              : numberFrom(event.target.value, value ?? 0),
          )
        }
        className={inputClass}
      />
    </label>
  );
}

function gripperSettingsFor(
  type: Gripper["settings"]["type"],
): Gripper["settings"] {
  if (type === "clamp") {
    return {
      type: "clamp",
      allowedPickPositions: ["0-center"],
      packageOverhangMm: 0,
      maxOverhangMm: 0,
      flapLengthMm: 0,
    };
  }
  if (type === "fork") {
    return {
      type: "fork",
      tineSpacingMm: 100,
      tineWidthMm: 20,
      tineCount: 2,
      firstTineOffsetMm: 0,
      depthMm: 400,
      maxOverhangMm: 0,
      movableTines: false,
      allowedPickRotations: [0, 180],
    };
  }
  return { type: "suction", multipickSinglePlace: false };
}

export function GripperEditor({
  value,
  onChange,
}: {
  value: Gripper;
  onChange: (value: Gripper) => void;
}) {
  const update = <K extends keyof Gripper>(key: K, next: Gripper[K]) =>
    onChange({ ...value, [key]: next });
  const toggleRotation = (rotation: 0 | 90 | 180 | 270) => {
    const selected = value.allowedPlaceRotations.includes(rotation);
    if (selected && value.allowedPlaceRotations.length === 1) return;
    update(
      "allowedPlaceRotations",
      selected
        ? value.allowedPlaceRotations.filter((item) => item !== rotation)
        : [...value.allowedPlaceRotations, rotation].sort((a, b) => a - b),
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 md:grid-cols-3">
        <label className={`${labelClass} md:col-span-2`}>
          Name
          <input
            value={value.name}
            onChange={(event) => update("name", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Type
          <select
            value={value.settings.type}
            onChange={(event) =>
              update(
                "settings",
                gripperSettingsFor(
                  event.target.value as Gripper["settings"]["type"],
                ),
              )
            }
            className={inputClass}
          >
            <option value="suction">Suction</option>
            <option value="clamp">
              Clamp (generated mechanics unverified)
            </option>
            <option value="fork">Fork (generated mechanics unverified)</option>
          </select>
        </label>
        <label className={labelClass}>
          External ID
          <input
            value={value.externalId ?? ""}
            onChange={(event) =>
              update("externalId", event.target.value.trim() || null)
            }
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Inlet orientation
          <select
            value={value.inletOrientation}
            onChange={(event) =>
              update(
                "inletOrientation",
                event.target.value as Gripper["inletOrientation"],
              )
            }
            className={inputClass}
          >
            <option value="any">Any</option>
            <option value="lengthwise">Lengthwise</option>
            <option value="crosswise">Crosswise</option>
          </select>
        </label>
        <NumberField
          label="Maximum pickup length (mm; blank = unknown)"
          value={value.maxPickupLengthMm}
          min={0}
          onChange={(next) => update("maxPickupLengthMm", next)}
        />
      </div>

      <fieldset className="grid gap-2 border-t border-zinc-800 pt-3">
        <legend className="pr-2 text-xs font-medium text-zinc-300">
          TCP (mm)
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {(["x", "y", "z"] as const).map((axis) => (
            <NumberField
              key={axis}
              label={axis.toUpperCase()}
              value={value.tcpMm[axis]}
              onChange={(next) =>
                update("tcpMm", {
                  ...value.tcpMm,
                  [axis]: next ?? value.tcpMm[axis],
                })
              }
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-2 border-t border-zinc-800 pt-3">
        <legend className="pr-2 text-xs font-medium text-zinc-300">
          Horizontal tool envelope (mm)
        </legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {(["negativeX", "positiveX", "negativeY", "positiveY"] as const).map(
            (field) => (
              <NumberField
                key={field}
                label={field}
                min={0}
                value={value.envelopeMm[field]}
                onChange={(next) =>
                  update("envelopeMm", {
                    ...value.envelopeMm,
                    [field]: Math.max(0, next ?? value.envelopeMm[field]),
                  })
                }
              />
            ),
          )}
        </div>
      </fieldset>

      <fieldset className="grid gap-2 border-t border-zinc-800 pt-3">
        <legend className="pr-2 text-xs font-medium text-zinc-300">
          Allowed place rotations
        </legend>
        <div className="flex flex-wrap gap-3 text-xs text-zinc-300">
          {([0, 90, 180, 270] as const).map((rotation) => (
            <label key={rotation} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={value.allowedPlaceRotations.includes(rotation)}
                onChange={() => toggleRotation(rotation)}
                className="accent-amber-400"
              />
              {rotation}°
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="grid gap-2 border-t border-zinc-800 pt-3">
        <legend className="pr-2 text-xs font-medium text-zinc-300">
          Package limits (mm)
        </legend>
        <label className="flex items-center gap-2 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={value.packageLimits !== null}
            onChange={(event) =>
              update(
                "packageLimits",
                event.target.checked
                  ? {
                      lengthMm: { min: 1, max: 10_000 },
                      widthMm: { min: 1, max: 10_000 },
                      heightMm: { min: 1, max: 10_000 },
                    }
                  : null,
              )
            }
            className="accent-amber-400"
          />
          Validate package dimensions against this gripper
        </label>
        {value.packageLimits ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            {(["lengthMm", "widthMm", "heightMm"] as const).flatMap(
              (dimension) =>
                (["min", "max"] as const).map((bound) => (
                  <NumberField
                    key={`${dimension}-${bound}`}
                    label={`${dimension.replace("Mm", "")} ${bound}`}
                    min={0}
                    value={value.packageLimits![dimension][bound]}
                    onChange={(next) =>
                      update("packageLimits", {
                        ...value.packageLimits!,
                        [dimension]: {
                          ...value.packageLimits![dimension],
                          [bound]: Math.max(
                            0,
                            next ?? value.packageLimits![dimension][bound],
                          ),
                        },
                      })
                    }
                  />
                )),
            )}
          </div>
        ) : null}
      </fieldset>

      {value.settings.type === "suction" ? (
        <label className="flex items-center gap-2 border-t border-zinc-800 pt-3 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={value.settings.multipickSinglePlace}
            onChange={(event) =>
              update("settings", {
                type: "suction",
                multipickSinglePlace: event.target.checked,
              })
            }
            className="accent-amber-400"
          />
          Multipick with split/single release (retained, generated split release
          unverified)
        </label>
      ) : (
        <p className="border-t border-zinc-800 pt-3 text-xs leading-5 text-amber-200">
          {value.settings.type === "clamp" ? "Clamp" : "Fork"} settings are
          retained as project data, but generated pick mechanics and kinematics
          are not verified and remain export-blocking.
        </p>
      )}
    </div>
  );
}

const directions: readonly PalletizingDirection[] = [
  "x-positive-y-positive",
  "x-positive-y-negative",
  "x-negative-y-positive",
  "x-negative-y-negative",
];

export function StationEditor({
  value,
  onChange,
}: {
  value: PalletStation;
  onChange: (value: PalletStation) => void;
}) {
  const update = <K extends keyof PalletStation>(
    key: K,
    next: PalletStation[K],
  ) => onChange({ ...value, [key]: next });
  const toggleDirection = (direction: PalletizingDirection) => {
    const selected = value.allowedDirections.includes(direction);
    if (selected && value.allowedDirections.length === 1) return;
    const allowedDirections = selected
      ? value.allowedDirections.filter((item) => item !== direction)
      : [...value.allowedDirections, direction];
    onChange({
      ...value,
      allowedDirections,
      preferredDirection: allowedDirections.includes(value.preferredDirection)
        ? value.preferredDirection
        : allowedDirections[0]!,
    });
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 md:grid-cols-3">
        <label className={`${labelClass} md:col-span-2`}>
          Name
          <input
            value={value.name}
            onChange={(event) => update("name", event.target.value)}
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          External ID
          <input
            value={value.externalId ?? ""}
            onChange={(event) =>
              update("externalId", event.target.value.trim() || null)
            }
            className={inputClass}
          />
        </label>
        <label className={labelClass}>
          Pallet origin X
          <select
            value={value.palletOrigin.x}
            onChange={(event) =>
              update("palletOrigin", {
                ...value.palletOrigin,
                x: event.target.value as PalletStation["palletOrigin"]["x"],
              })
            }
            className={inputClass}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className={labelClass}>
          Pallet origin Y
          <select
            value={value.palletOrigin.y}
            onChange={(event) =>
              update("palletOrigin", {
                ...value.palletOrigin,
                y: event.target.value as PalletStation["palletOrigin"]["y"],
              })
            }
            className={inputClass}
          >
            <option value="bottom">Bottom</option>
            <option value="center">Center</option>
            <option value="top">Top</option>
          </select>
        </label>
        <label className={labelClass}>
          Inlet alignment
          <select
            value={value.inletAlignment}
            onChange={(event) =>
              update(
                "inletAlignment",
                event.target.value as PalletStation["inletAlignment"],
              )
            }
            className={inputClass}
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
        </label>
      </div>

      {(
        [
          ["TCP envelope", "tcpEnvelopeMm"],
          ["Free-space / obstacle contour", "obstacleEnvelopeMm"],
        ] as const
      ).map(([label, field]) => (
        <fieldset
          key={field}
          className="grid gap-2 border-t border-zinc-800 pt-3"
        >
          <legend className="pr-2 text-xs font-medium text-zinc-300">
            {label} (mm)
          </legend>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(
              ["negativeX", "positiveX", "negativeY", "positiveY"] as const
            ).map((bound) => (
              <NumberField
                key={bound}
                label={bound}
                min={0}
                value={value[field][bound]}
                onChange={(next) =>
                  update(field, {
                    ...value[field],
                    [bound]: Math.max(0, next ?? value[field][bound]),
                  })
                }
              />
            ))}
          </div>
        </fieldset>
      ))}

      <fieldset className="grid gap-2 border-t border-zinc-800 pt-3">
        <legend className="pr-2 text-xs font-medium text-zinc-300">
          Robot center and radial reach (mm)
        </legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <NumberField
            label="Center X"
            value={value.robotCenterMm.x}
            onChange={(next) =>
              update("robotCenterMm", {
                ...value.robotCenterMm,
                x: next ?? value.robotCenterMm.x,
              })
            }
          />
          <NumberField
            label="Center Y"
            value={value.robotCenterMm.y}
            onChange={(next) =>
              update("robotCenterMm", {
                ...value.robotCenterMm,
                y: next ?? value.robotCenterMm.y,
              })
            }
          />
          <NumberField
            label="Minimum radius"
            min={0}
            value={value.robotRadiusMm.min}
            onChange={(next) =>
              update("robotRadiusMm", {
                ...value.robotRadiusMm,
                min: Math.max(0, next ?? value.robotRadiusMm.min),
              })
            }
          />
          <NumberField
            label="Maximum radius"
            min={0}
            value={value.robotRadiusMm.max}
            onChange={(next) =>
              update("robotRadiusMm", {
                ...value.robotRadiusMm,
                max: Math.max(0, next ?? value.robotRadiusMm.max),
              })
            }
          />
        </div>
        {value.robotRadiusMm.min === 0 && value.robotRadiusMm.max === 0 ? (
          <p className="text-[11px] leading-5 text-amber-200">
            0 / 0 means radial reach is not calibrated. Reach checks will be
            skipped until a measured range is entered.
          </p>
        ) : null}
      </fieldset>

      <fieldset className="grid gap-2 border-t border-zinc-800 pt-3">
        <legend className="pr-2 text-xs font-medium text-zinc-300">
          Palletizing directions
        </legend>
        <div className="grid gap-2 md:grid-cols-2">
          {directions.map((direction) => (
            <label
              key={direction}
              className="flex items-center gap-2 text-xs text-zinc-300"
            >
              <input
                type="checkbox"
                checked={value.allowedDirections.includes(direction)}
                onChange={() => toggleDirection(direction)}
                className="accent-amber-400"
              />
              {direction}
            </label>
          ))}
        </div>
        <label className={labelClass}>
          Preferred direction
          <select
            value={value.preferredDirection}
            onChange={(event) =>
              update(
                "preferredDirection",
                event.target.value as PalletizingDirection,
              )
            }
            className={inputClass}
          >
            {value.allowedDirections.map((direction) => (
              <option key={direction} value={direction}>
                {direction}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
    </div>
  );
}
