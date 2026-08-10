import * as THREE from "three";
import {
  footprintSize,
  layerInterlayerHeightMm,
  layerPlaceZ,
  layerZBottom,
  trailingInterlayerHeightMm,
} from "~/domain/palletGeometry";
import type { Box, PalletData, PlanarDimensions } from "~/domain/palletTypes";
import { createLayerLabelObject } from "~/components/rob-viewer/sceneLabels";
import { createResourceTracker } from "~/components/rob-viewer/sceneResources";
import type {
  BoxPickEntry,
  BuiltViewerScene,
  InterlayerRender,
  LayerLabelRender,
  LayerRender,
  ViewerSceneBuildOptions,
} from "~/components/rob-viewer/viewerTypes";

type FaceColors = {
  green: THREE.Color;
  white: THREE.Color;
  red: THREE.Color;
  blue: THREE.Color;
};

type AddQuad = (
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
  color: THREE.Color,
) => void;

function placeOf(box: Box): {
  placeX: number;
  placeY: number;
  numPackages: number;
} {
  const legacyBox = box as Box & {
    placeX?: number;
    placeY?: number;
    numPackages?: number;
  };
  return {
    placeX: legacyBox.placeX ?? box.rect.x,
    placeY: legacyBox.placeY ?? box.rect.y,
    numPackages: legacyBox.numPackages ?? 1,
  };
}

function buildBoxQuads(
  box: Box,
  z: number,
  addQuad: AddQuad,
  colors: FaceColors,
): void {
  const { width, length } = footprintSize(box);
  const height = box.height;

  const v0 = new THREE.Vector3(
    box.rect.x - width / 2,
    box.rect.y - length / 2,
    z,
  );
  const v1 = new THREE.Vector3(
    box.rect.x + width / 2,
    box.rect.y - length / 2,
    z,
  );
  const v2 = new THREE.Vector3(
    box.rect.x + width / 2,
    box.rect.y + length / 2,
    z,
  );
  const v3 = new THREE.Vector3(
    box.rect.x - width / 2,
    box.rect.y + length / 2,
    z,
  );
  const v4 = new THREE.Vector3(
    box.rect.x - width / 2,
    box.rect.y - length / 2,
    z + height,
  );
  const v5 = new THREE.Vector3(
    box.rect.x + width / 2,
    box.rect.y - length / 2,
    z + height,
  );
  const v6 = new THREE.Vector3(
    box.rect.x + width / 2,
    box.rect.y + length / 2,
    z + height,
  );
  const v7 = new THREE.Vector3(
    box.rect.x - width / 2,
    box.rect.y + length / 2,
    z + height,
  );

  const faceColors: [
    THREE.Color,
    THREE.Color,
    THREE.Color,
    THREE.Color,
    THREE.Color,
    THREE.Color,
  ] =
    box.rotation === 0
      ? [
          colors.green,
          colors.green,
          colors.white,
          colors.red,
          colors.blue,
          colors.blue,
        ]
      : box.rotation === 90
        ? [
            colors.green,
            colors.green,
            colors.blue,
            colors.blue,
            colors.red,
            colors.white,
          ]
        : box.rotation === 180
          ? [
              colors.green,
              colors.green,
              colors.red,
              colors.white,
              colors.blue,
              colors.blue,
            ]
          : [
              colors.green,
              colors.green,
              colors.blue,
              colors.blue,
              colors.white,
              colors.red,
            ];

  addQuad(v0, v1, v2, v3, faceColors[0]);
  addQuad(v4, v5, v6, v7, faceColors[1]);
  addQuad(v0, v1, v5, v4, faceColors[2]);
  addQuad(v2, v3, v7, v6, faceColors[3]);
  addQuad(v0, v3, v7, v4, faceColors[4]);
  addQuad(v1, v2, v6, v5, faceColors[5]);
}

function layerOffsetMm(
  options: ViewerSceneBuildOptions,
  layerIndex: number,
): number {
  const offset = options.layerOffsetsZMm?.[layerIndex] ?? 0;
  return Number.isFinite(offset) ? offset : 0;
}

