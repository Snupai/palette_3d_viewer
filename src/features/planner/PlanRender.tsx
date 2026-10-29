import { useT } from "~/i18n";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import {
  layerZBottom,
  layerInterlayerHeightMm,
  trailingInterlayerHeightMm,
} from "~/domain/palletGeometry";
import type { PalletData } from "~/domain/palletTypes";
import { palletLayerToPatternPreview } from "~/lib/previewAdapters";

/** Server-safe, read-only projection of real plan geometry. No demo layouts. */
export function PlanRender({
  data,
  preview,
  packageHeight = 180,
  palletHeight = 144,
  title,
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
  const t = useT();
  const planTitle = title ?? t("planner.render.defaultTitle");
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
        label: t("planner.render.packageLabel"),
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
  const sheets: { z: number; height: number; length: number; width: number }[] =
    [];
  const appendSheets = (
    z: number,
    height: number,
    exact: number[] | undefined,
    dimensions: { width: number; length: number } | undefined,
  ) => {
    const footprint = dimensions ?? data?.interlayer ?? { width: L, length: W };
    const thicknesses =
      exact?.length && exact.every((h) => Number.isFinite(h) && h >= 0)
        ? exact
        : height > 0
          ? [height]
          : [];
    for (const thickness of thicknesses) {
      if (thickness > 0)
        sheets.push({
          z,
          height: thickness,
          length: footprint.width,
          width: footprint.length,
        });
      z += thickness;
    }
  };
  if (data) {
    data.layers.forEach((layer, index) => {
      const height = layerInterlayerHeightMm(layer);
      appendSheets(
        layers[index]!.z - height,
        height,
        layer.interlayerThicknessesMm,
        layer.interlayerDimensions,
      );
    });
    appendSheets(
      layers.length ? layers[layers.length - 1]!.z + ph : H,
      trailingInterlayerHeightMm(data),
      data.trailingInterlayerThicknessesMm,
      data.trailingInterlayerDimensions,
    );
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
    sheet = false,
  ) => {
    const top = z + h;
    return (
      <g
        key={key}
        data-sheet-z={sheet ? z : undefined}
        data-sheet-thickness={sheet ? h : undefined}
        stroke="var(--carton-edge)"
        strokeWidth={0.8}
      >
        <polygon
          fill={
            sheet
              ? "var(--wood-left)"
              : wood
                ? "var(--wood-left)"
                : "var(--carton-left)"
          }
          points={points([
            [x, y + w, z],
            [x + l, y + w, z],
            [x + l, y + w, top],
            [x, y + w, top],
          ])}
        />
        <polygon
          fill={
            sheet
              ? "var(--wood-right)"
              : wood
                ? "var(--wood-right)"
                : "var(--carton-right)"
          }
          points={points([
            [x + l, y, z],
            [x + l, y + w, z],
            [x + l, y + w, top],
            [x + l, y, top],
          ])}
        />
        <polygon
          fill={
            sheet
              ? "var(--wood-top)"
              : wood
                ? "var(--wood-top)"
                : "var(--carton-top)"
          }
          points={points([
            [x, y, top],
            [x + l, y, top],
            [x + l, y + w, top],
            [x, y + w, top],
          ])}
        />
        {!wood && !sheet && (
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
      // All four corners: the isometric projection puts the horizontal
      // extremes on the off-diagonal corners.
      layer.preview.items.flatMap((i) => {
        const x0 = i.centerMm.x - i.sizeMm.x / 2;
        const x1 = i.centerMm.x + i.sizeMm.x / 2;
        const y0 = i.centerMm.y - i.sizeMm.y / 2;
        const y1 = i.centerMm.y + i.sizeMm.y / 2;
        const z = layer.z + ph;
        return [
          point(x0, y0, z),
          point(x1, y0, z),
          point(x0, y1, z),
          point(x1, y1, z),
        ];
      }),
    ),
    ...sheets.flatMap((sheet) =>
      [sheet.z, sheet.z + sheet.height].flatMap((z) => [
        point((L - sheet.length) / 2, (W - sheet.width) / 2, z),
        point((L + sheet.length) / 2, (W - sheet.width) / 2, z),
        point((L - sheet.length) / 2, (W + sheet.width) / 2, z),
        point((L + sheet.length) / 2, (W + sheet.width) / 2, z),
      ]),
    ),
    point(0, 0, topZ),
  ];
  // Iterative bounds: spreading the cloud into Math.min/max overflows the
  // engine's argument limit on large stacks.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y] of cloud) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  minX -= 70;
  maxX += 70;
  minY -= 65;
  maxY += 45;
  return (
    <svg
      className={`plan-render ${className}`}
      role="img"
      aria-label={planTitle}
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
    >
      <title>{planTitle}</title>
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
      {[
        ...sheets.map((sheet, index) => ({
          z: sheet.z,
          node: cuboid(
            (L - sheet.length) / 2,
            (W - sheet.width) / 2,
            sheet.z,
            sheet.length,
            sheet.width,
            sheet.height,
            `sheet-${index}`,
            false,
            0,
            true,
          ),
        })),
        ...layers.map((layer, li) => ({
          z: layer.z,
          node: (
            <g key={li}>
              {[...layer.preview.items]
                .sort(
                  (a, b) =>
                    a.centerMm.x +
                      a.centerMm.y -
                      (b.centerMm.x + b.centerMm.y) ||
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
          ),
        })),
      ]
        .sort((a, b) => a.z - b.z)
        .map(({ node }) => node)}
    </svg>
  );
}
