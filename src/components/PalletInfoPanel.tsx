import type { BoxSelection } from "~/components/rob-viewer/viewerTypes";
import type { PalletData } from "~/lib/palletTypes";

type PalletInfoPanelProps = {
  data: PalletData;
  boxSelection: BoxSelection | null;
};

export function PalletInfoPanel({ data, boxSelection }: PalletInfoPanelProps) {
  return (
    <aside className="order-3 w-full rounded-md border border-zinc-800 bg-zinc-900 p-4 text-sm md:min-w-0 md:flex-1 xl:order-3 xl:w-[260px] xl:shrink-0">
      <h2 className="mb-3 text-sm font-semibold text-zinc-100">Pallet Info</h2>
      <div className="space-y-2 text-zinc-200">
        <div>
          <span className="text-zinc-500">Layers:</span> {data.layer_count}
        </div>
        <div>
          <span className="text-zinc-500">Total boxes:</span>{" "}
          {data.total_boxes}
        </div>
        <div className="pt-2 font-medium text-zinc-300">Package (LxWxH)</div>
        <div>
          {data.package.width} x {data.package.length} x {data.package.height}
        </div>
        <div className="pt-2 font-medium text-zinc-300">Pallet (LxWxH)</div>
        <div>
          {data.pallet ? (
            <span>
              {data.pallet.width} x {data.pallet.length} x {data.pallet.height}
            </span>
          ) : (
            <span className="text-zinc-600">unknown</span>
          )}
        </div>
      </div>

      <h2 className="mt-5 mb-3 text-sm font-semibold text-zinc-100">
        Selected Box
      </h2>
      {boxSelection ? (
        <div className="space-y-2 text-zinc-200">
          <div>
            <span className="text-zinc-500">Place X:</span>{" "}
            {boxSelection.placeX}
          </div>
          <div>
            <span className="text-zinc-500">Place Y:</span>{" "}
            {boxSelection.placeY}
          </div>
          <div>
            <span className="text-zinc-500">Place Z:</span>{" "}
            {boxSelection.placeZ}
            <span className="text-zinc-600"> (Oberkante, ohne Palette)</span>
          </div>
          <div>
            <span className="text-zinc-500">Grip packages:</span>{" "}
            {boxSelection.numPackages}
            {boxSelection.gripBoxCount !== boxSelection.numPackages
              ? ` (${boxSelection.gripBoxCount} highlighted)`
              : null}
          </div>
          <div>
            <span className="text-zinc-500">Rotation:</span>{" "}
            {boxSelection.rotation}°
          </div>
          <div>
            <span className="text-zinc-500">Layer (from bottom):</span>{" "}
            {boxSelection.layerIndex + 1}
          </div>
          <div>
            <span className="text-zinc-500">Zwischenlage:</span>{" "}
            {boxSelection.zwischenlage
              ? `yes (${boxSelection.zwischenlage})`
              : "no"}
          </div>
          <div>
            <span className="text-zinc-500">Grip #:</span>{" "}
            {boxSelection.blueNumber}
          </div>
          <div className="pt-1 text-xs text-zinc-500">
            Box center: {boxSelection.rect.x}, {boxSelection.rect.y}
          </div>
        </div>
      ) : (
        <p className="text-xs text-zinc-500">
          Click a box to highlight its grip group and show place coordinates.
        </p>
      )}
    </aside>
  );
}
