import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { disposeObject3D } from "~/components/rob-viewer/sceneResources";
import type {
  ViewerScenePose,
  ViewerTemporaryCalibrationState,
  ViewerTemporaryCalibrationTarget,
} from "~/components/rob-viewer/viewerTypes";

export type ViewerCalibrationOverlay = {
  setState(state: ViewerTemporaryCalibrationState): void;
  dispose(): void;
};

type CalibrationOverlayOptions = {
  scene: THREE.Scene;
  camera: THREE.Camera;
  domElement: HTMLElement;
  palletObject: THREE.Object3D;
  packageDimensionsMm: {
    width: number;
    length: number;
    height: number;
  };
  onPoseChange: (
    target: ViewerTemporaryCalibrationTarget,
    pose: ViewerScenePose,
  ) => void;
  onDraggingChange: (dragging: boolean) => void;
  requestRender: () => void;
};

const PICKUP_COLOR = 0x22d3ee;
const PALLET_COLOR = 0xf59e0b;

function applyPose(object: THREE.Object3D, pose: ViewerScenePose): void {
  object.position.set(
    pose.positionMm.x,
    pose.positionMm.y,
    pose.positionMm.z,
  );
  object.rotation.set(0, 0, THREE.MathUtils.degToRad(pose.yawDeg));
}

function cleanNumber(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function poseFromObject(object: THREE.Object3D): ViewerScenePose {
  return {
    positionMm: {
      x: cleanNumber(object.position.x),
      y: cleanNumber(object.position.y),
      z: cleanNumber(object.position.z),
    },
    yawDeg: cleanNumber(THREE.MathUtils.radToDeg(object.rotation.z)),
  };
}

function createPickupMarker(dimensions: {
  width: number;
  length: number;
  height: number;
}): THREE.Group {
  const marker = new THREE.Group();
  marker.name = "temporary-calibration-pickup";

  const packageGeometry = new THREE.BoxGeometry(
    dimensions.width,
    dimensions.length,
    dimensions.height,
  );
  const packageMaterial = new THREE.MeshBasicMaterial({
    color: PICKUP_COLOR,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const packageGhost = new THREE.Mesh(packageGeometry, packageMaterial);
  packageGhost.position.z = -dimensions.height / 2;
  packageGhost.renderOrder = 20;
  marker.add(packageGhost);

  const packageEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(packageGeometry),
    new THREE.LineBasicMaterial({
      color: PICKUP_COLOR,
      transparent: true,
      opacity: 0.95,
    }),
  );
  packageEdges.position.copy(packageGhost.position);
  packageEdges.renderOrder = 21;
  marker.add(packageEdges);

  const origin = new THREE.Mesh(
    new THREE.SphereGeometry(20, 18, 12),
    new THREE.MeshBasicMaterial({ color: PICKUP_COLOR }),
  );
  origin.renderOrder = 22;
  marker.add(origin);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(42, 4, 8, 32),
    new THREE.MeshBasicMaterial({
      color: PICKUP_COLOR,
      transparent: true,
      opacity: 0.9,
    }),
  );
  ring.renderOrder = 22;
  marker.add(ring);

  const arrowLength = Math.max(120, Math.min(dimensions.width, dimensions.length));
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 25),
    arrowLength,
    PICKUP_COLOR,
    36,
    20,
  );
  arrow.renderOrder = 22;
  marker.add(arrow);

  return marker;
}

export function createViewerCalibrationOverlay({
  scene,
  camera,
  domElement,
  palletObject,
  packageDimensionsMm,
  onPoseChange,
  onDraggingChange,
  requestRender,
}: CalibrationOverlayOptions): ViewerCalibrationOverlay {
  const originalPalletTransform = {
    position: palletObject.position.clone(),
    quaternion: palletObject.quaternion.clone(),
    scale: palletObject.scale.clone(),
  };
  const pickupMarker = createPickupMarker(packageDimensionsMm);
  scene.add(pickupMarker);

  const controls = new TransformControls(camera, domElement);
  const helper = controls.getHelper();
  helper.name = "temporary-calibration-transform-controls";
  scene.add(helper);
  controls.setSpace("world");
  controls.setTranslationSnap(1);
  controls.setRotationSnap(THREE.MathUtils.degToRad(1));
  controls.setSize(0.9);

  let activeTarget: ViewerTemporaryCalibrationTarget = "pallet";
  let disposed = false;

  const activeObject = () =>
    activeTarget === "pallet" ? palletObject : pickupMarker;

  const onObjectChange = () => {
    if (disposed) return;
    onPoseChange(activeTarget, poseFromObject(activeObject()));
    requestRender();
  };
  const onControlChange = () => requestRender();
  const onDraggingChanged = (event: { value: unknown }) => {
    onDraggingChange(event.value === true);
  };

  controls.addEventListener("objectChange", onObjectChange);
  controls.addEventListener("change", onControlChange);
  controls.addEventListener("dragging-changed", onDraggingChanged);

  return {
    setState(state) {
      if (disposed) return;
      applyPose(palletObject, state.palletPose);
      applyPose(pickupMarker, state.pickupPose);
      activeTarget = state.activeTarget;
      controls.setMode(state.mode);
      controls.showX = state.mode === "translate";
      controls.showY = state.mode === "translate";
      controls.showZ = true;
      controls.setColors(
        0xef4444,
        0x22c55e,
        0x3b82f6,
        activeTarget === "pallet" ? PALLET_COLOR : PICKUP_COLOR,
      );
      controls.attach(activeObject());
      requestRender();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      controls.removeEventListener("objectChange", onObjectChange);
      controls.removeEventListener("change", onControlChange);
      controls.removeEventListener("dragging-changed", onDraggingChanged);
      controls.detach();
      scene.remove(helper);
      controls.dispose();
      scene.remove(pickupMarker);
      disposeObject3D(pickupMarker);
      palletObject.position.copy(originalPalletTransform.position);
      palletObject.quaternion.copy(originalPalletTransform.quaternion);
      palletObject.scale.copy(originalPalletTransform.scale);
      palletObject.updateMatrixWorld(true);
      onDraggingChange(false);
      requestRender();
    },
  };
}
