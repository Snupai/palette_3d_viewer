import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildViewerScene } from "~/components/rob-viewer/sceneBuilder";
import type { Box, PalletData } from "~/domain/palletTypes";

function box(
  blueNumber: number,
  x: number,
  y: number,
  rotation: Box["rotation"] = 0,
): Box {
  return {
    blueNumber,
    blueLine: null,
    rotation,
    rect: { width: 200, length: 300, x, y },
    height: 100,
    placeX: x,
    placeY: y,
    numPackages: 1,
  };
}

function palletData(): PalletData {
  return {
    layers: [
      {
        unique_layer_id: 1,
        zwischenlage: 1,
        boxes: [box(1, 200, 200), box(1, 500, 200)],
      },
      {
        unique_layer_id: 2,
        zwischenlage: 0,
        boxes: [box(2, 300, 300, 90)],
      },
    ],
    uniqueLayers: {},
    layer_count: 2,
    total_boxes: 3,
    package: { width: 200, length: 300, height: 100 },
    pallet: { width: 1200, length: 800, height: 144 },
    inputDirection: 0,
    trailingZwischenlage: 1,
  };
}

describe("viewer scene builder", () => {
  it("builds combined layer geometry with stable pick ranges and Z values", () => {
    const scene = new THREE.Scene();
    const built = buildViewerScene(scene, palletData());

    expect(scene.children).toContain(built.root);
    expect(built.layerRenders).toHaveLength(2);
    expect(built.pickEntries).toHaveLength(3);
    expect(built.interlayerRenders).toHaveLength(2);
    expect(built.bounds?.isEmpty()).toBe(false);

    expect(built.pickEntries.map((entry) => entry.firstFace)).toEqual([
      0, 12, 0,
    ]);
    expect(built.pickEntries.map((entry) => entry.faceCount)).toEqual([
      12, 12, 12,
    ]);
    expect(built.pickEntries.map((entry) => entry.zBottom)).toEqual([
      3, 3, 103,
    ]);
    expect(built.pickEntries.map((entry) => entry.placeZ)).toEqual([
      103, 103, 203,
    ]);

    const bottomGeometry = built.layerRenders[0]!.solidMesh.geometry;
    expect(bottomGeometry.index?.count).toBe(72);
    expect(bottomGeometry.getAttribute("color").count).toBe(48);

    expect(built.interlayerRenders[0]).toMatchObject({
      layerNum: 0,
      isAboveLayer: false,
    });
    expect(built.interlayerRenders[1]).toMatchObject({
      layerNum: 1,
      isAboveLayer: true,
    });

    built.dispose();
  });

  it("removes its root and disposes shared scene resources idempotently", () => {
    const scene = new THREE.Scene();
    const built = buildViewerScene(scene, palletData());
    const geometry = built.layerRenders[0]!.solidMesh.geometry;
    const material = built.layerRenders[0]!.solidMesh
      .material as THREE.Material;
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");

    built.dispose();
    built.dispose();

    expect(scene.children).not.toContain(built.root);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });
});
