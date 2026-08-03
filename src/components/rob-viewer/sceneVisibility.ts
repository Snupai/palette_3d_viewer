import type {
  BoxPickEntry,
  InterlayerRender,
  LayerRender,
} from "~/components/rob-viewer/viewerTypes";

export function visibleLayerCount(
  visibleUpToLayer: number,
  layerCount: number,
): number {
  return Math.min(Math.max(1, visibleUpToLayer), Math.max(1, layerCount));
}

export function applyLayerVisibility({
  layerRenders,
  interlayerRenders,
  visibleUpToLayer,
  layerCount,
}: {
  layerRenders: LayerRender[];
  interlayerRenders: InterlayerRender[];
  visibleUpToLayer: number;
  layerCount: number;
}): number {
  const maxSolid = visibleLayerCount(visibleUpToLayer, layerCount);

  for (const layer of layerRenders) {
    const visible = layer.layerNum + 1 <= maxSolid;
    layer.solidMesh.visible = visible;
    layer.solidEdges.visible = visible;
  }

  for (const interlayer of interlayerRenders) {
    const visible = interlayer.layerNum + 1 <= maxSolid;
    const exposed =
      interlayer.isAboveLayer && interlayer.layerNum + 1 === maxSolid;
    interlayer.mesh.visible = visible;
    interlayer.edges.visible = visible;
    interlayer.mesh.material = exposed
      ? interlayer.exposedMaterial
      : interlayer.opaqueMaterial;
    interlayer.mesh.renderOrder = exposed ? 1 : 0;
  }

  return maxSolid;
}

export function isPickEntryVisible(
  entry: BoxPickEntry,
  maxVisibleLayer: number,
): boolean {
  return entry.layerNum + 1 <= maxVisibleLayer;
}
