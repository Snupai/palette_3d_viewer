import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createViewerHighlighter } from "~/components/rob-viewer/sceneHighlight";
import type { BoxPickEntry } from "~/components/rob-viewer/viewerTypes";

function entry(overrides: Partial<BoxPickEntry> = {}): BoxPickEntry {
  return {
    layerIndex: 0,
    boxIndex: 0,
    blueNumber: 5,
    placeX: 400,
    placeY: 300,
    zBottom: 3,
    placeZ: 153,
    numPackages: 1,
    rotation: 90,
    rect: { width: 200, length: 300, x: 400, y: 300 },
    height: 150,
    layerNum: 0,
    zwischenlage: 1,
    firstFace: 0,
    faceCount: 12,
    ...overrides,
  };
}

describe("viewer highlighting", () => {
  it("releases temporary geometry on clear but keeps shared materials until dispose", () => {
    const scene = new THREE.Scene();
    const highlighter = createViewerHighlighter({
      scene,
      packageLength: 300,
    });
    const selected = entry();
    const second = entry({ boxIndex: 1, rect: { ...selected.rect, x: 600 } });

    highlighter.show(selected, [selected, second], 1);
    expect(highlighter.highlightGroup.children).toHaveLength(6);

    const overlay = highlighter.highlightGroup.children[0] as THREE.Mesh;
    const geometryDispose = vi.spyOn(overlay.geometry, "dispose");
    const material = overlay.material as THREE.Material;
    const materialDispose = vi.spyOn(material, "dispose");

    highlighter.clear();
    highlighter.clear();

    expect(highlighter.highlightGroup.children).toHaveLength(0);
    expect(highlighter.gripperHolder.visible).toBe(false);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).not.toHaveBeenCalled();

    highlighter.dispose();
    highlighter.dispose();
    expect(materialDispose).toHaveBeenCalledTimes(1);
  });

  it("positions the loaded gripper without taking ownership of its resources", () => {
    const scene = new THREE.Scene();
    const highlighter = createViewerHighlighter({
      scene,
      packageLength: 200,
    });
    const gripperGeometry = new THREE.BufferGeometry();
    const gripperMaterial = new THREE.MeshBasicMaterial();
    const gripperModel = new THREE.Group();
    gripperModel.add(new THREE.Mesh(gripperGeometry, gripperMaterial));
    const geometryDispose = vi.spyOn(gripperGeometry, "dispose");
    const materialDispose = vi.spyOn(gripperMaterial, "dispose");
    const selected = entry();

    highlighter.setGripperModel(gripperModel);
    highlighter.show(selected, [selected], 1);

    expect(highlighter.gripperHolder.visible).toBe(true);
    expect(highlighter.gripperHolder.position.toArray()).toEqual([
      400, 300, 153,
    ]);
    expect(highlighter.gripperHolder.rotation.z).toBeCloseTo(Math.PI);
    expect(highlighter.gripperHolder.children).toEqual([gripperModel]);
    expect(highlighter.highlightGroup.children).toHaveLength(2);

    highlighter.dispose();

    expect(highlighter.gripperHolder.children).toHaveLength(0);
    expect(geometryDispose).not.toHaveBeenCalled();
    expect(materialDispose).not.toHaveBeenCalled();
  });
});
