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

const INPUT_CLASS =
  "w-full rounded border border-cyan-500/20 bg-slate-950/50 px-2 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-cyan-400/60 focus:ring-0";

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
    options?: { readOnly?: boolean },
  ) => (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
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
          options?.readOnly ? "cursor-default text-slate-400" : ""
        }`}
      />
    </label>
  );

  return (
    <aside className="rounded border border-cyan-500/10 bg-slate-950/35 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-cyan-200">Grip details</h3>
        <span className="font-mono text-[10px] text-cyan-200/70">
          {selectedGripIndex === null
            ? "none"
            : `${selectedGripIndex + 1}/${gripCount}`}
        </span>
      </div>
      <p className="mb-2 text-[11px] font-medium tracking-wide text-slate-300 uppercase">
        Place pose
      </p>
      <div className="grid grid-cols-2 gap-2">
        {fieldInput("Place X", "x")}
        {fieldInput("Place Y", "y")}
        {fieldInput("Place rotation", "rotation")}
      </div>
      <p className="mt-4 mb-2 text-[11px] font-medium tracking-wide text-slate-300 uppercase">
        Pick pose
      </p>
      <div className="grid grid-cols-2 gap-2">
        {fieldInput("Pick X", "pickX")}
        {fieldInput("Pick Y", "pickY")}
        {fieldInput("Pick rotation", "pickRotation")}
      </div>
      <p className="mt-4 mb-2 text-[11px] font-medium tracking-wide text-slate-300 uppercase">
        Grip
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          <span>Packages</span>
          <input
            type="number"
            value={selectedGrip?.numPackages ?? ""}
            readOnly
            disabled={!selectedGrip}
            className={`${INPUT_CLASS} cursor-default text-slate-400 disabled:cursor-not-allowed disabled:opacity-45`}
          />
        </label>
        {fieldInput("dx", "dx")}
        {fieldInput("dy", "dy")}
      </div>
      <button
        type="button"
        onClick={onRotate}
        disabled={!selectedGrip}
        className="mt-3 w-full cursor-pointer rounded border border-cyan-500/30 px-3 py-1.5 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Rotate 90°
      </button>
      {message ? (
        <p className="mt-3 text-xs leading-relaxed text-cyan-100" role="status">
          {message}
        </p>
      ) : null}
    </aside>
  );
}
