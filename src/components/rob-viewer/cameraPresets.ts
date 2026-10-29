import * as THREE from "three";
import type { ViewerCameraPreset } from "~/components/rob-viewer/viewerTypes";

export type CameraPresetControls = {
  target: THREE.Vector3;
  maxDistance: number;
  update(): void;
};

export type AppliedCameraPreset = {
  center: THREE.Vector3;
  distance: number;
  maxOrbitDistance: number;
};

function resolvedBounds(bounds: THREE.Box3 | null): THREE.Box3 {
  if (bounds && !bounds.isEmpty()) return bounds.clone();
  return new THREE.Box3(
    new THREE.Vector3(0, 0, -144),
    new THREE.Vector3(1200, 800, 600),
  );
}

function presetDirection(preset: ViewerCameraPreset): THREE.Vector3 {
  if (preset === "top") return new THREE.Vector3(0, 0, 1);
  if (preset === "front") return new THREE.Vector3(0, -1, 0);
  return new THREE.Vector3(1, -1, 0.85).normalize();
}

function cameraDistance(
  camera: THREE.PerspectiveCamera,
  size: THREE.Vector3,
): number {
  const radius = Math.max(size.length() / 2, 1);
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const aspect =
    Number.isFinite(camera.aspect) && camera.aspect > 0 ? camera.aspect : 1;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  const limitingHalfFov = Math.max(
    THREE.MathUtils.degToRad(5),
    Math.min(verticalHalfFov, horizontalHalfFov),
  );
  return Math.max(500, (radius / Math.sin(limitingHalfFov)) * 1.15);
}

/** Apply a reproducible fitted view independent of the previous orbit state. */
export function applyCameraPreset(
  camera: THREE.PerspectiveCamera,
  controls: CameraPresetControls,
  bounds: THREE.Box3 | null,
  preset: ViewerCameraPreset,
): AppliedCameraPreset {
  const fittedBounds = resolvedBounds(bounds);
  const center = fittedBounds.getCenter(new THREE.Vector3());
  const size = fittedBounds.getSize(new THREE.Vector3());
  const sphere = fittedBounds.getBoundingSphere(new THREE.Sphere());
  const distance = cameraDistance(camera, size);
  const direction = presetDirection(preset);

  camera.up.set(0, preset === "top" ? 1 : 0, preset === "top" ? 0 : 1);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);
  const maxOrbitDistance = distance * 3;
  camera.near = THREE.MathUtils.clamp(sphere.radius / 100, 0.5, 10);
  camera.far = maxOrbitDistance + sphere.radius * 3;
  camera.updateProjectionMatrix();

  controls.target.copy(center);
  controls.maxDistance = maxOrbitDistance;
  controls.update();

  return { center, distance, maxOrbitDistance };
}
