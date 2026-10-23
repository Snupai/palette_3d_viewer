import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import { layerZBottom } from "~/domain/palletGeometry";
import type { PalletData } from "~/domain/palletTypes";
import { palletLayerToPatternPreview } from "~/lib/previewAdapters";

/** Server-safe, read-only projection of real plan geometry. No demo layouts. */
export function PlanRender({
  data,
  preview,
  packageHeight = 180,
  palletHeight = 144,
  title = "Palettenvorschau",
  className = "",
  emptyPackage,
  palletSize,
}: {
  data?: PalletData | null;
  preview?: LayerPatternPreview | null;
  packageHeight?: number;
  palletHeight?: number;
  title?: string;
  className?: string;
  emptyPackage?: { length: number; width: number; height: number };
  palletSize?: { length: number; width: number };
}) {
  const bounds = preview?.palletBoundsMm;
  const L =
    data?.pallet?.width ??
    (bounds ? bounds.maxX - bounds.minX : (palletSize?.length ?? 1200));
  const W =
    data?.pallet?.length ??
    (bounds ? bounds.maxY - bounds.minY : (palletSize?.width ?? 800));
  const H = data?.pallet?.height ?? palletHeight;
  const ph = data?.package.height ?? emptyPackage?.height ?? packageHeight;
  const layers = data
    ? data.layers.map((_, i) => ({
        preview: palletLayerToPatternPreview(data, i),
        z: H + layerZBottom(data.layers, i, ph),
      }))
    : preview
      ? [{ preview, z: H }]
      : [];
  if (
    !layers.length &&
    emptyPackage &&
    Object.values(emptyPackage).every((v) => Number.isFinite(v) && v > 0)
  ) {
    layers.push({
      z: H,
      preview: {
        id: "package",
        label: "Paket",
        palletBoundsMm: { minX: 0, minY: 0, maxX: L, maxY: W },
        metadata: {
          source: "pallet-layer",
          sourceId: "package",
          layerIndex: 0,
          patternRef: null,
          candidateId: null,
          packageCount: 1,
          cycleCount: null,
        },
        items: [
          {
            id: "package",
            centerMm: { x: L / 2, y: W / 2 },
            sizeMm: { x: emptyPackage.length, y: emptyPackage.width },
            rotation: 0,
            labelSide: null,
            groupLabel: null,
          },
        ],
      },
    });
  }
  const point = (x: number, y: number, z: number) =>
    [(x - y) * 0.866, (x + y) * 0.5 - z] as const;
  const points = (coords: readonly (readonly [number, number, number])[]) =>
    coords.map(([x, y, z]) => point(x, y, z).join(",")).join(" ");
  const cuboid = (
    x: number,
    y: number,
    z: number,
    l: number,
    w: number,
    h: number,
    key: string,
    wood = false,
    rotation = 0,
  ) => {
    const top = z + h;
    return (
      <g key={key} stroke="var(--carton-edge)" strokeWidth={0.8}>
        <polygon
          fill={wood ? "var(--wood-left)" : "var(--carton-left)"}
          points={points([
            [x, y + w, z],
            [x + l, y + w, z],
            [x + l, y + w, top],
            [x, y + w, top],
          ])}
        />
        <polygon
          fill={wood ? "var(--wood-right)" : "var(--carton-right)"}
          points={points([
            [x + l, y, z],
            [x + l, y + w, z],
            [x + l, y + w, top],
            [x + l, y, top],
          ])}
        />
        <polygon
          fill={wood ? "var(--wood-top)" : "var(--carton-top)"}
          points={points([
            [x, y, top],
            [x + l, y, top],
            [x + l, y + w, top],
            [x, y + w, top],
          ])}
        />
        {!wood && (
          <polygon
            stroke="none"
            fill="var(--carton-tape)"
            points={
              rotation === 90 || rotation === 270
                ? points([
                    [x + l * 0.44, y, top + 0.5],
                    [x + l * 0.56, y, top + 0.5],
                    [x + l * 0.56, y + w, top + 0.5],
                    [x + l * 0.44, y + w, top + 0.5],
                  ])
                : points([
                    [x, y + w * 0.44, top + 0.5],
                    [x + l, y + w * 0.44, top + 0.5],
                    [x + l, y + w * 0.56, top + 0.5],
                    [x, y + w * 0.56, top + 0.5],
                  ])
            }
          />
        )}
      </g>
    );
  };
  const corners = [
    [0, 0, 0],
    [L, 0, 0],
    [L, W, 0],
    [0, W, 0],
  ] as const;
  const topZ = layers.length ? layers[layers.length - 1]!.z + ph : H;
  const cloud = [
    ...corners.map(([x, y, z]) => point(x, y, z)),
    ...layers.flatMap((layer) =>
      layer.preview.items.flatMap((i) => [
        point(
          i.centerMm.x - i.sizeMm.x / 2,
          i.centerMm.y - i.sizeMm.y / 2,
          layer.z + ph,
        ),
        point(
          i.centerMm.x + i.sizeMm.x / 2,
          i.centerMm.y + i.sizeMm.y / 2,
          layer.z + ph,
        ),
      ]),
    ),
    point(0, 0, topZ),
  ];
  const minX = Math.min(...cloud.map((p) => p[0])) - 70,
    maxX = Math.max(...cloud.map((p) => p[0])) + 70,
    minY = Math.min(...cloud.map((p) => p[1])) - 65,
    maxY = Math.max(...cloud.map((p) => p[1])) + 45;
  return (
    <svg
      className={`plan-render ${className}`}
      role="img"
      aria-label={title}
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
    >
      <title>{title}</title>
      <polygon
        points={points([
          [0, 0, -14],
          [L + 50, 0, -14],
          [L + 50, W + 50, -14],
          [0, W + 50, -14],
        ])}
        fill="var(--ink)"
        opacity=".06"
      />
      {[0.08, 0.46, 0.84].map((f, i) =>
        cuboid(0, W * f, 0, L, W * 0.09, H * 0.7, `foot-${i}`, true),
      )}
      {[0, 1, 2, 3, 4].map((i) =>
        cuboid(
          0,
          (i * W) / 5,
          H * 0.7,
          L,
          W / 5 - 12,
          H * 0.3,
          `slat-${i}`,
          true,
        ),
      )}
      {layers.map((layer, li) => (
        <g key={li}>
          {[...layer.preview.items]
            .sort(
              (a, b) =>
                a.centerMm.x + a.centerMm.y - (b.centerMm.x + b.centerMm.y) ||
                a.centerMm.x - b.centerMm.x,
            )
            .map((item) =>
              cuboid(
                item.centerMm.x - item.sizeMm.x / 2,
                item.centerMm.y - item.sizeMm.y / 2,
                layer.z,
                item.sizeMm.x - 1,
                item.sizeMm.y - 1,
                ph,
                item.id,
                false,
                item.rotation,
              ),
            )}
        </g>
      ))}
    </svg>
  );
}
