"use client";

import { useEffect, useState } from "react";
import { LayerSlider } from "~/components/LayerSlider";
import { RobViewer } from "~/components/RobViewer";
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
  const [visibleUpToLayer, setVisibleUpToLayer] = useState(data.layer_count);

  useEffect(() => {
    setVisibleUpToLayer(data.layer_count);
  }, [data, resetKey]);

  return (
    <section
      aria-label="Finished pallet in 3D"
      className="border-line bg-surface flex h-full min-h-[420px] min-w-0 items-stretch gap-1 border"
    >
      <div className="bg-viewport relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <RobViewer
          data={data}
          cameraResetKey={resetKey}
          visibleUpToLayer={visibleUpToLayer}
          showSceneControls
          onBoxSelect={(selection) => {
            if (selection) setVisibleUpToLayer(selection.layerIndex + 1);
          }}
        />
      </div>
      <LayerSlider
        layerCount={data.layer_count}
        value={visibleUpToLayer}
        onChange={setVisibleUpToLayer}
      />
    </section>
  );
}
