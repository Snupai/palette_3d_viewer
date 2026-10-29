import type { RectangleBoundsMm } from "~/domain/geometry";
import type { Box, Rotation } from "~/domain/palletTypes";

export type LayerPatternPreviewItem = {
  id: string;
  centerMm: { x: number; y: number };
  sizeMm: { x: number; y: number };
  rotation: Rotation;
  labelSide: Box["blueLine"];
  groupLabel: string | null;
};

export type LayerPatternPreviewMetadata =
  | {
      source: "pallet-layer";
      sourceId: string;
      layerIndex: number;
      patternRef: string | null;
      candidateId: string | null;
      packageCount: number;
      cycleCount: number | null;
    }
  | {
      source: "solver-candidate";
      sourceId: string;
      rank: number;
      geometryId: string;
      packageCount: number;
      cycleCount: number;
      utilizationPercent: number;
    };

/** Serializable, renderer-neutral layer pattern used by browser previews and reports. */
export type LayerPatternPreview = {
  id: string;
  label: string;
  palletBoundsMm: RectangleBoundsMm;
  effectiveEnvelopeMm?: RectangleBoundsMm;
  generationBoundsMm?: RectangleBoundsMm;
  items: readonly LayerPatternPreviewItem[];
  metadata: LayerPatternPreviewMetadata;
};
