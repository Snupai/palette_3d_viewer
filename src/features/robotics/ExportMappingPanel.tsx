import { useT } from "~/i18n";
import { NumericDraftField } from "~/features/robotics/NumericDraftField";
import type { RobotExportWorkspaceSettings } from "~/features/robotics/robotWorkspaceModel";

/** Technik: internal .rob export mapping settings. */
export function ExportMappingPanel({
  exportSettings,
  onChange,
}: {
  exportSettings: RobotExportWorkspaceSettings;
  onChange: (settings: RobotExportWorkspaceSettings) => void;
}) {
  const t = useT();
  return (
    <details className="ed-sub-details" data-testid="robotics-export-settings">
      <summary>{t("robotics.exportMapping")}</summary>
      <div>
        <div className="ed-grid3">
          <label className="ed-field">
            {t("robotics.quantization")}
            <select
              aria-label={t("robotics.quantization")}
              value={exportSettings.quantization}
              onChange={(event) =>
                onChange({
                  ...exportSettings,
                  quantization: event.target
                    .value as RobotExportWorkspaceSettings["quantization"],
                })
              }
              className="ui-input"
            >
              <option value="round-half-away-from-zero">
                {t("robotics.quantization.round")}
              </option>
              <option value="truncate-toward-zero">
                {t("robotics.quantization.truncate")}
              </option>
              <option value="reject-decimals">
                {t("robotics.quantization.reject")}
              </option>
            </select>
          </label>
          <label className="ed-field">
            {t("robotics.lastTwoFields")}
            <select
              aria-label={t("robotics.lastTwoFieldsAria")}
              value={exportSettings.unknownFieldMode}
              onChange={(event) =>
                onChange({
                  ...exportSettings,
                  unknownFieldMode: event.target
                    .value as RobotExportWorkspaceSettings["unknownFieldMode"],
                })
              }
              className="ui-input"
            >
              <option value="block">{t("robotics.unknownField.block")}</option>
              <option value="from-cycle-or-zero">
                {t("robotics.unknownField.fromCycle")}
              </option>
              <option value="preserve-imported">
                {t("robotics.unknownField.preserve")}
              </option>
              <option value="explicit-values">
                {t("robotics.unknownField.explicit")}
              </option>
            </select>
          </label>
          <label className="ed-check">
            <input
              type="checkbox"
              checked={exportSettings.allowCountOnlyInterlayers}
              onChange={(event) =>
                onChange({
                  ...exportSettings,
                  allowCountOnlyInterlayers: event.target.checked,
                })
              }
            />
            {t("robotics.countOnlyInterlayers")}
          </label>
        </div>
        <div className="ed-grid3">
          <label className="ed-field">
            {t("robotics.mappingId")}
            <input
              value={exportSettings.mappingId}
              onChange={(event) =>
                onChange({ ...exportSettings, mappingId: event.target.value })
              }
              className="ui-input"
            />
          </label>
          {(
            [
              [t("robotics.signX"), "xSign"],
              [t("robotics.signY"), "ySign"],
              [t("robotics.signRotation"), "yawSign"],
            ] as const
          ).map(([label, field]) => (
            <label key={field} className="ed-field">
              {label}
              <select
                value={exportSettings[field]}
                onChange={(event) =>
                  onChange({
                    ...exportSettings,
                    [field]: Number(event.target.value) as 1 | -1,
                  })
                }
                className="ui-input"
              >
                <option value={1}>+1</option>
                <option value={-1}>-1</option>
              </select>
            </label>
          ))}
          <NumericDraftField
            label={t("robotics.rotationOffset")}
            value={exportSettings.yawOffsetDeg}
            onChange={(value) =>
              onChange({ ...exportSettings, yawOffsetDeg: value })
            }
          />
        </div>
        <label className="ed-check">
          <input
            aria-label={t("robotics.acknowledgeAria")}
            type="checkbox"
            checked={exportSettings.mappingAcknowledged}
            onChange={(event) =>
              onChange({
                ...exportSettings,
                mappingAcknowledged: event.target.checked,
              })
            }
          />
          {t("robotics.acknowledgeText")}
        </label>
        {exportSettings.unknownFieldMode === "explicit-values" ? (
          <div className="ed-grid2">
            <NumericDraftField
              label={t("robotics.field8")}
              value={exportSettings.field8}
              onChange={(value) =>
                onChange({ ...exportSettings, field8: value })
              }
            />
            <NumericDraftField
              label={t("robotics.field9")}
              value={exportSettings.field9}
              onChange={(value) =>
                onChange({ ...exportSettings, field9: value })
              }
            />
            <label className="ed-field">
              {t("robotics.fieldsMeaning")}
              <input
                value={exportSettings.unknownFieldSemantics}
                onChange={(event) =>
                  onChange({
                    ...exportSettings,
                    unknownFieldSemantics: event.target.value,
                  })
                }
                className="ui-input"
              />
            </label>
            <label className="ed-field">
              {t("robotics.fieldsSource")}
              <input
                value={exportSettings.unknownFieldProvenance}
                onChange={(event) =>
                  onChange({
                    ...exportSettings,
                    unknownFieldProvenance: event.target.value,
                  })
                }
                className="ui-input"
              />
            </label>
          </div>
        ) : null}
      </div>
    </details>
  );
}
