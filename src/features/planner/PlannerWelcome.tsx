import type { PalletData } from "~/domain/palletTypes";
import { useT } from "~/i18n";
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
  const t = useT();
  return (
    <div className="fable-page fable-welcome">
      <header className="page-intro">
        <h1>{t("planner.welcome.title")}</h1>
      </header>
      <div className="welcome-doors">
        <button className="welcome-door" onClick={onCreate}>
          <div>
            <h2>{t("planner.welcome.createTitle")}</h2>
          </div>
          <PlanRender
            emptyPackage={{ length: 400, width: 300, height: 260 }}
            title={t("planner.welcome.createIllustration")}
          />
          <span className="door-foot">
            <span>{t("planner.welcome.stepByStep")}</span>
            <strong className="primary-label">
              {t("planner.welcome.start")}
            </strong>
          </span>
        </button>
        <button className="welcome-door" onClick={onBrowse}>
          <div>
            <h2>{t("planner.welcome.browseTitle")}</h2>
          </div>
          <div className="welcome-pallets">
            {illustrationStacks.map((data, i) => (
              <PlanRender
                key={i}
                data={data}
                title={t("planner.welcome.stackIllustration")}
              />
            ))}
          </div>
          <span className="door-foot">
            <span>{t("planner.welcome.plansSaved", { count: planCount })}</span>
            <strong>{t("planner.open")}</strong>
          </span>
        </button>
      </div>
      {onResume && (
        <button className="text-action" onClick={onResume}>
          {t("planner.welcome.resume")}
        </button>
      )}
    </div>
  );
}
