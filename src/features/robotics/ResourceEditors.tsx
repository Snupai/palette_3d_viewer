"use client";

import type {
  Gripper,
  PalletStation,
  PalletizingDirection,
} from "~/domain/project/projectSchema";
import { Field, NumberField as UiNumberField } from "~/components/ui";

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
        <Field label="Name" className="md:col-span-2">
          <input
            value={value.name}
            onChange={(event) => update("name", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Bauart">
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
            <option value="suction">Sauggreifer</option>
            <option value="clamp">Klammergreifer (Mechanik ungeprüft)</option>
            <option value="fork">Gabelgreifer (Mechanik ungeprüft)</option>
          </select>
        </Field>
        <Field label="Externe ID">
          <input
            value={value.externalId ?? ""}
            onChange={(event) =>
              update("externalId", event.target.value.trim() || null)
            }
            className={inputClass}
          />
        </Field>
        <Field label="Einlaufrichtung">
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
            <option value="any">Beliebig</option>
            <option value="lengthwise">Längs</option>
            <option value="crosswise">Quer</option>
          </select>
        </Field>
        <NumberField
          label="Maximale Grifflänge (mm, leer = unbekannt)"
          value={value.maxPickupLengthMm}
          min={0}
          onChange={(next) => update("maxPickupLengthMm", next)}
        />
      </div>

      <fieldset className="ed-field">
        <legend className="ed-panel-note">Werkzeugmittelpunkt TCP (mm)</legend>
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
        <legend className="ed-panel-note">Hüllraum des Werkzeugs (mm)</legend>
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
        <legend className="ed-panel-note">Erlaubte Ablagedrehungen</legend>
        <div className="ed-actions">
          {([0, 90, 180, 270] as const).map((rotation) => (
            <label key={rotation} className="flex items-center gap-1.5">
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
        <legend className="ed-panel-note">Paketgrenzen (mm)</legend>
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
          Paketmaße gegen diesen Greifer prüfen
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
          Mehrfachgriff mit geteilter Ablage (übernommen, erzeugte geteilte
          Ablage ungeprüft)
        </label>
      ) : (
        <p className="ed-warn">
          Einstellungen für{" "}
          {value.settings.type === "clamp" ? "Klammergreifer" : "Gabelgreifer"}{" "}
          werden gespeichert, die erzeugte Greifmechanik ist aber ungeprüft und
          blockiert den Export.
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
        <Field label="Name" className="md:col-span-2">
          <input
            value={value.name}
            onChange={(event) => update("name", event.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Externe ID">
          <input
            value={value.externalId ?? ""}
            onChange={(event) =>
              update("externalId", event.target.value.trim() || null)
            }
            className={inputClass}
          />
        </Field>
        <Field label="Palettenursprung X">
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
            <option value="left">Links</option>
            <option value="center">Mitte</option>
            <option value="right">Rechts</option>
          </select>
        </Field>
        <Field label="Palettenursprung Y">
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
            <option value="bottom">Unten</option>
            <option value="center">Mitte</option>
            <option value="top">Oben</option>
          </select>
        </Field>
        <Field label="Ausrichtung am Einlauf">
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
            <option value="left">Links</option>
            <option value="center">Mitte</option>
            <option value="right">Rechts</option>
          </select>
        </Field>
      </div>

      {(
        [
          ["TCP-Hüllraum", "tcpEnvelopeMm"],
          ["Freiraum / Hinderniskontur", "obstacleEnvelopeMm"],
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
          Robotermitte und Reichweite (mm)
        </legend>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <NumberField
            label="Mitte X"
            value={value.robotCenterMm.x}
            onChange={(next) =>
              update("robotCenterMm", {
                ...value.robotCenterMm,
                x: next ?? value.robotCenterMm.x,
              })
            }
          />
          <NumberField
            label="Mitte Y"
            value={value.robotCenterMm.y}
            onChange={(next) =>
              update("robotCenterMm", {
                ...value.robotCenterMm,
                y: next ?? value.robotCenterMm.y,
              })
            }
          />
          <NumberField
            label="Radius min."
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
            label="Radius max."
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
          <p className="ed-warn">
            0 / 0 bedeutet: Reichweite nicht kalibriert. Die Reichweitenprüfung
            wird übersprungen, bis ein gemessener Bereich eingetragen ist.
          </p>
        ) : null}
      </fieldset>

      <fieldset className="ed-field">
        <legend className="ed-panel-note">Palettierrichtungen</legend>
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
        <Field label="Bevorzugte Richtung">
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
