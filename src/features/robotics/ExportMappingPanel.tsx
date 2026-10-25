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
  return (
    <details className="ed-sub-details" data-testid="robotics-export-settings">
      <summary>Export-Zuordnung (.rob)</summary>
      <div>
        <div className="ed-grid3">
          <label className="ed-field">
            Ganzzahl-Rundung
            <select
              aria-label="Ganzzahl-Rundung"
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
                Auf ganze Zahl runden
              </option>
              <option value="truncate-toward-zero">
                Nachkommastellen abschneiden
              </option>
              <option value="reject-decimals">Dezimalwerte ablehnen</option>
            </select>
          </label>
          <label className="ed-field">
            Letzte zwei .rob-Felder
            <select
              aria-label="Behandlung der letzten .rob-Felder"
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
              <option value="block">Blockieren: Bedeutung unbekannt</option>
              <option value="from-cycle-or-zero">Griff-dx/dy, sonst 0</option>
              <option value="preserve-imported">
                Importierte Werte beibehalten
              </option>
              <option value="explicit-values">Werte eintragen</option>
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
            Nur Anzahl exportieren, wenn Zwischenlagen nicht 3 mm sind
          </label>
        </div>
        <div className="ed-grid3">
          <label className="ed-field">
            Interne Zuordnungs-ID
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
              ["Vorzeichen X", "xSign"],
              ["Vorzeichen Y", "ySign"],
              ["Vorzeichen Drehung", "yawSign"],
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
            label="Drehungs-Offset (°)"
            value={exportSettings.yawOffsetDeg}
            onChange={(value) =>
              onChange({ ...exportSettings, yawOffsetDeg: value })
            }
          />
        </div>
        <label className="ed-check">
          <input
            aria-label="Ungeprüfte .rob-Zuordnung bestätigen"
            type="checkbox"
            checked={exportSettings.mappingAcknowledged}
            onChange={(event) =>
              onChange({
                ...exportSettings,
                mappingAcknowledged: event.target.checked,
              })
            }
          />
          Diese Zuordnung ist selbst eingetragen und belegt keine externe
          Multipack-Kompatibilität.
        </label>
        {exportSettings.unknownFieldMode === "explicit-values" ? (
          <div className="ed-grid2">
            <NumericDraftField
              label="Feld 8"
              value={exportSettings.field8}
              onChange={(value) =>
                onChange({ ...exportSettings, field8: value })
              }
            />
            <NumericDraftField
              label="Feld 9"
              value={exportSettings.field9}
              onChange={(value) =>
                onChange({ ...exportSettings, field9: value })
              }
            />
            <label className="ed-field">
              Bedeutung der Felder 8 und 9
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
              Quelle dieser Werte
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