function resolvedPlanarDimensions(
  preferred: PlanarDimensions | null | undefined,
  fallback: PlanarDimensions,
): PlanarDimensions {
  return preferred &&
    Number.isFinite(preferred.width) &&
    preferred.width > 0 &&
    Number.isFinite(preferred.length) &&
    preferred.length > 0
    ? preferred
    : fallback;
}

function inferredScenePlanarDimensions(data: PalletData): PlanarDimensions {
  let minX = 0;
  let minY = 0;
  let maxX = data.package.width;
  let maxY = data.package.length;
  for (const box of data.layers.flatMap(({ boxes }) => boxes)) {
    const size = footprintSize(box);
    minX = Math.min(minX, box.rect.x - size.width / 2);
    minY = Math.min(minY, box.rect.y - size.length / 2);
    maxX = Math.max(maxX, box.rect.x + size.width / 2);
    maxY = Math.max(maxY, box.rect.y + size.length / 2);
  }
  return {
    width: Math.max(1, maxX - minX),
    length: Math.max(1, maxY - minY),
  };
}

/** Build all data-owned scene geometry. Browser/WebGL lifecycle stays in the controller. */
export function buildViewerScene(
  scene: THREE.Scene,
  data: PalletData,
  options: ViewerSceneBuildOptions = {},
): BuiltViewerScene {
  const resources = createResourceTracker();
  const root = new THREE.Group();
  scene.add(root);

  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  root.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.6);
  directional.position.set(1, 1, 2);
  root.add(directional);

  const faceColorSet: FaceColors = {
    green: new THREE.Color("#00ff88"),
    white: new THREE.Color("#eeeeee"),
    red: new THREE.Color("#ff3355"),
    blue: new THREE.Color("#3388ff"),
  };
  const solidMaterial = resources.trackMaterial(
    new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 5,
      side: THREE.DoubleSide,
      transparent: false,
      depthTest: true,
      depthWrite: true,
    }),
  );
  solidMaterial.polygonOffset = true;
  solidMaterial.polygonOffsetFactor = 2;
  solidMaterial.polygonOffsetUnits = 4;

  const solidEdgeMaterial = resources.trackMaterial(
    new THREE.LineBasicMaterial({
      color: 0x18181b,
      opacity: 0.85,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    }),
  );
  const interlayerMaterial = resources.trackMaterial(
    new THREE.MeshPhongMaterial({
      color: 0xd6c49a,
      shininess: 3,
      side: THREE.DoubleSide,
    }),
  );
  const exposedInterlayerMaterial = resources.trackMaterial(
    new THREE.MeshPhongMaterial({
      color: 0xd6c49a,
      shininess: 3,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    }),
  );
  const interlayerEdgeMaterial = resources.trackMaterial(
    new THREE.LineBasicMaterial({
      color: 0xffedbd,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false,
    }),
  );

  const layerRenders: LayerRender[] = [];
  const interlayerRenders: InterlayerRender[] = [];
  const layerLabels: LayerLabelRender[] = [];
  const allBounds = new THREE.Box3();
  let hasBounds = false;
  const inferredPlanarDimensions = inferredScenePlanarDimensions(data);
  const palletWidth = data.pallet?.width ?? inferredPlanarDimensions.width;
  const palletLength = data.pallet?.length ?? inferredPlanarDimensions.length;
  const palletPlanarDimensions = {
    width: palletWidth,
    length: palletLength,
  };
  const sharedInterlayerDimensions = resolvedPlanarDimensions(
    data.interlayer,
    palletPlanarDimensions,
  );

  for (let layerIndex = 0; layerIndex < data.layers.length; layerIndex++) {
    const layer = data.layers[layerIndex]!;
    const layerNum = layerIndex;
    const renderOffsetZ = layerOffsetMm(options, layerIndex);
    const zBottom =
      layerZBottom(data.layers, layerIndex, data.package.height) +
      renderOffsetZ;
    const placeZ =
      layerPlaceZ(data.layers, layerIndex, data.package.height) + renderOffsetZ;
    const zwischenlageAbove =
      layerIndex === data.layers.length - 1
        ? (data.trailingZwischenlage ?? 0)
        : (data.layers[layerIndex + 1]?.zwischenlage ?? 0);

    const positions: number[] = [];
    const vertexColors: number[] = [];
    const indices: number[] = [];
    const edgePositions: number[] = [];
    const pickEntries: BoxPickEntry[] = [];
    let faceCursor = 0;

    const addQuad: AddQuad = (a, b, c, d, color) => {
      const base = positions.length / 3;
      positions.push(
        a.x,
        a.y,
        a.z,
        b.x,
        b.y,
        b.z,
        c.x,
        c.y,
        c.z,
        d.x,
        d.y,
        d.z,
      );
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      for (let index = 0; index < 4; index++) {
        vertexColors.push(color.r, color.g, color.b);
      }
      edgePositions.push(
        a.x,
        a.y,
        a.z,
        b.x,
        b.y,
        b.z,
        b.x,
        b.y,
        b.z,
        c.x,
        c.y,
        c.z,
        c.x,
        c.y,
        c.z,
        d.x,
        d.y,
        d.z,
        d.x,
        d.y,
        d.z,
        a.x,
        a.y,
        a.z,
      );
    };

    for (let boxIndex = 0; boxIndex < layer.boxes.length; boxIndex++) {
      const box = layer.boxes[boxIndex]!;
      const firstFace = faceCursor;
      const { placeX, placeY, numPackages } = placeOf(box);
      buildBoxQuads(box, zBottom, addQuad, faceColorSet);
      faceCursor += 12;
      pickEntries.push({
        layerIndex,
        boxIndex,
        blueNumber: box.blueNumber,
        placeX,
        placeY,
        zBottom,
        placeZ,
        numPackages,
        rotation: box.rotation,
        rect: box.rect,
        height: box.height,
        layerNum,
        zwischenlage: zwischenlageAbove,
        firstFace,
        faceCount: 12,
      });
    }

    if (options.showLayerLabels) {
      const label = createLayerLabelObject(layerIndex + 1, resources);
      label.position.set(
        palletWidth + 80,
        palletLength / 2,
        zBottom + data.package.height / 2,
      );
      root.add(label);
      layerLabels.push({ layerNum, object: label });
    }

    if (positions.length === 0) continue;

    const geometry = resources.trackGeometry(new THREE.BufferGeometry());
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setIndex(indices);
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(vertexColors, 3),
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      allBounds.union(geometry.boundingBox);
      hasBounds = true;
    }

    const solidMesh = new THREE.Mesh(geometry, solidMaterial);
    solidMesh.name = `layer-${layerIndex + 1}-boxes`;
    root.add(solidMesh);

    const edgeGeometry = resources.trackGeometry(new THREE.BufferGeometry());
    edgeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(edgePositions, 3),
    );
    const solidEdges = new THREE.LineSegments(edgeGeometry, solidEdgeMaterial);
    solidEdges.renderOrder = 2;
    root.add(solidEdges);

    layerRenders.push({ layerNum, solidMesh, solidEdges, pickEntries });
  }

  const addInterlayerRender = (
    layerNum: number,
    bottomZ: number,
    height: number,
    dimensions: PlanarDimensions,
    isAboveLayer: boolean,
  ) => {
    if (!Number.isFinite(height) || height <= 0) return;
    const resolvedDimensions = resolvedPlanarDimensions(
      dimensions,
      sharedInterlayerDimensions,
    );

    const geometry = resources.trackGeometry(
      new THREE.BoxGeometry(
        resolvedDimensions.width,
        resolvedDimensions.length,
        height,
      ),
    );
    const mesh = new THREE.Mesh(geometry, interlayerMaterial);
    mesh.name = `interlayer-${layerNum + 1}-${isAboveLayer ? "after" : "before"}`;
    mesh.position.set(
      resolvedDimensions.width / 2,
      resolvedDimensions.length / 2,
      bottomZ + height / 2,
    );
    mesh.renderOrder = 0;
    root.add(mesh);

    const edges = new THREE.LineSegments(
      resources.trackGeometry(new THREE.EdgesGeometry(geometry)),
      interlayerEdgeMaterial,
    );
    edges.position.copy(mesh.position);
    edges.renderOrder = 2;
    root.add(edges);
    interlayerRenders.push({
      layerNum,
      isAboveLayer,
      mesh,
      edges,
      opaqueMaterial: interlayerMaterial,
      exposedMaterial: exposedInterlayerMaterial,
    });

    allBounds.union(
      new THREE.Box3().setFromCenterAndSize(
        mesh.position,
        new THREE.Vector3(
          resolvedDimensions.width,
          resolvedDimensions.length,
          height,
        ),
      ),
    );
    hasBounds = true;
  };

  if (data.layers.length > 0) {
    addInterlayerRender(
      0,
      0,
      layerInterlayerHeightMm(data.layers[0]),
      resolvedPlanarDimensions(
        data.layers[0]?.interlayerDimensions,
        sharedInterlayerDimensions,
      ),
      false,
    );
    for (
      let layerIndex = 0;
      layerIndex < data.layers.length - 1;
      layerIndex++
    ) {
      addInterlayerRender(
        layerIndex,
        layerPlaceZ(data.layers, layerIndex, data.package.height) +
          layerOffsetMm(options, layerIndex),
        layerInterlayerHeightMm(data.layers[layerIndex + 1]),
        resolvedPlanarDimensions(
          data.layers[layerIndex + 1]?.interlayerDimensions,
          sharedInterlayerDimensions,
        ),
        true,
      );
    }
    const topLayerIndex = data.layers.length - 1;
    addInterlayerRender(
      topLayerIndex,
      layerPlaceZ(data.layers, topLayerIndex, data.package.height) +
        layerOffsetMm(options, topLayerIndex),
      trailingInterlayerHeightMm(data),
      resolvedPlanarDimensions(
        data.trailingInterlayerDimensions,
        sharedInterlayerDimensions,
      ),
      true,
    );
  }

  if (data.pallet) {
    const palletGeometry = resources.trackGeometry(
      new THREE.BoxGeometry(palletWidth, palletLength, data.pallet.height),
    );
    const palletMaterial = resources.trackMaterial(
      new THREE.MeshPhongMaterial({
        color: 0xb38b6d,
        shininess: 10,
        side: THREE.DoubleSide,
      }),
    );
    palletMaterial.polygonOffset = true;
    palletMaterial.polygonOffsetFactor = 1;
    palletMaterial.polygonOffsetUnits = 2;
    const palletMesh = new THREE.Mesh(palletGeometry, palletMaterial);
    palletMesh.name = "pallet";
    palletMesh.position.set(
      palletWidth / 2,
      palletLength / 2,
      -data.pallet.height / 2,
    );
    root.add(palletMesh);
    allBounds.union(
      new THREE.Box3().setFromCenterAndSize(
        palletMesh.position,
        new THREE.Vector3(palletWidth, palletLength, data.pallet.height),
      ),
    );
    hasBounds = true;

    const palletEdges = new THREE.LineSegments(
      resources.trackGeometry(new THREE.EdgesGeometry(palletGeometry)),
      resources.trackMaterial(
        new THREE.LineBasicMaterial({
          color: 0x2b2b2b,
          transparent: true,
          opacity: 0.9,
        }),
      ),
    );
    palletEdges.position.copy(palletMesh.position);
    palletEdges.renderOrder = 2;
    root.add(palletEdges);
  }

  const gridSize = Math.max(palletWidth, palletLength);
  const gridDivisions = Math.max(8, Math.min(40, Math.round(gridSize / 50)));
  const grid = new THREE.GridHelper(
    gridSize,
    gridDivisions,
    0x2a2a2e,
    0x1c1c1f,
  );
  grid.rotation.x = Math.PI / 2;
  grid.position.set(palletWidth / 2, palletLength / 2, 0.5);
  root.add(grid);
  resources.trackObject(grid);

  const axes = new THREE.AxesHelper(400);
  root.add(axes);
  resources.trackObject(axes);

  return {
    root,
    bounds: hasBounds ? allBounds : null,
    layerRenders,
    interlayerRenders,
    layerLabels,
    pickEntries: layerRenders.flatMap((layer) => layer.pickEntries),
    dispose() {
      scene.remove(root);
      root.clear();
      resources.disposeAll();
    },
  };
}
