import type { RobotObstacle } from "~/domain/robotics";
import {
  buttonClass,
  dangerButtonClass,
  fieldLabelClass,
  inputClass,
} from "~/features/robotics/roboticsStyles";

export function ObstacleEditor({
  obstacles,
  onChange,
}: {
  obstacles: readonly RobotObstacle[];
  onChange: (obstacles: readonly RobotObstacle[]) => void;
}) {
  const update = (index: number, obstacle: RobotObstacle) =>
    onChange(
      obstacles.map((current, itemIndex) =>
        itemIndex === index ? obstacle : current,
      ),
    );

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted text-xs leading-5">
          Add measured fixed objects in the station coordinate system. Without
          them, collision against individual station objects is not checked.
        </p>
        <button
          type="button"
          onClick={() =>
            onChange([
              ...obstacles,
              {
                id: `obstacle-${obstacles.length + 1}`,
                name: `Obstacle ${obstacles.length + 1}`,
                boundsMm: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
                minZMm: 0,
                maxZMm: 1_000,
              },
            ])
          }
          className={`${buttonClass} shrink-0`}
        >
          Add obstacle
        </button>
      </div>
      {obstacles.length === 0 ? (
        <p className="border-line text-muted border border-dashed px-3 py-2 text-xs leading-5">
          No fixed obstacles are modeled. Collision against individual station
          objects has not been checked.
        </p>
      ) : (
        obstacles.map((obstacle, index) => (
          <div
            key={`${obstacle.id}-${index}`}
            className="border-line bg-canvas grid gap-2 border p-2"
          >
            <div className="flex items-center gap-2">
              <input
                aria-label={`Obstacle ${index + 1} name`}
                value={obstacle.name ?? ""}
                onChange={(event) =>
                  update(index, { ...obstacle, name: event.target.value })
                }
                className={`${inputClass} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() =>
                  onChange(
                    obstacles.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                className={dangerButtonClass}
              >
                Remove
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
              {(
                [
                  ["Min X", "minX"],
                  ["Min Y", "minY"],
                  ["Max X", "maxX"],
                  ["Max Y", "maxY"],
                ] as const
              ).map(([label, field]) => (
                <label key={field} className={fieldLabelClass}>
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
                    className={`${inputClass} font-mono`}
                  />
                </label>
              ))}
              {(
                [
                  ["Min Z", "minZMm"],
                  ["Max Z", "maxZMm"],
                ] as const
              ).map(([label, field]) => (
                <label key={field} className={fieldLabelClass}>
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
                    className={`${inputClass} font-mono`}
                  />
                </label>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
