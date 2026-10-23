import type { Grip } from "~/domain/palletTypes";
import type {
  LayerEditorDraft,
  LayerEditorDraftField,
} from "~/hooks/useLayerEditor";

export type GripInspectorProps = {
  selectedGripIndex: number | null;
  gripCount: number;
  selectedGrip: Grip | null;
  draft: LayerEditorDraft;
  message: string | null;
  onDraftChange: (field: LayerEditorDraftField, value: string) => void;
  onDraftCommit: (field: LayerEditorDraftField) => void;
  onDraftReset: () => void;
  onRotate: () => void;
};

const INPUT_CLASS = "ui-input px-2 py-1.5 font-mono text-micro";

export function GripInspector({
  selectedGripIndex,
  gripCount,
  selectedGrip,
  draft,
  message,
  onDraftChange,
  onDraftCommit,
  onDraftReset,
  onRotate,
}: GripInspectorProps) {
  const fieldInput = (
    label: string,
    field: LayerEditorDraftField,
    options?: { readOnly?: boolean; fullWidth?: boolean },
  ) => (
    <label
      className={`text-micro text-muted flex flex-col gap-1 ${
        options?.fullWidth ? "col-span-2" : ""
      }`}
    >
      <span>{label}</span>
      <input
        type="number"
        value={draft[field]}
        readOnly={options?.readOnly}
        disabled={!selectedGrip}
        onChange={(event) => onDraftChange(field, event.target.value)}
        onBlur={() => onDraftCommit(field)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") onDraftReset();
        }}
        className={`${INPUT_CLASS} disabled:cursor-not-allowed disabled:opacity-45 ${
          options?.readOnly ? "text-muted! cursor-default" : ""
        }`}
      />
    </label>
  );

  return (
    <aside className="border-line bg-canvas border p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-body text-ink font-semibold">Grip details</h3>
        <span className="text-micro text-muted font-mono">
          {selectedGripIndex === null
            ? "none"
            : `${selectedGripIndex + 1}/${gripCount}`}
        </span>
      </div>
      <p className="text-micro text-muted mb-2 font-medium">Place pose</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
        {fieldInput("Place X", "x")}
        {fieldInput("Place Y", "y")}
        {fieldInput("Place rotation", "rotation", { fullWidth: true })}
      </div>
      <p className="text-micro text-muted mt-4 mb-2 font-medium">Pick pose</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
        {fieldInput("Pick X", "pickX")}
        {fieldInput("Pick Y", "pickY")}
        {fieldInput("Pick rotation", "pickRotation", { fullWidth: true })}
      </div>
      <p className="text-micro text-muted mt-4 mb-2 font-medium">Grip</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
        <label className="text-micro text-muted col-span-2 flex flex-col gap-1">
          <span>Packages</span>
          <input
            type="number"
            value={selectedGrip?.numPackages ?? ""}
            readOnly
            disabled={!selectedGrip}
            className={`${INPUT_CLASS} text-muted! cursor-default disabled:cursor-not-allowed disabled:opacity-45`}
          />
        </label>
        {fieldInput("dx", "dx")}
        {fieldInput("dy", "dy")}
      </div>
      <button
        type="button"
        onClick={onRotate}
        disabled={!selectedGrip}
        className="ui-btn text-micro mt-3 w-full font-medium"
      >
        Rotate 90°
      </button>
      {message ? (
        <p className="text-micro text-ink mt-3 leading-relaxed" role="status">
          {message}
        </p>
      ) : null}
    </aside>
  );
}
