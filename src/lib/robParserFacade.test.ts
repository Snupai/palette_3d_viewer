import { describe, expect, expectTypeOf, it } from "vitest";
import { insertMergedGripByDeltaDependencies as domainInsertMergedGrip } from "~/domain/gripDependencies";
import {
  applyBaseInterlayerEdit as domainApplyBaseInterlayerEdit,
  applyGripEdit as domainApplyGripEdit,
  applyInterlayerAfterLayerEdit as domainApplyInterlayerAfterLayerEdit,
  mergeGrips as domainMergeGrips,
  splitGrip as domainSplitGrip,
} from "~/domain/palletEdits";
import {
  findGripCollision as domainFindGripCollision,
  footprintSize as domainFootprintSize,
  gripsToBoxes as domainGripsToBoxes,
  layerPlaceZ as domainLayerPlaceZ,
  layerZBottom as domainLayerZBottom,
  parseBlueLine as domainParseBlueLine,
  pickOffsetForCount as domainPickOffsetForCount,
  toRobInt as domainToRobInt,
} from "~/domain/palletGeometry";
import type {
  Box as DomainBox,
  Corner as DomainCorner,
  Grip as DomainGrip,
  GripCollision as DomainGripCollision,
  Layer as DomainLayer,
  PalletData as DomainPalletData,
  Rectangle as DomainRectangle,
  Rotation as DomainRotation,
  Side as DomainSide,
} from "~/domain/palletTypes";
import { ZWISCHENLAGE_HEIGHT_MM as domainInterlayerHeight } from "~/domain/palletTypes";
import {
  ZWISCHENLAGE_HEIGHT_MM,
  applyBaseInterlayerEdit,
  applyGripEdit,
  applyInterlayerAfterLayerEdit,
  findGripCollision,
  footprintSize,
  gripsToBoxes,
  insertMergedGripByDeltaDependencies,
  layerPlaceZ,
  layerZBottom,
  mergeGrips,
  parseBlueLine,
  pickOffsetForCount,
  splitGrip,
  toRobInt,
  type Box,
  type Corner,
  type Grip,
  type GripCollision,
  type Layer,
  type PalletData,
  type Rectangle,
  type Rotation,
  type Side,
} from "~/lib/robParser";

describe("robParser compatibility facade", () => {
  it("re-exports the prior runtime domain API", () => {
    expect(ZWISCHENLAGE_HEIGHT_MM).toBe(domainInterlayerHeight);
    expect(findGripCollision).toBe(domainFindGripCollision);
    expect(footprintSize).toBe(domainFootprintSize);
    expect(gripsToBoxes).toBe(domainGripsToBoxes);
    expect(layerPlaceZ).toBe(domainLayerPlaceZ);
    expect(layerZBottom).toBe(domainLayerZBottom);
    expect(parseBlueLine).toBe(domainParseBlueLine);
    expect(pickOffsetForCount).toBe(domainPickOffsetForCount);
    expect(toRobInt).toBe(domainToRobInt);
    expect(insertMergedGripByDeltaDependencies).toBe(domainInsertMergedGrip);
    expect(applyBaseInterlayerEdit).toBe(domainApplyBaseInterlayerEdit);
    expect(applyGripEdit).toBe(domainApplyGripEdit);
    expect(applyInterlayerAfterLayerEdit).toBe(
      domainApplyInterlayerAfterLayerEdit,
    );
    expect(mergeGrips).toBe(domainMergeGrips);
    expect(splitGrip).toBe(domainSplitGrip);
  });

  it("re-exports the prior domain types", () => {
    expectTypeOf<Box>().toEqualTypeOf<DomainBox>();
    expectTypeOf<Corner>().toEqualTypeOf<DomainCorner>();
    expectTypeOf<Grip>().toEqualTypeOf<DomainGrip>();
    expectTypeOf<GripCollision>().toEqualTypeOf<DomainGripCollision>();
    expectTypeOf<Layer>().toEqualTypeOf<DomainLayer>();
    expectTypeOf<PalletData>().toEqualTypeOf<DomainPalletData>();
    expectTypeOf<Rectangle>().toEqualTypeOf<DomainRectangle>();
    expectTypeOf<Rotation>().toEqualTypeOf<DomainRotation>();
    expectTypeOf<Side>().toEqualTypeOf<DomainSide>();
  });
});
