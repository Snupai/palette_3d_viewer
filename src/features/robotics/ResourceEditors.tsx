"use client";

import type {
  Gripper,
  PalletStation,
  PalletizingDirection,
} from "~/domain/project/projectSchema";
import { Field, NumberField as UiNumberField } from "~/components/ui";
import { useT } from "~/i18n";

const inputClass = "ui-input";

function numberFrom(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Empty -> null; non-finite input keeps the previous value (or 0). */
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
    <UiNumberField
      label={label}
      value={value}
      min={min}
      step="any"
      onChange={(raw) =>
        onChange(raw === "" ? null : numberFrom(raw, value ?? 0))
      }
    />
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
  const t = useT();
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
        <Field label={t("robotics.name")} className="md:col-span-2">
          <input
            value={value.name}
            onChange={(event) => update("name", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t("robotics.gripperKind")}>
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
            <option value="suction">{t("robotics.kind.suction")}</option>
            <option value="clamp">{t("robotics.kind.clamp")}</option>
            <option value="fork">{t("robotics.kind.fork")}</option>
          </select>
        </Field>
        <Field label={t("robotics.externalId")}>
          <input
            value={value.externalId ?? ""}
            onChange={(event) =>
              update("externalId", event.target.value.trim() || null)
            }
            className={inputClass}
          />
        </Field>
        <Field label={t("robotics.inletDirection")}>
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
            <option value="any">{t("robotics.inlet.any")}</option>
            <option value="lengthwise">{t("robotics.inlet.lengthwise")}</option>
            <option value="crosswise">{t("robotics.inlet.crosswise")}</option>
          </select>
        </Field>
        <NumberField
          label={t("robotics.maxPickupLength")}
          value={value.maxPickupLengthMm}
          min={0}
          onChange={(next) => update("maxPickupLengthMm", next)}
        />
      </div>

      <fieldset className="ed-field">
        <legend className="ed-panel-note">{t("robotics.tcpLegend")}</legend>
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

      <fieldset className="ed-field">
        <legend className="ed-panel-note">{t("robotics.toolEnvelope")}</legend>
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

      <fieldset className="ed-field">
        <legend className="ed-panel-note">
          {t("robotics.allowedPlaceRotations")}
        </legend>
        <div className="ed-actions">
          {([0, 90, 180, 270] as const).map((rotation) => (
            <label key={rotation} className="ed-check">
              <input
                type="checkbox"
                checked={value.allowedPlaceRotations.includes(rotation)}
                onChange={() => toggleRotation(rotation)}
                className="accent-brand"
              />
              {rotation}°
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="ed-field">
        <legend className="ed-panel-note">{t("robotics.packageLimits")}</legend>
        <label className="ed-check">
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
            className="accent-brand"
          />
          {t("robotics.checkPackageLimits")}
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
        <label className="ed-check">
          <input
            type="checkbox"
            checked={value.settings.multipickSinglePlace}
            onChange={(event) =>
              update("settings", {
                type: "suction",
                multipickSinglePlace: event.target.checked,
              })
            }
            className="accent-brand"
          />
          {t("robotics.multipickShared")}
        </label>
      ) : (
        <p className="ed-warn">
          {t("robotics.otherGripperWarning", {
            kind: t(`robotics.gripperType.${value.settings.type}`),
          })}
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
  const t = useT();
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
        <Field label={t("robotics.name")} className="md:col-span-2">
          <input
            value={value.name}
            onChange={(event) => update("name", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label={t("robotics.externalId")}>
          <input
            value={value.externalId ?? ""}
            onChange={(event) =>
              update("externalId", event.target.value.trim() || null)
            }
            className={inputClass}
          />
        </Field>
        <Field label={t("robotics.palletOriginX")}>
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
            <option value="left">{t("robotics.left")}</option>
            <option value="center">{t("robotics.center")}</option>
            <option value="right">{t("robotics.right")}</option>
          </select>
        </Field>
        <Field label={t("robotics.palletOriginY")}>
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
            <option value="bottom">{t("robotics.bottom")}</option>
            <option value="center">{t("robotics.center")}</option>
            <option value="top">{t("robotics.top")}</option>
          </select>
        </Field>
        <Field label={t("robotics.inletAlignment")}>
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
            <option value="left">{t("robotics.left")}</option>
            <option value="center">{t("robotics.center")}</option>
            <option value="right">{t("robotics.right")}</option>
          </select>
        </Field>
      </div>

      {(
        [
          [t("robotics.tcpEnvelope"), "tcpEnvelopeMm"],
          [t("robotics.obstacleEnvelope"), "obstacleEnvelopeMm"],
        ] as const
      ).map(([label, field]) => (
        <fieldset key={field} className="ed-field">
          <legend className="ed-panel-note">{label} (mm)</legend>
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

      <fieldset className="ed-field">
        <legend className="ed-panel-note">
          {t("robotics.robotCenterRange")}
        </legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <NumberField
            label={t("robotics.centerX")}
            value={value.robotCenterMm.x}
            onChange={(next) =>
              update("robotCenterMm", {
                ...value.robotCenterMm,
                x: next ?? value.robotCenterMm.x,
              })
            }
          />
          <NumberField
            label={t("robotics.centerY")}
            value={value.robotCenterMm.y}
            onChange={(next) =>
              update("robotCenterMm", {
                ...value.robotCenterMm,
                y: next ?? value.robotCenterMm.y,
              })
            }
          />
          <NumberField
            label={t("robotics.radiusMin")}
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
            label={t("robotics.radiusMax")}
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
          <p className="ed-warn">{t("robotics.rangeUncalibrated")}</p>
        ) : null}
      </fieldset>

      <fieldset className="ed-field">
        <legend className="ed-panel-note">
          {t("robotics.palletizingDirections")}
        </legend>
        <div className="grid gap-2 md:grid-cols-2">
          {directions.map((direction) => (
            <label key={direction} className="ed-check">
              <input
                type="checkbox"
                checked={value.allowedDirections.includes(direction)}
                onChange={() => toggleDirection(direction)}
                className="accent-brand"
              />
              {direction}
            </label>
          ))}
        </div>
        <Field label={t("robotics.preferredDirection")}>
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
        </Field>
      </fieldset>
    </div>
  );
}
