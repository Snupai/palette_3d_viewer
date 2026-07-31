import type { Layer } from "~/lib/robParser";

function InterlayerButton({
  label,
  enabled,
  onClick,
}: {
  label: string;
  enabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={`${label}: Zwischenlage ${enabled ? "yes" : "no"}`}
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-xs font-medium transition ${
        enabled
          ? "border-amber-300/60 bg-amber-400/15 text-amber-100 hover:bg-amber-400/25"
          : "border-slate-600/70 bg-slate-950/40 text-slate-300 hover:border-amber-300/40 hover:text-amber-100"
      }`}
    >
      <span>{label}</span>
      <span
        className={`font-mono text-[10px] uppercase ${
          enabled ? "text-amber-200" : "text-slate-500"
        }`}
      >
        {enabled ? "yes" : "no"}
      </span>
    </button>
  );
}

export function InterlayerControls({
  layers,
  trailingZwischenlage,
  onBaseChange,
  onLayerChange,
}: {
  layers: readonly Layer[];
  trailingZwischenlage: number;
  onBaseChange: (zwischenlage: number) => void;
  onLayerChange: (layerIndex: number, zwischenlage: number) => void;
}) {
  const baseEnabled = (layers[0]?.zwischenlage ?? 0) > 0;

  return (
    <section
      aria-labelledby="interlayer-controls-title"
      className="mb-4 rounded border border-amber-300/20 bg-amber-400/[0.04] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-[160px]">
          <h3
            id="interlayer-controls-title"
            className="text-sm font-semibold text-amber-100"
          >
            Zwischenlagen
          </h3>
          <p className="text-[11px] text-slate-400">
            3 mm on the pallet or selected layer
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <InterlayerButton
            label="Pallet"
            enabled={baseEnabled}
            onClick={() => onBaseChange(baseEnabled ? 0 : 1)}
          />
          {layers.map((_layer, layerIndex) => {
            const enabled =
              layerIndex === layers.length - 1
                ? trailingZwischenlage > 0
                : (layers[layerIndex + 1]?.zwischenlage ?? 0) > 0;
            return (
              <InterlayerButton
                key={layerIndex}
                label={`Layer ${layerIndex + 1}`}
                enabled={enabled}
                onClick={() => onLayerChange(layerIndex, enabled ? 0 : 1)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
