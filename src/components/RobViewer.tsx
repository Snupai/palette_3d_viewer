"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import type { Box, PalletData } from "~/lib/robParser";
import {
  footprintSize,
  layerPlaceZ,
  layerZBottom,
  ZWISCHENLAGE_HEIGHT_MM,
} from "~/lib/robParser";

const GRIPPER_MODEL_PATH = "/models/gripper/";
const GRIPPER_OBJ = "10_01_43_00016.obj";
const GRIPPER_MTL = "10_01_43_00016.mtl";

/** OBJLoader turns a whole object into LineSegments if it contains any `l` edges — strip those first. */
function stripObjLineElements(objText: string): string {
  return objText
    .split(/\r?\n/)
    .filter((line) => !/^\s*l\s/.test(line))
    .join("\n");
}

/** Normalize CAD model (Y-up) to scene Z-up with origin at bottom center. */
function prepareGripperModel(object: THREE.Object3D): THREE.Group {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    const mats = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const mat of mats) {
      if (mat instanceof THREE.Material) {
        mat.side = THREE.DoubleSide;
        mat.visible = true;
        mat.transparent = true;
        mat.opacity = 0.3;
        mat.depthWrite = false;
        if ("wireframe" in mat) {
          (mat as THREE.MeshPhongMaterial).wireframe = false;
        }
      }
    }
    if (!geometry.getAttribute("normal")) {
      geometry.computeVertexNormals();
    }
  });

  const pivot = new THREE.Group();
  // CAD is Y-up; +90° around X maps CAD +Y → scene +Z (gripper top up).
  object.rotation.x = Math.PI / 2;
  pivot.add(object);
  pivot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(pivot);
  const center = box.getCenter(new THREE.Vector3());
  object.position.set(-center.x, -center.y, -box.min.z);
  return pivot;
}

export type BoxSelection = {
  layerIndex: number;
  boxIndex: number;
  blueNumber: number;
  placeX: number;
  placeY: number;
  /** Robot place Z = top of box (heights through this layer + Zwischenlagen; no pallet). */
  placeZ: number;
  numPackages: number;
  rotation: Box["rotation"];
  rect: Box["rect"];
  height: number;
  gripBoxCount: number;
  zwischenlage: number;
};

type BoxPickEntry = {
  layerIndex: number;
  boxIndex: number;
  blueNumber: number;
  placeX: number;
  placeY: number;
  /** Bottom face Z used for mesh placement. */
  zBottom: number;
  /** Robot place Z (top of box). */
  placeZ: number;
  numPackages: number;
  rotation: Box["rotation"];
  rect: Box["rect"];
  height: number;
  /** 0-based stack index from bottom. */
  layerNum: number;
  zwischenlage: number;
  firstFace: number;
  faceCount: number;
};

type LayerRender = {
  layerNum: number;
  solidMesh: THREE.Mesh;
  solidEdges: THREE.LineSegments;
  pickEntries: BoxPickEntry[];
};

type InterlayerRender = {
  layerNum: number;
  isAboveLayer: boolean;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  opaqueMaterial: THREE.MeshPhongMaterial;
  exposedMaterial: THREE.MeshPhongMaterial;
};

function placeOf(box: Box): {
  placeX: number;
  placeY: number;
  numPackages: number;
} {
  return {
    placeX: box.placeX ?? box.rect.x,
    placeY: box.placeY ?? box.rect.y,
    numPackages: box.numPackages ?? 1,
  };
}

