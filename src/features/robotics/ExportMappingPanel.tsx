import { NumericDraftField } from "~/features/robotics/NumericDraftField";
import type { RobotExportWorkspaceSettings } from "~/features/robotics/robotWorkspaceModel";
import {
  disclosureSummaryClass,
  fieldLabelClass,
  inputClass,
  sectionClass,
} from "~/features/robotics/roboticsStyles";

/** Advanced engineering: internal .rob export mapping settings. */
export function ExportMappingPanel({
  exportSettings,
  onChange,
}: {
  exportSettings: RobotExportWorkspaceSettings;
  onChange: (settings: RobotExportWorkspaceSettings) => void;
}) {
  return (
    <details className={sectionClass} data-testid="robotics-export-settings">
      <summary className={disclosureSummaryClass}>
        Internal .rob export mapping
      </summary>
      <div className="border-line grid gap-3 border-t p-3">
        <p className="text-muted text-xs leading-5">
          These fields describe an internal project export. They do not
          establish compatibility with an external Multipack controller.
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="text-muted grid gap-1 text-xs">
            Integer quantization
            <select
              aria-label="ROB integer quantization"
              value={exportSettings.quantization}
              onChange={(event) =>
                onChange({
                  ...exportSettings,
                  quantization: event.target
                    .value as RobotExportWorkspaceSettings["quantization"],
                })
              }
              className={inputClass}
            >
              <option value="round-half-away-from-zero">
                Round to nearest integer
              </option>
              <option value="truncate-toward-zero">Truncate toward zero</option>
              <option value="reject-decimals">Reject decimals</option>
            </select>
          </label>
          <label className="text-muted grid gap-1 text-xs">
            Final two .rob fields
            <select
              aria-label="ROB unknown field policy"
              value={exportSettings.unknownFieldMode}
              onChange={(event) =>
                onChange({
                  ...exportSettings,
                  unknownFieldMode: event.target
                    .value as RobotExportWorkspaceSettings["unknownFieldMode"],
                })
              }
              className={inputClass}
            >
              <option value="block">Block: meaning unknown</option>
              <option value="from-cycle-or-zero">
                Use grip dx/dy, otherwise 0
              </option>
              <option value="preserve-imported">
                Preserve retained imported values
              </option>
              <option value="explicit-values">Enter internal values</option>
            </select>
          </label>
          <label className="text-ink flex items-end gap-2 pb-1 text-xs">
            <input
              type="checkbox"
              checked={exportSettings.allowCountOnlyInterlayers}
              onChange={(event) =>
                onChange({
                  ...exportSettings,
                  allowCountOnlyInterlayers: event.target.checked,
                })
              }
              className="accent-brand"
            />
            Accept count-only loss for non-3 mm sheets
          </label>
        </div>
        <div className="border-line grid gap-3 border-t pt-3 lg:grid-cols-6">
          <label className={`${fieldLabelClass} lg:col-span-2`}>
            Internal mapping ID
            <input
              value={exportSettings.mappingId}
              onChange={(event) =>
                onChange({ ...exportSettings, mappingId: event.target.value })
              }
              className={inputClass}
            />
          </label>
          {(["xSign", "ySign", "yawSign"] as const).map((field) => (
            <label key={field} className={fieldLabelClass}>
              {field}
              <select
                value={exportSettings[field]}
                onChange={(event) =>
                  onChange({
                    ...exportSettings,
                    [field]: Number(event.target.value) as 1 | -1,
                  })
                }
                className={`${inputClass} font-mono`}
              >
                <option value={1}>+1</option>
                <option value={-1}>-1</option>
              </select>
            </label>
          ))}
          <NumericDraftField
            label="Yaw offset (deg)"
            value={exportSettings.yawOffsetDeg}
            onChange={(value) =>
              onChange({ ...exportSettings, yawOffsetDeg: value })
            }
          />
          <label className="text-ink flex items-end gap-2 pb-1 text-xs leading-5 lg:col-span-6">
            <input
              aria-label="Acknowledge unverified ROB mapping"
              type="checkbox"
              checked={exportSettings.mappingAcknowledged}
              onChange={(event) =>
                onChange({
                  ...exportSettings,
                  mappingAcknowledged: event.target.checked,
                })
              }
              className="accent-brand"
            />
            I acknowledge this is a user-entered internal mapping and does not
            establish external Multipack compatibility.
          </label>
        </div>
        {exportSettings.unknownFieldMode === "explicit-values" ? (
          <div className="border-line grid gap-2 border-t pt-3 md:grid-cols-2 lg:grid-cols-4">
            <NumericDraftField
              label="Field 8"
              value={exportSettings.field8}
              onChange={(value) =>
                onChange({ ...exportSettings, field8: value })
              }
            />
            <NumericDraftField
              label="Field 9"
              value={exportSettings.field9}
              onChange={(value) =>
                onChange({ ...exportSettings, field9: value })
              }
            />
            <label className={`${fieldLabelClass} lg:col-span-2`}>
              Meaning of fields 8 and 9
              <input
                value={exportSettings.unknownFieldSemantics}
                onChange={(event) =>
                  onChange({
                    ...exportSettings,
                    unknownFieldSemantics: event.target.value,
                  })
                }
                className={inputClass}
              />
            </label>
            <label className={`${fieldLabelClass} md:col-span-2 lg:col-span-4`}>
              Source of these values
              <input
                value={exportSettings.unknownFieldProvenance}
                onChange={(event) =>
                  onChange({
                    ...exportSettings,
                    unknownFieldProvenance: event.target.value,
                  })
                }
                className={inputClass}
              />
            </label>
          </div>
        ) : null}
      </div>
    </details>
  );
}
