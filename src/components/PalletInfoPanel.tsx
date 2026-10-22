import type { BoxSelection } from "~/components/rob-viewer/viewerTypes";
import type { PalletData } from "~/lib/palletTypes";

type PalletInfoPanelProps = {
  data: PalletData;
  boxSelection: BoxSelection | null;
};

export function PalletInfoPanel({ data, boxSelection }: PalletInfoPanelProps) {
  return (
    <aside className="order-3 w-full border border-line bg-surface p-4 text-sm md:min-w-0 md:flex-1 xl:order-3 xl:w-[260px] xl:shrink-0">
      <h2 className="mb-3 text-body font-semibold text-ink">Pallet Info</h2>
      <div className="space-y-2 text-ink">
        <div>
          <span className="text-muted">Layers:</span> {data.layer_count}
        </div>
        <div>
          <span className="text-muted">Total boxes:</span> {data.total_boxes}
        </div>
        <div className="pt-2 font-medium text-ink">Package (LxWxH)</div>
        <div>
          {data.package.width} x {data.package.length} x {data.package.height}
        </div>
        <div className="pt-2 font-medium text-ink">Pallet (LxWxH)</div>
        <div>
          {data.pallet ? (
            <span>
              {data.pallet.width} x {data.pallet.length} x {data.pallet.height}
            </span>
          ) : (
            <span className="text-muted">unknown</span>
          )}
        </div>
      </div>

      <h2 className="mt-5 mb-3 text-body font-semibold text-ink">
        Selected Box
      </h2>
      {boxSelection ? (
        <div className="space-y-2 text-ink">
          <div>
            <span className="text-muted">Place X:</span>{" "}
            {boxSelection.placeX}
          </div>
          <div>
            <span className="text-muted">Place Y:</span>{" "}
            {boxSelection.placeY}
          </div>
          <div>
            <span className="text-muted">Place Z:</span>{" "}
            {boxSelection.placeZ}
            <span className="text-muted"> (Oberkante, ohne Palette)</span>
          </div>
          <div>
            <span className="text-muted">Grip packages:</span>{" "}
            {boxSelection.numPackages}
            {boxSelection.gripBoxCount !== boxSelection.numPackages
              ? ` (${boxSelection.gripBoxCount} highlighted)`
              : null}
          </div>
          <div>
            <span className="text-muted">Rotation:</span>{" "}
            {boxSelection.rotation}°
          </div>
          <div>
            <span className="text-muted">Layer (from bottom):</span>{" "}
            {boxSelection.layerIndex + 1}
          </div>
          <div>
            <span className="text-muted">Zwischenlage:</span>{" "}
            {boxSelection.zwischenlage
              ? `yes (${boxSelection.zwischenlage})`
              : "no"}
          </div>
          <div>
            <span className="text-muted">Grip #:</span>{" "}
            {boxSelection.blueNumber}
          </div>
          <div className="pt-1 text-xs text-muted">
            Box center: {boxSelection.rect.x}, {boxSelection.rect.y}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted">
          Click a box to highlight its grip group and show place coordinates.
        </p>
      )}
    </aside>
  );
}
