import * as THREE from "three";
import {
  footprintSize,
  layerPlaceZ,
  layerZBottom,
} from "~/domain/palletGeometry";
import {
  ZWISCHENLAGE_HEIGHT_MM,
  type Box,
  type PalletData,
} from "~/domain/palletTypes";
import { createResourceTracker } from "~/components/rob-viewer/sceneResources";
import type {
  BoxPickEntry,
  BuiltViewerScene,
  InterlayerRender,
  LayerRender,
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

/** Build all data-owned scene geometry. Browser/WebGL lifecycle stays in the controller. */
export function buildViewerScene(
  scene: THREE.Scene,
  data: PalletData,
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
  const allBounds = new THREE.Box3();
  let hasBounds = false;

  for (let layerIndex = 0; layerIndex < data.layers.length; layerIndex++) {
    const layer = data.layers[layerIndex]!;
    const layerNum = layerIndex;
    const zBottom = layerZBottom(data.layers, layerIndex, data.package.height);
    const placeZ = layerPlaceZ(data.layers, layerIndex, data.package.height);
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

  const palletWidth = data.pallet?.width ?? 1200;
  const palletLength = data.pallet?.length ?? 800;
  const addInterlayerRender = (
    layerNum: number,
    bottomZ: number,
    count: number,
    isAboveLayer: boolean,
  ) => {
    const normalizedCount = Math.max(0, Math.trunc(count));
    if (normalizedCount === 0) return;

    const height = normalizedCount * ZWISCHENLAGE_HEIGHT_MM;
    const geometry = resources.trackGeometry(
      new THREE.BoxGeometry(palletWidth, palletLength, height),
    );
    const mesh = new THREE.Mesh(geometry, interlayerMaterial);
    mesh.position.set(palletWidth / 2, palletLength / 2, bottomZ + height / 2);
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
        new THREE.Vector3(palletWidth, palletLength, height),
      ),
    );
    hasBounds = true;
  };

  if (data.layers.length > 0) {
    addInterlayerRender(0, 0, data.layers[0]?.zwischenlage ?? 0, false);
    for (
      let layerIndex = 0;
      layerIndex < data.layers.length - 1;
      layerIndex++
    ) {
      addInterlayerRender(
        layerIndex,
        layerPlaceZ(data.layers, layerIndex, data.package.height),
        data.layers[layerIndex + 1]?.zwischenlage ?? 0,
        true,
      );
    }
    const topLayerIndex = data.layers.length - 1;
    addInterlayerRender(
      topLayerIndex,
      layerPlaceZ(data.layers, topLayerIndex, data.package.height),
      data.trailingZwischenlage ?? 0,
      true,
    );
  }

  const euroHeight = 144;
  const palletGeometry = resources.trackGeometry(
    new THREE.BoxGeometry(palletWidth, palletLength, euroHeight),
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
  palletMesh.position.set(palletWidth / 2, palletLength / 2, -euroHeight / 2);
  root.add(palletMesh);

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

  const grid = new THREE.GridHelper(1200, 24, 0x2a2a2e, 0x1c1c1f);
  grid.rotation.x = Math.PI / 2;
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
    pickEntries: layerRenders.flatMap((layer) => layer.pickEntries),
    dispose() {
      scene.remove(root);
      root.clear();
      resources.disposeAll();
    },
  };
}
