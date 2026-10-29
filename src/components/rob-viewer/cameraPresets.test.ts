import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { applyCameraPreset } from "~/components/rob-viewer/cameraPresets";

function setup() {
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 1, 10_000);
  const controls = {
    target: new THREE.Vector3(),
    maxDistance: 0,
    update: vi.fn(),
  };
  const bounds = new THREE.Box3(
    new THREE.Vector3(0, 0, -144),
    new THREE.Vector3(1200, 800, 900),
  );
  return { camera, controls, bounds };
}

describe("fixed viewer camera presets", () => {
  it("applies deterministic top and front axes around the same fitted target", () => {
    const { camera, controls, bounds } = setup();

    const top = applyCameraPreset(camera, controls, bounds, "top");
    expect(controls.target.toArray()).toEqual([600, 400, 378]);
    expect(camera.position.x).toBeCloseTo(600);
    expect(camera.position.y).toBeCloseTo(400);
    expect(camera.position.z).toBeGreaterThan(top.center.z);
    expect(camera.up.toArray()).toEqual([0, 1, 0]);

    const front = applyCameraPreset(camera, controls, bounds, "front");
    expect(front.distance).toBeCloseTo(top.distance);
    expect(camera.position.x).toBeCloseTo(600);
    expect(camera.position.y).toBeLessThan(front.center.y);
    expect(camera.position.z).toBeCloseTo(378);
    expect(camera.up.toArray()).toEqual([0, 0, 1]);
  });

  it("keeps right-top on the positive-X, negative-Y, positive-Z diagonal", () => {
    const { camera, controls, bounds } = setup();

    const applied = applyCameraPreset(camera, controls, bounds, "right-top");
    const offset = camera.position.clone().sub(applied.center);

    expect(offset.x).toBeGreaterThan(0);
    expect(offset.y).toBeLessThan(0);
    expect(offset.z).toBeGreaterThan(0);
    expect(offset.length()).toBeCloseTo(applied.distance);
    expect(controls.maxDistance).toBeCloseTo(applied.distance * 3);
    expect(controls.update).toHaveBeenCalledTimes(1);
  });
});
