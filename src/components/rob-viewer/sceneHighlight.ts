import * as THREE from "three";
import { footprintSize } from "~/domain/palletGeometry";
import { createResourceTracker } from "~/components/rob-viewer/sceneResources";
import { isPickEntryVisible } from "~/components/rob-viewer/sceneVisibility";
import type { BoxPickEntry } from "~/components/rob-viewer/viewerTypes";

export type ViewerHighlighter = {
  highlightGroup: THREE.Group;
  gripperHolder: THREE.Group;
  show(
    entry: BoxPickEntry,
    gripEntries: BoxPickEntry[],
    maxVisibleLayer: number,
  ): void;
  clear(): void;
  setGripperModel(model: THREE.Group | null): void;
  dispose(): void;
};

type HighlightRequest = {
  entry: BoxPickEntry;
  gripEntries: BoxPickEntry[];
  maxVisibleLayer: number;
};

/** Own selection visuals, while the gripper loader retains ownership of model resources. */
export function createViewerHighlighter({
  scene,
  packageLength,
}: {
  scene: THREE.Scene;
  packageLength: number;
}): ViewerHighlighter {
  const root = new THREE.Group();
  scene.add(root);

  const highlightGroup = new THREE.Group();
  highlightGroup.renderOrder = 3;
  root.add(highlightGroup);

  const gripperHolder = new THREE.Group();
  gripperHolder.visible = false;
  gripperHolder.renderOrder = 4;
  root.add(gripperHolder);

  const persistentResources = createResourceTracker();
  const temporaryResources = createResourceTracker();
  const highlightMaterial = persistentResources.trackMaterial(
    new THREE.MeshBasicMaterial({
      color: 0xffdd33,
      transparent: true,
      opacity: 0.35,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const highlightEdgeMaterial = persistentResources.trackMaterial(
    new THREE.LineBasicMaterial({
      color: 0xffee66,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    }),
  );
  const placeMarkerMaterial = persistentResources.trackMaterial(
    new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      depthTest: true,
      depthWrite: false,
    }),
  );

  let gripperModel: THREE.Group | null = null;
  let currentRequest: HighlightRequest | null = null;
  let disposed = false;

  const clearVisuals = () => {
    gripperHolder.visible = false;
    highlightGroup.clear();
    temporaryResources.disposeAll();
  };

  const renderCurrent = () => {
    clearVisuals();
    if (
      !currentRequest ||
      !isPickEntryVisible(currentRequest.entry, currentRequest.maxVisibleLayer)
    ) {
      return;
    }

    const { entry, gripEntries } = currentRequest;
    for (const grip of gripEntries) {
      const { width, length } = footprintSize(grip);
      const geometry = temporaryResources.trackGeometry(
        new THREE.BoxGeometry(width * 1.02, length * 1.02, grip.height * 1.02),
      );
      const overlay = new THREE.Mesh(geometry, highlightMaterial);
      overlay.position.set(
        grip.rect.x,
        grip.rect.y,
        grip.zBottom + grip.height / 2,
      );
      highlightGroup.add(overlay);

      const edges = new THREE.LineSegments(
        temporaryResources.trackGeometry(new THREE.EdgesGeometry(geometry)),
        highlightEdgeMaterial,
      );
      edges.position.copy(overlay.position);
      highlightGroup.add(edges);
    }

    if (gripperModel) {
      const shortSingle =
        entry.numPackages === 1 && packageLength < 265 ? 90 : 0;
      gripperHolder.position.set(entry.placeX, entry.placeY, entry.placeZ);
      gripperHolder.rotation.z = THREE.MathUtils.degToRad(
        entry.rotation + shortSingle,
      );
      gripperHolder.visible = true;
      return;
    }

    const markerZ = entry.placeZ + 20;
    const marker = new THREE.Mesh(
      temporaryResources.trackGeometry(new THREE.SphereGeometry(18, 12, 12)),
      placeMarkerMaterial,
    );
    marker.position.set(entry.placeX, entry.placeY, markerZ);
    highlightGroup.add(marker);

    const stemGeometry = temporaryResources.trackGeometry(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(entry.placeX, entry.placeY, entry.placeZ),
        new THREE.Vector3(entry.placeX, entry.placeY, markerZ),
      ]),
    );
    highlightGroup.add(new THREE.Line(stemGeometry, highlightEdgeMaterial));
  };

  return {
    highlightGroup,
    gripperHolder,
    show(entry, gripEntries, maxVisibleLayer) {
      if (disposed) return;
      currentRequest = { entry, gripEntries, maxVisibleLayer };
      renderCurrent();
    },
    clear() {
      currentRequest = null;
      clearVisuals();
    },
    setGripperModel(model) {
      if (disposed) return;
      gripperHolder.clear();
      gripperModel = model;
      if (gripperModel) gripperHolder.add(gripperModel);
      renderCurrent();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      currentRequest = null;
      clearVisuals();
      gripperHolder.clear();
      gripperModel = null;
      root.clear();
      scene.remove(root);
      persistentResources.disposeAll();
    },
  };
}
