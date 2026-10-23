import type { BoxSelection } from "~/components/rob-viewer/viewerTypes";
import type { PalletData } from "~/lib/palletTypes";

type PalletInfoPanelProps = {
  data: PalletData;
  boxSelection: BoxSelection | null;
};

export function PalletInfoPanel({ data, boxSelection }: PalletInfoPanelProps) {
  return (
    <aside className="border-line bg-surface text-body order-3 w-full border p-4 md:min-w-0 md:flex-1 xl:order-3 xl:w-[260px] xl:shrink-0">
      <h2 className="text-body text-ink mb-3 font-semibold">Pallet Info</h2>
      <div className="text-ink space-y-2">
        <div>
          <span className="text-muted">Layers:</span> {data.layer_count}
        </div>
        <div>
          <span className="text-muted">Total boxes:</span> {data.total_boxes}
        </div>
        <div className="text-ink pt-2 font-medium">Package (LxWxH)</div>
        <div>
          {data.package.width} x {data.package.length} x {data.package.height}
        </div>
        <div className="text-ink pt-2 font-medium">Pallet (LxWxH)</div>
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

      <h2 className="text-body text-ink mt-5 mb-3 font-semibold">
        Selected Box
      </h2>
      {boxSelection ? (
        <div className="text-ink space-y-2">
          <div>
            <span className="text-muted">Place X:</span> {boxSelection.placeX}
          </div>
          <div>
            <span className="text-muted">Place Y:</span> {boxSelection.placeY}
          </div>
          <div>
            <span className="text-muted">Place Z:</span> {boxSelection.placeZ}
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
          <div className="text-micro text-muted pt-1">
            Box center: {boxSelection.rect.x}, {boxSelection.rect.y}
          </div>
        </div>
      ) : (
        <p className="text-micro text-muted">
          Click a box to highlight its grip group and show place coordinates.
        </p>
      )}
    </aside>
  );
}
