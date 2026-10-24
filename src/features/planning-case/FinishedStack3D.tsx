"use client";

import { useEffect, useState } from "react";
import { LayerSlider } from "~/components/LayerSlider";
import { RobViewer, type BoxSelection } from "~/components/RobViewer";
import type { PalletData } from "~/domain/palletTypes";

/**
 * 3D view of the saved stack, shown on the finished Stack step like the
 * legacy .rob viewer: orbitable pallet plus the layer rail. Clicking a
 * package shows layers up to and including that package's layer.
 */
export function FinishedStack3D({
  data,
  resetKey,
}: {
  data: PalletData;
  resetKey: string;
}) {
  const [selection, setSelection] = useState<BoxSelection | null>(null);
  const [visibleUpToLayer, setVisibleUpToLayer] = useState(data.layer_count);

  useEffect(() => {
    setVisibleUpToLayer(data.layer_count);
    setSelection(null);
  }, [data, resetKey]);

  return (
    <section
      aria-label="Finished pallet in 3D"
      className="border-line bg-surface flex h-full min-h-[420px] min-w-0 items-stretch gap-1 border"
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="bg-viewport relative min-h-0 flex-1">
          <RobViewer
            data={data}
            cameraResetKey={resetKey}
            visibleUpToLayer={visibleUpToLayer}
            showSceneControls
            onBoxSelect={(selection) => {
              setSelection(selection);
              if (selection) setVisibleUpToLayer(selection.layerIndex + 1);
            }}
          />
        </div>
        <div className="viewer-pick-info" aria-live="polite">
          {selection ? (
            <>
              <strong>
                Lage {selection.layerIndex + 1} · Griff {selection.blueNumber}
              </strong>
              <span>{selection.numPackages} Pakete</span>
              <span>
                Ablage X {selection.placeX} / Y {selection.placeY} / Z{" "}
                {selection.placeZ} mm
              </span>
              <span>{selection.rotation}°</span>
            </>
          ) : (
            <span>
              Paket auswählen, um Griff und Ablagekoordinaten zu prüfen.
            </span>
          )}
        </div>
      </div>
      <LayerSlider
        layerCount={data.layer_count}
        value={visibleUpToLayer}
        onChange={setVisibleUpToLayer}
      />
    </section>
  );
}