function buildBoxQuads(
  box: Box,
  z: number,
  addQuad: (
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    color: THREE.Color,
  ) => void,
  colors: {
    green: THREE.Color;
    white: THREE.Color;
    red: THREE.Color;
    blue: THREE.Color;
  },
) {
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

export function RobViewer({
  data,
  visibleUpToLayer,
  onBoxSelect,
}: {
  data: PalletData;
  /** 1-based from bottom: layers 1..N solid, above hidden. */
  visibleUpToLayer: number;
  onBoxSelect?: (selection: BoxSelection | null) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const onBoxSelectRef = useRef(onBoxSelect);
  onBoxSelectRef.current = onBoxSelect;

  const layerRendersRef = useRef<LayerRender[]>([]);
  const interlayerRendersRef = useRef<InterlayerRender[]>([]);
  const highlightGroupRef = useRef<THREE.Group | null>(null);
  const applyHighlightRef = useRef<((entry: BoxPickEntry) => void) | null>(
    null,
  );
  const clearHighlightRef = useRef<(() => void) | null>(null);
  const selectedEntryRef = useRef<BoxPickEntry | null>(null);
  const visibleUpToRef = useRef(visibleUpToLayer);
  visibleUpToRef.current = visibleUpToLayer;

  // Build / rebuild scene when pallet data changes
  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050b18);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      1,
      10000,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(1400, 1000, 1400);
    camera.lookAt(new THREE.Vector3(600, 400, 300));
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050b18, 1);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 1, 2);
    scene.add(dir);

    const green = new THREE.Color("#00ff88");
    const white = new THREE.Color("#eeeeee");
    const red = new THREE.Color("#ff3355");
    const blue = new THREE.Color("#3388ff");
    const faceColorSet = { green, white, red, blue };

    const solidMat = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 5,
      side: THREE.DoubleSide,
      transparent: false,
      depthTest: true,
      depthWrite: true,
    });
    solidMat.polygonOffset = true;
    solidMat.polygonOffsetFactor = 2;
    solidMat.polygonOffsetUnits = 4;

    const solidEdgeMat = new THREE.LineBasicMaterial({
      color: 0x0f172a,
      opacity: 0.85,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
    const interlayerMat = new THREE.MeshPhongMaterial({
      color: 0xd6c49a,
      shininess: 3,
      side: THREE.DoubleSide,
    });
    const topInterlayerMat = new THREE.MeshPhongMaterial({
      color: 0xd6c49a,
      shininess: 3,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const interlayerEdgeMat = new THREE.LineBasicMaterial({
      color: 0xffedbd,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false,
    });

    const layerRenders: LayerRender[] = [];
    const interlayerRenders: InterlayerRender[] = [];
    const allBounds = new THREE.Box3();
    let hasBounds = false;

    for (let layerIdx = 0; layerIdx < data.layers.length; layerIdx++) {
      const layer = data.layers[layerIdx]!;
      const layerNum = layerIdx; // 0 = bottom (first in .rob layer order)
      const zBottom = layerZBottom(data.layers, layerIdx, data.package.height);
      const placeZ = layerPlaceZ(data.layers, layerIdx, data.package.height);

      const positions: number[] = [];
      const vertexColors: number[] = [];
      const indices: number[] = [];
      const edgePositions: number[] = [];
      const pickEntries: BoxPickEntry[] = [];
      let faceCursor = 0;

      const addQuad = (
        a: THREE.Vector3,
        b: THREE.Vector3,
        c: THREE.Vector3,
        d: THREE.Vector3,
        color: THREE.Color,
      ) => {
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
        for (let i = 0; i < 4; i++)
          vertexColors.push(color.r, color.g, color.b);
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

      for (let boxIdx = 0; boxIdx < layer.boxes.length; boxIdx++) {
        const box = layer.boxes[boxIdx]!;
        const firstFace = faceCursor;
        const { placeX, placeY, numPackages } = placeOf(box);
        buildBoxQuads(box, zBottom, addQuad, faceColorSet);
        faceCursor += 12;
        pickEntries.push({
          layerIndex: layerIdx,
          boxIndex: boxIdx,
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
          zwischenlage: layer.zwischenlage ?? 0,
          firstFace,
          faceCount: 12,
        });
      }

      if (positions.length === 0) continue;

      const geometry = new THREE.BufferGeometry();
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

      const solidMesh = new THREE.Mesh(geometry, solidMat);
      scene.add(solidMesh);

      const edgeGeom = new THREE.BufferGeometry();
      edgeGeom.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(edgePositions, 3),
      );
      const solidEdges = new THREE.LineSegments(edgeGeom, solidEdgeMat);
      solidEdges.renderOrder = 2;
      scene.add(solidEdges);

      layerRenders.push({
        layerNum,
        solidMesh,
        solidEdges,
        pickEntries,
      });
    }

    const interlayerWidth = data.pallet?.width ?? 1200;
    const interlayerLength = data.pallet?.length ?? 800;
    const addInterlayerRender = (
      layerNum: number,
      bottomZ: number,
      count: number,
      isAboveLayer: boolean,
    ) => {
      const normalizedCount = Math.max(0, Math.trunc(count));
      if (normalizedCount === 0) return;
      const height = normalizedCount * ZWISCHENLAGE_HEIGHT_MM;
      const geometry = new THREE.BoxGeometry(
        interlayerWidth,
        interlayerLength,
        height,
      );
      const mesh = new THREE.Mesh(geometry, interlayerMat);
      mesh.position.set(
        interlayerWidth / 2,
        interlayerLength / 2,
        bottomZ + height / 2,
      );
      mesh.renderOrder = 0;
      scene.add(mesh);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        interlayerEdgeMat,
      );
      edges.position.copy(mesh.position);
      edges.renderOrder = 2;
      scene.add(edges);
      interlayerRenders.push({
        layerNum,
        isAboveLayer,
        mesh,
        edges,
        opaqueMaterial: interlayerMat,
        exposedMaterial: topInterlayerMat,
      });

      allBounds.union(
        new THREE.Box3().setFromCenterAndSize(
          mesh.position,
          new THREE.Vector3(interlayerWidth, interlayerLength, height),
        ),
      );
      hasBounds = true;
    };

    if (data.layers.length > 0) {
      addInterlayerRender(0, 0, data.layers[0]?.zwischenlage ?? 0, false);
      for (let layerIdx = 0; layerIdx < data.layers.length - 1; layerIdx++) {
        addInterlayerRender(
          layerIdx,
          layerPlaceZ(data.layers, layerIdx, data.package.height),
          data.layers[layerIdx + 1]?.zwischenlage ?? 0,
          true,
        );
      }
      const topLayerIdx = data.layers.length - 1;
      addInterlayerRender(
        topLayerIdx,
        layerPlaceZ(data.layers, topLayerIdx, data.package.height),
        data.trailingZwischenlage ?? 0,
        true,
      );
    }

    layerRendersRef.current = layerRenders;
    interlayerRendersRef.current = interlayerRenders;

    const applyLayerVisibility = (upTo: number) => {
      const maxSolid = Math.min(
        Math.max(1, upTo),
        Math.max(1, data.layers.length),
      );
      for (const lr of layerRenders) {
        const solid = lr.layerNum + 1 <= maxSolid;
        lr.solidMesh.visible = solid;
        lr.solidEdges.visible = solid;
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
    };
    applyLayerVisibility(visibleUpToRef.current);

    const euroWidth = 1200;
    const euroLength = 800;
    const euroHeight = 144;
    const palletGeom = new THREE.BoxGeometry(euroWidth, euroLength, euroHeight);
    const palletMat = new THREE.MeshPhongMaterial({
      color: 0xb38b6d,
      shininess: 10,
      side: THREE.DoubleSide,
    });
    const palletMesh = new THREE.Mesh(palletGeom, palletMat);
    palletMesh.position.set(euroWidth / 2, euroLength / 2, -euroHeight / 2);
    palletMat.polygonOffset = true;
    palletMat.polygonOffsetFactor = 1;
    palletMat.polygonOffsetUnits = 2;
    scene.add(palletMesh);
    const palletEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(palletGeom),
      new THREE.LineBasicMaterial({
        color: 0x2b2b2b,
        transparent: true,
        opacity: 0.9,
      }),
    );
    palletEdges.position.copy(palletMesh.position);
    palletEdges.renderOrder = 2;
    scene.add(palletEdges);

    const grid = new THREE.GridHelper(1200, 24, 0x1f2a37, 0x111827);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const axes = new THREE.AxesHelper(400);
    scene.add(axes);

    const highlightGroup = new THREE.Group();
    highlightGroup.renderOrder = 3;
    scene.add(highlightGroup);
    highlightGroupRef.current = highlightGroup;

    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0xffdd33,
      transparent: true,
      opacity: 0.35,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const highlightEdgeMat = new THREE.LineBasicMaterial({
      color: 0xffee66,
      transparent: true,
      opacity: 0.95,
      depthTest: true,
      depthWrite: false,
    });
    const placeMarkerMat = new THREE.MeshBasicMaterial({
      color: 0xffcc00,
      depthTest: true,
      depthWrite: false,
    });

    const gripperHolder = new THREE.Group();
    gripperHolder.visible = false;
    gripperHolder.renderOrder = 4;
    scene.add(gripperHolder);
    let gripperModel: THREE.Group | null = null;
    let cancelled = false;

    const mtlLoader = new MTLLoader();
    mtlLoader.setPath(GRIPPER_MODEL_PATH);
    mtlLoader.load(
      GRIPPER_MTL,
      (materials) => {
        if (cancelled) return;
        materials.preload();
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        fetch(`${GRIPPER_MODEL_PATH}${GRIPPER_OBJ}`)
          .then((res) => {
            if (!res.ok)
              throw new Error(`Failed to load gripper OBJ (${res.status})`);
            return res.text();
          })
          .then((objText) => {
            if (cancelled) return;
            const obj = objLoader.parse(stripObjLineElements(objText));
            gripperModel = prepareGripperModel(obj);
            gripperHolder.clear();
            gripperHolder.add(gripperModel);
            const selected = selectedEntryRef.current;
            if (selected) applyHighlightRef.current?.(selected);
          })
          .catch(() => {
            // Keep sphere fallback if OBJ fails to load
          });
      },
      undefined,
      () => {
        // Keep sphere fallback if MTL fails to load
      },
    );

    const clearHighlight = () => {
      gripperHolder.visible = false;
      while (highlightGroup.children.length > 0) {
        const child = highlightGroup.children[0]!;
        highlightGroup.remove(child);
        if (
          child instanceof THREE.Mesh ||
          child instanceof THREE.LineSegments ||
          child instanceof THREE.Line
        ) {
          (child.geometry as THREE.BufferGeometry).dispose();
        }
      }
    };
    clearHighlightRef.current = clearHighlight;

    const allPickEntries = () => layerRenders.flatMap((lr) => lr.pickEntries);

    const applyHighlight = (entry: BoxPickEntry) => {
      clearHighlight();
      const maxSolid = Math.min(
        Math.max(1, visibleUpToRef.current),
        Math.max(1, data.layers.length),
      );
      if (entry.layerNum + 1 > maxSolid) return;

      const gripBoxes = allPickEntries().filter(
        (e) =>
          e.layerIndex === entry.layerIndex &&
          e.blueNumber === entry.blueNumber,
      );

      for (const grip of gripBoxes) {
        const { width, length } = footprintSize(grip);
        const z = grip.zBottom;
        const geo = new THREE.BoxGeometry(
          width * 1.02,
          length * 1.02,
          grip.height * 1.02,
        );
        const overlay = new THREE.Mesh(geo, highlightMat);
        overlay.position.set(grip.rect.x, grip.rect.y, z + grip.height / 2);
        highlightGroup.add(overlay);

        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(geo),
          highlightEdgeMat,
        );
        edges.position.copy(overlay.position);
        highlightGroup.add(edges);
      }

      // Gripper (or sphere fallback) at place point on package top
      if (gripperModel) {
        // Single short packages: yaw gripper +90° (scene Z-up) so jaws align.
        const shortSingle =
          entry.numPackages === 1 && data.package.length < 265 ? 90 : 0;
        gripperHolder.position.set(entry.placeX, entry.placeY, entry.placeZ);
        gripperHolder.rotation.z = THREE.MathUtils.degToRad(
          entry.rotation + shortSingle,
        );
        gripperHolder.visible = true;
      } else {
        const markerZ = entry.placeZ + 20;
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(18, 12, 12),
          placeMarkerMat,
        );
        marker.position.set(entry.placeX, entry.placeY, markerZ);
        highlightGroup.add(marker);

        const stemGeom = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(entry.placeX, entry.placeY, entry.placeZ),
          new THREE.Vector3(entry.placeX, entry.placeY, markerZ),
        ]);
        highlightGroup.add(new THREE.Line(stemGeom, highlightEdgeMat));
      }
    };
    applyHighlightRef.current = applyHighlight;

    let centerForControls: THREE.Vector3 | null = null;
    let maxOrbitDistance = camera.far * 0.8;
    if (hasBounds && !allBounds.isEmpty()) {
      const size = new THREE.Vector3();
      allBounds.getSize(size);
      const center = new THREE.Vector3();
      allBounds.getCenter(center);
      const boundingSphere = new THREE.Sphere();
      allBounds.getBoundingSphere(boundingSphere);
      centerForControls = center.clone();
      const maxSize = Math.max(size.x, size.y, size.z);
      const distance = maxSize * 1.8 + 500;
      camera.position.set(
        center.x + distance,
        center.y + distance,
        center.z + distance,
      );
      camera.lookAt(center);

      const initialOrbitDistance = camera.position.distanceTo(center);
      maxOrbitDistance = initialOrbitDistance * 3;
      camera.near = THREE.MathUtils.clamp(boundingSphere.radius / 100, 1, 10);
      camera.far = maxOrbitDistance + boundingSphere.radius * 2;
      camera.updateProjectionMatrix();
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.maxDistance = maxOrbitDistance;
    controls.target.copy(centerForControls ?? new THREE.Vector3(600, 400, 300));
    controls.update();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown: { x: number; y: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      pointerDown = { x: event.clientX, y: event.clientY };
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!pointerDown) return;
      const dx = event.clientX - pointerDown.x;
      const dy = event.clientY - pointerDown.y;
      pointerDown = null;
      if (dx * dx + dy * dy > 25) return;

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const solidMeshes = layerRenders
        .filter((lr) => lr.solidMesh.visible)
        .map((lr) => lr.solidMesh);
      const hits = raycaster.intersectObjects(solidMeshes, false);
      const hit = hits[0];
      if (hit?.faceIndex == null || !(hit.object instanceof THREE.Mesh)) {
        selectedEntryRef.current = null;
        clearHighlight();
        onBoxSelectRef.current?.(null);
        return;
      }

      const layerRender = layerRenders.find(
        (lr) => lr.solidMesh === hit.object,
      );
      if (!layerRender) {
        selectedEntryRef.current = null;
        clearHighlight();
        onBoxSelectRef.current?.(null);
        return;
      }

      const entry =
        layerRender.pickEntries.find(
          (e) =>
            hit.faceIndex! >= e.firstFace &&
            hit.faceIndex! < e.firstFace + e.faceCount,
        ) ?? null;
      if (!entry) {
        selectedEntryRef.current = null;
        clearHighlight();
        onBoxSelectRef.current?.(null);
        return;
      }

      selectedEntryRef.current = entry;
      applyHighlight(entry);
      const gripBoxCount = allPickEntries().filter(
        (e) =>
          e.layerIndex === entry.layerIndex &&
          e.blueNumber === entry.blueNumber,
      ).length;
      onBoxSelectRef.current?.({
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
        gripBoxCount,
        zwischenlage: entry.zwischenlage,
      });
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const onResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const { clientWidth, clientHeight } = container;
      rendererRef.current.setSize(clientWidth, clientHeight);
      cameraRef.current.aspect = clientWidth / clientHeight;
      cameraRef.current.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      if (rendererRef.current && cameraRef.current && sceneRef.current) {
        controls.update();
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      } else {
        renderer.render(scene, camera);
      }
    };
    animate();
    onResize();
    selectedEntryRef.current = null;
    onBoxSelectRef.current?.(null);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      selectedEntryRef.current = null;
      clearHighlight();
      highlightMat.dispose();
      highlightEdgeMat.dispose();
      placeMarkerMat.dispose();
      solidMat.dispose();
      solidEdgeMat.dispose();
      interlayerMat.dispose();
      topInterlayerMat.dispose();
      interlayerEdgeMat.dispose();
      for (const interlayer of interlayerRenders) {
        interlayer.mesh.geometry.dispose();
        interlayer.edges.geometry.dispose();
      }
      gripperHolder.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        (obj.geometry as THREE.BufferGeometry).dispose();
        const mats = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        for (const mat of mats) {
          (mat as THREE.Material).dispose();
        }
      });
      layerRendersRef.current = [];
      interlayerRendersRef.current = [];
      highlightGroupRef.current = null;
      applyHighlightRef.current = null;
      clearHighlightRef.current = null;
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (rendererRef.current.domElement.parentElement) {
          rendererRef.current.domElement.parentElement.removeChild(
            rendererRef.current.domElement,
          );
        }
        rendererRef.current = null;
      }
      controls.dispose();
      scene.clear();
    };
  }, [data]);

  // Update layer visibility without rebuilding the scene
  useEffect(() => {
    const layerRenders = layerRendersRef.current;
    const interlayerRenders = interlayerRendersRef.current;
    if (layerRenders.length === 0 && interlayerRenders.length === 0) return;
    const maxSolid = Math.min(
      Math.max(1, visibleUpToLayer),
      Math.max(1, data.layers.length),
    );
    for (const lr of layerRenders) {
      const solid = lr.layerNum + 1 <= maxSolid;
      lr.solidMesh.visible = solid;
      lr.solidEdges.visible = solid;
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
    // Keep selection if its layer is still visible; otherwise clear
    const selected = selectedEntryRef.current;
    if (selected && selected.layerNum + 1 <= maxSolid) {
      applyHighlightRef.current?.(selected);
    } else if (selected) {
      selectedEntryRef.current = null;
      clearHighlightRef.current?.();
      onBoxSelectRef.current?.(null);
    } else {
      clearHighlightRef.current?.();
    }
  }, [visibleUpToLayer, data.layers.length]);

  return (
    <div
      ref={mountRef}
      className="relative h-full min-h-[320px] w-full sm:min-h-[420px] xl:min-h-[600px]"
    />
  );
}
