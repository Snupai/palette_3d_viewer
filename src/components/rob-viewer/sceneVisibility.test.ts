import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  applyLayerVisibility,
  visibleLayerCount,
} from "~/components/rob-viewer/sceneVisibility";
import type {
  InterlayerRender,
  LayerLabelRender,
  LayerRender,
} from "~/components/rob-viewer/viewerTypes";

function layerRender(layerNum: number): LayerRender {
  return {
    layerNum,
    solidMesh: new THREE.Mesh(),
    solidEdges: new THREE.LineSegments(),
    pickEntries: [],
  };
}

function interlayerRender(
  layerNum: number,
  isAboveLayer: boolean,
): InterlayerRender {
  const opaqueMaterial = new THREE.MeshBasicMaterial();
  const exposedMaterial = new THREE.MeshBasicMaterial({ transparent: true });
  return {
    layerNum,
    isAboveLayer,
    mesh: new THREE.Mesh(undefined, opaqueMaterial),
    edges: new THREE.LineSegments(),
    opaqueMaterial,
    exposedMaterial,
  };
}

describe("viewer layer visibility", () => {
  it("clamps the cutoff to the existing one-based behavior", () => {
    expect(visibleLayerCount(0, 3)).toBe(1);
    expect(visibleLayerCount(2, 3)).toBe(2);
    expect(visibleLayerCount(9, 3)).toBe(3);
    expect(visibleLayerCount(0, 0)).toBe(1);
  });

  it("hides upper layers and exposes only the top visible interlayer", () => {
    const layers = [layerRender(0), layerRender(1), layerRender(2)];
    const bottom = interlayerRender(0, false);
    const aboveFirst = interlayerRender(0, true);
    const aboveSecond = interlayerRender(1, true);
    const aboveThird = interlayerRender(2, true);
    const labels: LayerLabelRender[] = [0, 1, 2].map((layerNum) => ({
      layerNum,
      object: new THREE.Group(),
    }));

    const maxVisible = applyLayerVisibility({
      layerRenders: layers,
      interlayerRenders: [bottom, aboveFirst, aboveSecond, aboveThird],
      layerLabels: labels,
      visibleUpToLayer: 2,
      layerCount: 3,
    });

    expect(maxVisible).toBe(2);
    expect(layers.map((layer) => layer.solidMesh.visible)).toEqual([
      true,
      true,
      false,
    ]);
    expect(layers.map((layer) => layer.solidEdges.visible)).toEqual([
      true,
      true,
      false,
    ]);
    expect(bottom.mesh.material).toBe(bottom.opaqueMaterial);
    expect(aboveFirst.mesh.material).toBe(aboveFirst.opaqueMaterial);
    expect(aboveSecond.mesh.material).toBe(aboveSecond.exposedMaterial);
    expect(aboveSecond.mesh.renderOrder).toBe(1);
    expect(aboveThird.mesh.visible).toBe(false);
    expect(aboveThird.edges.visible).toBe(false);
    expect(labels.map(({ object }) => object.visible)).toEqual([
      true,
      true,
      false,
    ]);
  });
});
