import type { RobotObstacle } from "~/domain/robotics";
import { useT } from "~/i18n";

export function ObstacleEditor({
  obstacles,
  onChange,
}: {
  obstacles: readonly RobotObstacle[];
  onChange: (obstacles: readonly RobotObstacle[]) => void;
}) {
  const t = useT();
  const update = (index: number, obstacle: RobotObstacle) =>
    onChange(
      obstacles.map((current, itemIndex) =>
        itemIndex === index ? obstacle : current,
      ),
    );

  return (
    <>
      <div className="ed-actions">
        <button
          type="button"
          onClick={() =>
            onChange([
              ...obstacles,
              {
                id: `obstacle-${obstacles.length + 1}`,
                name: t("robotics.obstacleDefaultName", {
                  number: obstacles.length + 1,
                }),
                boundsMm: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
                minZMm: 0,
                maxZMm: 1_000,
              },
            ])
          }
          className="ui-btn ui-btn-sm"
        >
          {t("robotics.addObstacle")}
        </button>
      </div>
      {obstacles.length === 0 ? (
        <p className="ed-panel-note">{t("robotics.obstacleNone")}</p>
      ) : (
        obstacles.map((obstacle, index) => (
          <div key={`${obstacle.id}-${index}`} className="ed-panel">
            <div className="ed-actions">
              <input
                aria-label={t("robotics.obstacleNameOf", { number: index + 1 })}
                value={obstacle.name ?? ""}
                onChange={(event) =>
                  update(index, { ...obstacle, name: event.target.value })
                }
                className="ui-input"
                style={{ flex: "1 1 160px" }}
              />
              <button
                type="button"
                onClick={() =>
                  onChange(
                    obstacles.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                className="ui-btn ui-btn-sm ui-btn-danger"
              >
                {t("robotics.remove")}
              </button>
            </div>
            <div className="ed-grid3">
              {(
                [
                  [t("robotics.minX"), "minX"],
                  [t("robotics.minY"), "minY"],
                  [t("robotics.maxX"), "maxX"],
                  [t("robotics.maxY"), "maxY"],
                ] as const
              ).map(([label, field]) => (
                <label key={field} className="ed-field">
                  {label}
                  <input
                    type="number"
                    step="any"
                    value={obstacle.boundsMm[field]}
                    onChange={(event) =>
                      update(index, {
                        ...obstacle,
                        boundsMm: {
                          ...obstacle.boundsMm,
                          [field]: Number(event.target.value),
                        },
                      })
                    }
                    className="ui-input"
                  />
                </label>
              ))}
              {(
                [
                  [t("robotics.minZ"), "minZMm"],
                  [t("robotics.maxZ"), "maxZMm"],
                ] as const
              ).map(([label, field]) => (
                <label key={field} className="ed-field">
                  {label}
                  <input
                    type="number"
                    step="any"
                    value={obstacle[field] ?? ""}
                    onChange={(event) =>
                      update(index, {
                        ...obstacle,
                        [field]:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                    className="ui-input"
                  />
                </label>
              ))}
            </div>
          </div>
        ))
      )}
    </>
  );
}
