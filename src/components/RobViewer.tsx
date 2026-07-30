"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Box, PalletData } from "~/lib/robParser";
import { layerPlaceZ, layerZBottom } from "~/lib/robParser";

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

function placeOf(box: Box): { placeX: number; placeY: number; numPackages: number } {
  return {
    placeX: box.placeX ?? box.rect.x,
    placeY: box.placeY ?? box.rect.y,
    numPackages: box.numPackages ?? 1,
  };
}

function buildBoxQuads(
  box: Box,
  z: number,
  addQuad: (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color) => void,
  colors: { green: THREE.Color; white: THREE.Color; red: THREE.Color; blue: THREE.Color },
) {
  let width = box.rect.length;
  let length = box.rect.width;
  if (box.rotation === 90 || box.rotation === 270) {
    width = box.rect.width;
    length = box.rect.length;
  }
  const height = box.height;

  const v0 = new THREE.Vector3(box.rect.x - width / 2, box.rect.y - length / 2, z);
  const v1 = new THREE.Vector3(box.rect.x + width / 2, box.rect.y - length / 2, z);
  const v2 = new THREE.Vector3(box.rect.x + width / 2, box.rect.y + length / 2, z);
  const v3 = new THREE.Vector3(box.rect.x - width / 2, box.rect.y + length / 2, z);
  const v4 = new THREE.Vector3(box.rect.x - width / 2, box.rect.y - length / 2, z + height);
  const v5 = new THREE.Vector3(box.rect.x + width / 2, box.rect.y - length / 2, z + height);
  const v6 = new THREE.Vector3(box.rect.x + width / 2, box.rect.y + length / 2, z + height);
  const v7 = new THREE.Vector3(box.rect.x - width / 2, box.rect.y + length / 2, z + height);

  const faceColors: [THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color, THREE.Color] =
    box.rotation === 0
      ? [colors.green, colors.green, colors.white, colors.red, colors.blue, colors.blue]
      : box.rotation === 90
      ? [colors.green, colors.green, colors.blue, colors.blue, colors.red, colors.white]
      : box.rotation === 180
      ? [colors.green, colors.green, colors.red, colors.white, colors.blue, colors.blue]
      : [colors.green, colors.green, colors.blue, colors.blue, colors.white, colors.red];

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
  const highlightGroupRef = useRef<THREE.Group | null>(null);
  const applyHighlightRef = useRef<((entry: BoxPickEntry) => void) | null>(null);
  const clearHighlightRef = useRef<(() => void) | null>(null);
  const visibleUpToRef = useRef(visibleUpToLayer);
  visibleUpToRef.current = visibleUpToLayer;

  // Build / rebuild scene when pallet data changes
  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x050b18);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
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

    const layerRenders: LayerRender[] = [];
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
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        for (let i = 0; i < 4; i++) vertexColors.push(color.r, color.g, color.b);
        edgePositions.push(
          a.x, a.y, a.z, b.x, b.y, b.z,
          b.x, b.y, b.z, c.x, c.y, c.z,
          c.x, c.y, c.z, d.x, d.y, d.z,
          d.x, d.y, d.z, a.x, a.y, a.z,
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
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setIndex(indices);
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      if (geometry.boundingBox) {
        allBounds.union(geometry.boundingBox);
        hasBounds = true;
      }

      const solidMesh = new THREE.Mesh(geometry, solidMat);
      scene.add(solidMesh);

      const edgeGeom = new THREE.BufferGeometry();
      edgeGeom.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
      const solidEdges = new THREE.LineSegments(edgeGeom, solidEdgeMat);
      solidEdges.renderOrder = 2;
      scene.add(solidEdges);

      layerRenders.push({ layerNum, solidMesh, solidEdges, pickEntries });
    }

    layerRendersRef.current = layerRenders;

    const applyLayerVisibility = (upTo: number) => {
      const maxSolid = Math.min(Math.max(1, upTo), Math.max(1, data.layers.length));
      for (const lr of layerRenders) {
        const solid = lr.layerNum + 1 <= maxSolid;
        lr.solidMesh.visible = solid;
        lr.solidEdges.visible = solid;
      }
    };
    applyLayerVisibility(visibleUpToRef.current);

    const euroWidth = 1200;
    const euroLength = 800;
    const euroHeight = 144;
    const palletGeom = new THREE.BoxGeometry(euroWidth, euroLength, euroHeight);
    const palletMat = new THREE.MeshPhongMaterial({ color: 0xb38b6d, shininess: 10, side: THREE.DoubleSide });
    const palletMesh = new THREE.Mesh(palletGeom, palletMat);
    palletMesh.position.set(euroWidth / 2, euroLength / 2, -euroHeight / 2);
    palletMat.polygonOffset = true;
    palletMat.polygonOffsetFactor = 1;
    palletMat.polygonOffsetUnits = 2;
    scene.add(palletMesh);
    const palletEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(palletGeom),
      new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.9 }),
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

    const clearHighlight = () => {
      while (highlightGroup.children.length > 0) {
        const child = highlightGroup.children[0]!;
        highlightGroup.remove(child);
        if (
          child instanceof THREE.Mesh ||
          child instanceof THREE.LineSegments ||
          child instanceof THREE.Line
        ) {
          child.geometry.dispose();
        }
      }
    };
    clearHighlightRef.current = clearHighlight;

    const allPickEntries = () => layerRenders.flatMap((lr) => lr.pickEntries);

    const applyHighlight = (entry: BoxPickEntry) => {
      clearHighlight();
      const maxSolid = Math.min(Math.max(1, visibleUpToRef.current), Math.max(1, data.layers.length));
      if (entry.layerNum + 1 > maxSolid) return;

      const gripBoxes = allPickEntries().filter(
        (e) => e.layerIndex === entry.layerIndex && e.blueNumber === entry.blueNumber,
      );

      for (const grip of gripBoxes) {
        let width = grip.rect.length;
        let length = grip.rect.width;
        if (grip.rotation === 90 || grip.rotation === 270) {
          width = grip.rect.width;
          length = grip.rect.length;
        }
        const z = grip.zBottom;
        const geo = new THREE.BoxGeometry(width * 1.02, length * 1.02, grip.height * 1.02);
        const overlay = new THREE.Mesh(geo, highlightMat);
        overlay.position.set(grip.rect.x, grip.rect.y, z + grip.height / 2);
        highlightGroup.add(overlay);

        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), highlightEdgeMat);
        edges.position.copy(overlay.position);
        highlightGroup.add(edges);
      }

      // Marker sits just above the box top (= place Z)
      const markerZ = entry.placeZ + 20;
      const marker = new THREE.Mesh(new THREE.SphereGeometry(18, 12, 12), placeMarkerMat);
      marker.position.set(entry.placeX, entry.placeY, markerZ);
      highlightGroup.add(marker);

      const stemGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(entry.placeX, entry.placeY, entry.placeZ),
        new THREE.Vector3(entry.placeX, entry.placeY, markerZ),
      ]);
      highlightGroup.add(new THREE.Line(stemGeom, highlightEdgeMat));
    };
    applyHighlightRef.current = applyHighlight;

    let centerForControls: THREE.Vector3 | null = null;
    if (hasBounds && !allBounds.isEmpty()) {
      const size = new THREE.Vector3();
      allBounds.getSize(size);
      const center = new THREE.Vector3();
      allBounds.getCenter(center);
      centerForControls = center.clone();
      const maxSize = Math.max(size.x, size.y, size.z);
      const distance = maxSize * 1.8 + 500;
      camera.position.set(center.x + distance, center.y + distance, center.z + distance);
      camera.lookAt(center);
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
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

      const solidMeshes = layerRenders.filter((lr) => lr.solidMesh.visible).map((lr) => lr.solidMesh);
      const hits = raycaster.intersectObjects(solidMeshes, false);
      const hit = hits[0];
      if (!hit || hit.faceIndex == null || !(hit.object instanceof THREE.Mesh)) {
        clearHighlight();
        onBoxSelectRef.current?.(null);
        return;
      }

      const layerRender = layerRenders.find((lr) => lr.solidMesh === hit.object);
      if (!layerRender) {
        clearHighlight();
        onBoxSelectRef.current?.(null);
        return;
      }

      const entry =
        layerRender.pickEntries.find(
          (e) => hit.faceIndex! >= e.firstFace && hit.faceIndex! < e.firstFace + e.faceCount,
        ) ?? null;
      if (!entry) {
        clearHighlight();
        onBoxSelectRef.current?.(null);
        return;
      }

      applyHighlight(entry);
      const gripBoxCount = allPickEntries().filter(
        (e) => e.layerIndex === entry.layerIndex && e.blueNumber === entry.blueNumber,
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
    onBoxSelectRef.current?.(null);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      clearHighlight();
      highlightMat.dispose();
      highlightEdgeMat.dispose();
      placeMarkerMat.dispose();
      solidMat.dispose();
      solidEdgeMat.dispose();
      layerRendersRef.current = [];
      highlightGroupRef.current = null;
      applyHighlightRef.current = null;
      clearHighlightRef.current = null;
      if (rendererRef.current) {
        rendererRef.current.dispose();
        if (rendererRef.current.domElement.parentElement) {
          rendererRef.current.domElement.parentElement.removeChild(rendererRef.current.domElement);
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
    if (layerRenders.length === 0) return;
    const maxSolid = Math.min(Math.max(1, visibleUpToLayer), Math.max(1, data.layers.length));
    for (const lr of layerRenders) {
      const solid = lr.layerNum + 1 <= maxSolid;
      lr.solidMesh.visible = solid;
      lr.solidEdges.visible = solid;
    }
    // Clear selection highlight if it was on a now-hidden layer
    clearHighlightRef.current?.();
    onBoxSelectRef.current?.(null);
  }, [visibleUpToLayer, data.layers.length]);

  return <div ref={mountRef} className="relative h-full w-full min-h-[320px] sm:min-h-[420px] xl:min-h-[600px]" />;
}
