// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LayerPattern } from "~/components/LayerPattern";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";

const preview: LayerPatternPreview = {
  id: "report-pattern",
  label: "Report pattern",
  palletBoundsMm: { minX: 0, minY: 0, maxX: 1200, maxY: 800 },
  items: [
    {
      id: "package-1",
      centerMm: { x: 300, y: 200 },
      sizeMm: { x: 300, y: 200 },
      rotation: 0,
      labelSide: null,
      groupLabel: null,
    },
  ],
  metadata: {
    source: "pallet-layer",
    sourceId: "layer-1",
    layerIndex: 0,
    patternRef: "pattern-1",
    candidateId: null,
    packageCount: 1,
    cycleCount: 1,
  },
};

describe("LayerPattern SSR", () => {
  it("renders report SVG markup without document, canvas, or WebGL", () => {
    const markup = renderToStaticMarkup(
      <LayerPattern preview={preview} showGrid={false} />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain('data-layer-pattern-id="report-pattern"');
    expect(markup).toContain('data-pattern-item="package-1"');
  });
});
