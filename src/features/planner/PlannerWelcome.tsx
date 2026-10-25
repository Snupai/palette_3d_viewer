import type { PalletData } from "~/domain/palletTypes";
import { PlanRender } from "./PlanRender";

/** Entry illustration only; saved-plan thumbnails always use repository data. */
function illustration(layerCount: number): PalletData {
  return {
    pallet: { width: 1200, length: 800, height: 144 },
    package: { width: 400, length: 400, height: 170 },
    inputDirection: 0,
    uniqueLayers: {},
    layer_count: layerCount,
    total_boxes: layerCount * 6,
    layers: Array.from({ length: layerCount }, (_, _i) => ({
      unique_layer_id: 1,
      zwischenlage: 0,
      boxes: Array.from({ length: 6 }, (_, j) => ({
        blueNumber: j + 1,
        blueLine: null,
        rotation: 0 as const,
        height: 170,
        placeX: (j % 3) * 400 + 200,
        placeY: Math.floor(j / 3) * 400 + 200,
        numPackages: 1,
        rect: {
          x: (j % 3) * 400 + 200,
          y: Math.floor(j / 3) * 400 + 200,
          width: 400,
          length: 400,
        },
      })),
    })),
  };
}
const illustrationStacks = [illustration(4), illustration(7), illustration(5)];

export function PlannerWelcome({
  onCreate,
  onBrowse,
  onResume,
  planCount,
}: {
  onCreate: () => void;
  onBrowse: () => void;
  onResume?: () => void;
  planCount: number;
}) {
  return (
    <div className="fable-page fable-welcome">
      <header className="page-intro">
        <h1>Womit möchten Sie beginnen?</h1>
      </header>
      <div className="welcome-doors">
        <button className="welcome-door" onClick={onCreate}>
          <div>
            <h2>Neuen Plan erstellen</h2>
          </div>
          <PlanRender
            emptyPackage={{ length: 400, width: 300, height: 260 }}
            title="Ein Paket auf einer leeren Palette"
          />
          <span className="door-foot">
            <span>Schritt für Schritt zum Plan</span>
            <strong className="primary-label">＋ Starten</strong>
          </span>
        </button>
        <button className="welcome-door" onClick={onBrowse}>
          <div>
            <h2>Vorhandene Pläne ansehen</h2>
          </div>
          <div className="welcome-pallets">
            {illustrationStacks.map((data, i) => (
              <PlanRender
                key={i}
                data={data}
                title="Illustration eines Palettenstapels"
              />
            ))}
          </div>
          <span className="door-foot">
            <span>
              {planCount} {planCount === 1 ? "Plan" : "Pläne"} lokal gespeichert
            </span>
            <strong>Öffnen</strong>
          </span>
        </button>
      </div>
      {onResume && (
        <button className="text-action" onClick={onResume}>
          Zum geöffneten Plan zurück
        </button>
      )}
    </div>
  );
}
