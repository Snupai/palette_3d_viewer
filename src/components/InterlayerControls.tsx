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
      className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium transition ${
        enabled
          ? "border-amber-400/40 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20"
          : "border-zinc-700 bg-zinc-950 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`}
    >
      <span>{label}</span>
      <span
        className={`font-mono text-[10px] ${
          enabled ? "text-amber-300" : "text-zinc-600"
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
      className="mb-3 rounded-md border border-zinc-800 bg-zinc-950/50 px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <h3
          id="interlayer-controls-title"
          className="text-xs font-medium text-zinc-300"
        >
          Zwischenlagen{" "}
          <span className="font-normal text-zinc-600">(3 mm)</span>
        </h3>
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
