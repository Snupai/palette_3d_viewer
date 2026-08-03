import type { BoxSelection } from "~/components/RobViewer";
import type { PalletData } from "~/lib/palletTypes";

type PalletInfoPanelProps = {
  data: PalletData;
  boxSelection: BoxSelection | null;
};

export function PalletInfoPanel({ data, boxSelection }: PalletInfoPanelProps) {
  return (
    <aside className="order-3 w-full rounded border border-cyan-500/10 bg-slate-900/70 p-4 text-sm shadow-lg shadow-cyan-500/10 backdrop-blur xl:order-3 xl:w-[260px] xl:shrink-0">
      <h2 className="mb-3 text-base font-semibold text-cyan-200">
        Pallet Info
      </h2>
      <div className="space-y-2 text-slate-100">
        <div>
          <span className="text-slate-400">Layers:</span> {data.layer_count}
        </div>
        <div>
          <span className="text-slate-400">Total boxes:</span>{" "}
          {data.total_boxes}
        </div>
        <div className="pt-2 font-medium text-slate-200">Package (LxWxH)</div>
        <div>
          {data.package.width} x {data.package.length} x {data.package.height}
        </div>
        <div className="pt-2 font-medium text-slate-200">Pallet (LxWxH)</div>
        <div>
          {data.pallet ? (
            <span>
              {data.pallet.width} x {data.pallet.length} x {data.pallet.height}
            </span>
          ) : (
            <span className="text-slate-500">unknown</span>
          )}
        </div>
      </div>

      <h2 className="mt-5 mb-3 text-base font-semibold text-cyan-200">
        Selected Box
      </h2>
      {boxSelection ? (
        <div className="space-y-2 text-slate-100">
          <div>
            <span className="text-slate-400">Place X:</span>{" "}
            {boxSelection.placeX}
          </div>
          <div>
            <span className="text-slate-400">Place Y:</span>{" "}
            {boxSelection.placeY}
          </div>
          <div>
            <span className="text-slate-400">Place Z:</span>{" "}
            {boxSelection.placeZ}
            <span className="text-slate-500"> (Oberkante, ohne Palette)</span>
          </div>
          <div>
            <span className="text-slate-400">Grip packages:</span>{" "}
            {boxSelection.numPackages}
            {boxSelection.gripBoxCount !== boxSelection.numPackages
              ? ` (${boxSelection.gripBoxCount} highlighted)`
              : null}
          </div>
          <div>
            <span className="text-slate-400">Rotation:</span>{" "}
            {boxSelection.rotation}°
          </div>
          <div>
            <span className="text-slate-400">Layer (from bottom):</span>{" "}
            {boxSelection.layerIndex + 1}
          </div>
          <div>
            <span className="text-slate-400">Zwischenlage:</span>{" "}
            {boxSelection.zwischenlage
              ? `yes (${boxSelection.zwischenlage})`
              : "no"}
          </div>
          <div>
            <span className="text-slate-400">Grip #:</span>{" "}
            {boxSelection.blueNumber}
          </div>
          <div className="pt-1 text-xs text-slate-400">
            Box center: {boxSelection.rect.x}, {boxSelection.rect.y}
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          Click a box to highlight its grip group and show place coordinates.
        </p>
      )}
    </aside>
  );
}
