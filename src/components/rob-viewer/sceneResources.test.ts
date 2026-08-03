import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { createResourceTracker } from "~/components/rob-viewer/sceneResources";

describe("scene resource tracker", () => {
  it("disposes shared object resources exactly once", () => {
    const geometry = new THREE.BoxGeometry();
    const texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const root = new THREE.Group();
    root.add(
      new THREE.Mesh(geometry, [material, material]),
      new THREE.Mesh(geometry, material),
    );
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    const tracker = createResourceTracker();

    tracker.trackObject(root);
    tracker.trackObject(root);
    tracker.disposeAll();
    tracker.disposeAll();

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });

  it("clears ownership between temporary resource lifetimes", () => {
    const first = new THREE.BufferGeometry();
    const second = new THREE.BufferGeometry();
    const firstDispose = vi.spyOn(first, "dispose");
    const secondDispose = vi.spyOn(second, "dispose");
    const tracker = createResourceTracker();

    tracker.trackGeometry(first);
    tracker.disposeAll();
    tracker.trackGeometry(second);
    tracker.disposeAll();
    tracker.disposeAll();

    expect(firstDispose).toHaveBeenCalledTimes(1);
    expect(secondDispose).toHaveBeenCalledTimes(1);
  });

  it("tracks textures owned by a directly tracked material", () => {
    const texture = new THREE.Texture();
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const materialDispose = vi.spyOn(material, "dispose");
    const textureDispose = vi.spyOn(texture, "dispose");
    const tracker = createResourceTracker();

    tracker.trackMaterial(material);
    tracker.disposeAll();

    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
});
