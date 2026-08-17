import * as THREE from "three";
import type { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { describe, expect, it, vi } from "vitest";
import { createViewerCalibrationOverlay } from "~/components/rob-viewer/sceneCalibrationOverlay";

function expectVector(
  vector: THREE.Vector3,
  expected: readonly [number, number, number],
) {
  expect(vector.toArray()).toEqual(expected);
}

describe("temporary viewer calibration overlay", () => {
  it("moves the rendered pallet, reports exact poses, and restores it on dispose", () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    const canvas = document.createElement("canvas");
    const pallet = new THREE.Group();
    pallet.position.set(7, 8, 9);
    pallet.rotation.z = THREE.MathUtils.degToRad(12);
    scene.add(pallet);
    const onPoseChange = vi.fn();
    const onDraggingChange = vi.fn();
    const requestRender = vi.fn();

    const overlay = createViewerCalibrationOverlay({
      scene,
      camera,
      domElement: canvas,
      palletObject: pallet,
      packageDimensionsMm: { width: 300, length: 400, height: 200 },
      onPoseChange,
      onDraggingChange,
      requestRender,
    });
    overlay.setState({
      activeTarget: "pallet",
      mode: "translate",
      palletPose: {
        positionMm: { x: 1250, y: -340, z: 12 },
        yawDeg: 90,
      },
      pickupPose: {
        positionMm: { x: -600, y: 450, z: 820 },
        yawDeg: 180,
      },
    });

    expectVector(pallet.position, [1250, -340, 12]);
    expect(THREE.MathUtils.radToDeg(pallet.rotation.z)).toBeCloseTo(90);
    const pickup = scene.getObjectByName("temporary-calibration-pickup");
    expect(pickup).toBeTruthy();
    expectVector(pickup!.position, [-600, 450, 820]);
    expect(THREE.MathUtils.radToDeg(pickup!.rotation.z)).toBeCloseTo(180);

    const helper = scene.getObjectByName(
      "temporary-calibration-transform-controls",
    ) as THREE.Object3D & { controls: TransformControls };
    expect(helper).toBeTruthy();
    pallet.position.set(1261, -355, 14);
    pallet.rotation.z = THREE.MathUtils.degToRad(-179);
    helper.controls.dispatchEvent({ type: "objectChange" });
    helper.controls.dispatchEvent({ type: "dragging-changed", value: true });

    expect(onPoseChange).toHaveBeenCalledWith("pallet", {
      positionMm: { x: 1261, y: -355, z: 14 },
      yawDeg: -179,
    });
    expect(onDraggingChange).toHaveBeenCalledWith(true);

    overlay.dispose();
    overlay.dispose();

    expectVector(pallet.position, [7, 8, 9]);
    expect(THREE.MathUtils.radToDeg(pallet.rotation.z)).toBeCloseTo(12);
    expect(
      scene.getObjectByName("temporary-calibration-pickup"),
    ).toBeUndefined();
    expect(onDraggingChange).toHaveBeenLastCalledWith(false);
  });
});
