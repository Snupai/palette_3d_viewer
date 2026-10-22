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
      className={`flex items-center gap-2 border px-2.5 py-1 text-xs font-medium transition ${
        enabled
          ? "border-brand/40 bg-brand/10 text-brand hover:bg-brand/20"
          : "border-line bg-canvas text-muted hover:bg-surface-hover hover:text-ink"
      }`}
    >
      <span>{label}</span>
      <span
        className={`font-mono text-micro ${
          enabled ? "text-brand" : "text-muted"
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
      className="mb-3 border border-line bg-canvas px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <h3
          id="interlayer-controls-title"
          className="text-xs font-medium text-ink"
        >
          Zwischenlagen{" "}
          <span className="font-normal text-muted">(3 mm)</span>
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
