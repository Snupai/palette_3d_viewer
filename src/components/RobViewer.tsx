"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PalletData, Rotation } from "~/lib/robParser";

export function RobViewer({ data }: { data: PalletData }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  //

  useEffect(() => {
    if (!mountRef.current) return;

    const container = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0b10);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 10000);
    camera.up.set(0, 0, 1); // Z-up like matplotlib
    camera.position.set(1400, 1000, 1400);
    camera.lookAt(new THREE.Vector3(600, 400, 300));
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x0b0b10, 1);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    if (process.env.NODE_ENV !== "production") {
      console.log("RobViewer container dims:", container.clientWidth, container.clientHeight);
    }

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 1, 2);
    scene.add(dir);

    // Build geometry again here to actually render
    const positions: number[] = [];
    const vertexColors: number[] = [];
    const indices: number[] = [];
    const edgePositions: number[] = [];
    let maxZLocal = 0;

    const addQuad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color) => {
      const base = positions.length / 3;
      positions.push(
        a.x, a.y, a.z,
        b.x, b.y, b.z,
        c.x, c.y, c.z,
        d.x, d.y, d.z,
      );
      // two triangles using shared vertices
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      // per-vertex color
      for (let i = 0; i < 4; i++) vertexColors.push(color.r, color.g, color.b);
      // edge segments for stroke overlay (a-b, b-c, c-d, d-a)
      edgePositions.push(
        a.x, a.y, a.z, b.x, b.y, b.z,
        b.x, b.y, b.z, c.x, c.y, c.z,
        c.x, c.y, c.z, d.x, d.y, d.z,
        d.x, d.y, d.z, a.x, a.y, a.z,
      );
    };

    const green = new THREE.Color("#00ff88");
    const white = new THREE.Color("#eeeeee");
    const red = new THREE.Color("#ff3355");
    const blue = new THREE.Color("#3388ff");

    for (let layerIdx = data.layers.length - 1; layerIdx >= 0; layerIdx--) {
      const layer = data.layers[layerIdx]!;
      const layerNum = data.layers.length - layerIdx - 1;
      for (const box of layer.boxes) {
        let width = box.rect.length;
        let length = box.rect.width;
        if (box.rotation === 90 || box.rotation === 270) {
          width = box.rect.width;
          length = box.rect.length;
        }
        const z = layerNum * box.height;
        const height = box.height;
        maxZLocal = Math.max(maxZLocal, z + height);

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
            ? [green, green, white, red, blue, blue]
            : box.rotation === 90
            ? [green, green, blue, blue, red, white]
            : box.rotation === 180
            ? [green, green, red, white, blue, blue]
            : [green, green, blue, blue, white, red];

        addQuad(v0, v1, v2, v3, faceColors[0]);
        addQuad(v4, v5, v6, v7, faceColors[1]);
        addQuad(v0, v1, v5, v4, faceColors[2]);
        addQuad(v2, v3, v7, v6, faceColors[3]);
        addQuad(v0, v3, v7, v4, faceColors[4]);
        addQuad(v1, v2, v6, v5, faceColors[5]);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
    geometry.computeVertexNormals();

    if (process.env.NODE_ENV !== "production") {
      console.log("RobViewer geometry stats:", {
        vertices: positions.length / 3,
        triangles: indices.length / 3,
        colors: vertexColors.length / 3,
        maxZLocal,
        layers: data.layer_count,
        total_boxes: data.total_boxes,
      });
    }

    const material = new THREE.MeshPhongMaterial({
      vertexColors: true,
      shininess: 5,
      side: THREE.DoubleSide,
      transparent: false,
      depthTest: true,
      depthWrite: true,
    });
    // Push the mesh slightly back in the depth buffer so overlay lines don't z-fight
    material.polygonOffset = true;
    material.polygonOffsetFactor = 2;
    material.polygonOffsetUnits = 4;
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    // Slight edge stroke overlay (per-quad explicit edges to preserve grid lines)
    const edgeGeom = new THREE.BufferGeometry();
    edgeGeom.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x0b0b0b, opacity: 0.85, transparent: true, depthTest: true, depthWrite: false });
    const edgeLines = new THREE.LineSegments(edgeGeom, edgeMaterial);
    edgeLines.renderOrder = 2; // render after mesh but still depth-tested
    scene.add(edgeLines);

    // Euro pallet below boxes: 1200 x 800 x 144 (Z-up -> depth is height)
    const euroWidth = 1200;
    const euroLength = 800;
    const euroHeight = 144;
    const palletGeom = new THREE.BoxGeometry(euroWidth, euroLength, euroHeight);
    const palletMat = new THREE.MeshPhongMaterial({ color: 0xb38b6d, shininess: 10, side: THREE.DoubleSide });
    const palletMesh = new THREE.Mesh(palletGeom, palletMat);
    palletMesh.position.set(euroWidth / 2, euroLength / 2, -euroHeight / 2);
    // Nudge back to avoid z-fighting with grid
    palletMat.polygonOffset = true;
    palletMat.polygonOffsetFactor = 1;
    palletMat.polygonOffsetUnits = 2;
    scene.add(palletMesh);
    const palletEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(palletGeom),
      new THREE.LineBasicMaterial({ color: 0x2b2b2b, transparent: true, opacity: 0.9 })
    );
    palletEdges.position.copy(palletMesh.position);
    palletEdges.renderOrder = 2;
    scene.add(palletEdges);

    const grid = new THREE.GridHelper(1200, 24, 0x666666, 0x333333);
    // Grid in X-Y plane: rotate from XZ default to XY
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const axes = new THREE.AxesHelper(400);
    scene.add(axes);

    // Fit camera to mesh bounds
    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;
    let centerForControls: THREE.Vector3 | null = null;
    if (bbox) {
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      centerForControls = center.clone();
      if (process.env.NODE_ENV !== "production") {
        console.log("RobViewer bbox:", { size: { x: size.x, y: size.y, z: size.z }, center: { x: center.x, y: center.y, z: center.z } });
      }
      // Place camera diagonally away from center based on scene size
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
        // fallback to local refs if available
        renderer.render(scene, camera);
      }
    };
    animate();

    onResize();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
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

  return <div ref={mountRef} className="relative h-full w-full min-h-[600px]" />;
}


