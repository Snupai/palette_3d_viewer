import * as THREE from "three";
import type {
  BoxPickEntry,
  BoxSelection,
  LayerRender,
} from "~/components/rob-viewer/viewerTypes";

export type PointerPosition = { x: number; y: number };

export function isClickGesture(
  pointerDown: PointerPosition,
  pointerUp: PointerPosition,
): boolean {
  const dx = pointerUp.x - pointerDown.x;
  const dy = pointerUp.y - pointerDown.y;
  return dx * dx + dy * dy <= 25;
}

export function findPickEntryForFace(
  entries: BoxPickEntry[],
  faceIndex: number,
): BoxPickEntry | null {
  return (
    entries.find(
      (entry) =>
        faceIndex >= entry.firstFace &&
        faceIndex < entry.firstFace + entry.faceCount,
    ) ?? null
  );
}

export function mapIntersectionToPickEntry(
  layerRenders: LayerRender[],
  intersection: Pick<THREE.Intersection, "faceIndex" | "object"> | undefined,
): BoxPickEntry | null {
  if (
    intersection?.faceIndex == null ||
    !(intersection.object instanceof THREE.Mesh)
  ) {
    return null;
  }

  const layer = layerRenders.find(
    (candidate) => candidate.solidMesh === intersection.object,
  );
  return layer
    ? findPickEntryForFace(layer.pickEntries, intersection.faceIndex)
    : null;
}

export function pickViewerEntry({
  clientX,
  clientY,
  element,
  camera,
  raycaster,
  pointer,
  layerRenders,
}: {
  clientX: number;
  clientY: number;
  element: HTMLElement;
  camera: THREE.Camera;
  raycaster: THREE.Raycaster;
  pointer: THREE.Vector2;
  layerRenders: LayerRender[];
}): BoxPickEntry | null {
  const rect = element.getBoundingClientRect();
  pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const solidMeshes = layerRenders
    .filter((layer) => layer.solidMesh.visible)
    .map((layer) => layer.solidMesh);
  const [intersection] = raycaster.intersectObjects(solidMeshes, false);
  return mapIntersectionToPickEntry(layerRenders, intersection);
}

export function gripEntriesFor(
  entries: BoxPickEntry[],
  selected: BoxPickEntry,
): BoxPickEntry[] {
  return entries.filter(
    (entry) =>
      entry.layerIndex === selected.layerIndex &&
      entry.blueNumber === selected.blueNumber,
  );
}

export function toBoxSelection(
  entry: BoxPickEntry,
  gripEntries: BoxPickEntry[],
): BoxSelection {
  return {
    layerIndex: entry.layerIndex,
    boxIndex: entry.boxIndex,
    blueNumber: entry.blueNumber,
    placeX: entry.placeX,
    placeY: entry.placeY,
    placeZ: entry.placeZ,
    numPackages: entry.numPackages,
    rotation: entry.rotation,
    rect: entry.rect,
    height: entry.height,
    gripBoxCount: gripEntries.length,
    zwischenlage: entry.zwischenlage,
  };
}
