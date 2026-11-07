/**
 * Converts the UR10e Collada visual meshes into one decoder-free GLB with one
 * node per URDF link. Each link node is the URDF link frame; its child mesh
 * node carries the geometry baked from the Collada node transforms and the
 * URDF `<visual><origin>`, so the viewer only sets link transforms from the
 * kinematic chain. Positions are quantized to 0.1 mm (int16) and normals to
 * int8 via `KHR_mesh_quantization`, which GLTFLoader reads without a decoder.
 *
 *   bun run scripts/convert-ur10e-meshes.ts <ur10e-folder> <output.glb>
 *
 * `<ur10e-folder>` contains `ur10e.urdf` and `meshes/*.dae` generated from
 * Universal_Robots_ROS2_Description (see `public/models/ur10e/README.md`).
 * Identical input files produce byte-identical output.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as THREE from "three";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";

type Visual = {
  link: string;
  mesh: string;
  rpy: [number, number, number];
  xyz: [number, number, number];
};

type Primitive = {
  material: string;
  color: number[];
  geometry: THREE.BufferGeometry;
};

type Gltf = {
  asset: { version: "2.0"; generator: string; copyright: string };
  extensionsUsed: string[];
  extensionsRequired: string[];
  scene: 0;
  scenes: [{ nodes: number[] }];
  nodes: Array<{
    name: string;
    mesh?: number;
    children?: number[];
    scale?: [number, number, number];
  }>;
  meshes: Array<{
    name: string;
    primitives: Array<{
      attributes: { POSITION: number; NORMAL: number };
      indices: number;
      material: number;
    }>;
  }>;
  materials: Array<{
    name: string;
    pbrMetallicRoughness: {
      baseColorFactor: number[];
      metallicFactor: number;
      roughnessFactor: number;
    };
  }>;
  accessors: Array<Record<string, unknown>>;
  bufferViews: Array<Record<string, unknown>>;
  buffers: [{ byteLength: number }];
};

/** Quantized positions are integer multiples of this step in metres (0.1 mm). */
const POSITION_STEP_M = 1e-4;

const [sourceDirArg, outputArg] = process.argv.slice(2);
if (!sourceDirArg || !outputArg) {
  console.error(
    "Usage: bun run scripts/convert-ur10e-meshes.ts <ur10e-folder> <output.glb>",
  );
  process.exit(1);
}
const sourceDir = resolve(sourceDirArg);
const outputPath = resolve(outputArg);

// jsdom ships no type declarations (dev dependency only for tests); a
// non-literal specifier keeps tsc from resolving them. Only DOMParser is used.
const jsdomModule = "jsdom";
const { JSDOM } = (await import(jsdomModule)) as {
  JSDOM: new (html: string) => { window: { DOMParser: typeof DOMParser } };
};
const dom = new JSDOM("");
(globalThis as { DOMParser?: unknown }).DOMParser = dom.window.DOMParser;

function numbers(value: string | null | undefined): number[] {
  return (value ?? "0 0 0").trim().split(/\s+/).map(Number);
}

function readVisuals(urdfText: string): Visual[] {
  const document = new dom.window.DOMParser().parseFromString(
    urdfText,
    "application/xml",
  );
  const visuals: Visual[] = [];
  for (const link of Array.from(document.getElementsByTagName("link"))) {
    const visual = link.getElementsByTagName("visual")[0];
    const mesh = visual?.getElementsByTagName("mesh")[0];
    if (!visual || !mesh) continue;
    const origin = visual.getElementsByTagName("origin")[0];
    visuals.push({
      link: link.getAttribute("name")!,
      mesh: mesh.getAttribute("filename")!,
      rpy: numbers(origin?.getAttribute("rpy")) as Visual["rpy"],
      xyz: numbers(origin?.getAttribute("xyz")) as Visual["xyz"],
    });
  }
  return visuals;
}

/** URDF rpy is fixed-axis roll/pitch/yaw: Rz(yaw) * Ry(pitch) * Rx(roll). */
function urdfOrigin(rpy: Visual["rpy"], xyz: Visual["xyz"]): THREE.Matrix4 {
  const rotation = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(rpy[0], rpy[1], rpy[2], "ZYX"),
  );
  return new THREE.Matrix4()
    .makeTranslation(xyz[0], xyz[1], xyz[2])
    .multiply(rotation);
}

function concatenate(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const total = parts.reduce(
    (sum, part) => sum + part.getAttribute("position").count,
    0,
  );
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  let offset = 0;
  for (const part of parts) {
    positions.set(
      part.getAttribute("position").array as Float32Array,
      offset * 3,
    );
    normals.set(part.getAttribute("normal").array as Float32Array, offset * 3);
    offset += part.getAttribute("position").count;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

function linkPrimitives(visual: Visual): Primitive[] {
  const text = readFileSync(join(sourceDir, visual.mesh), "utf8");
  const scene = new ColladaLoader().parse(text, "").scene;
  // ColladaLoader turns Z-up assets into Y-up by rotating the scene; URDF
  // expects the native Collada axes, so undo that and keep unit scaling.
  scene.rotation.set(0, 0, 0);
  scene.updateMatrixWorld(true);
  const visualMatrix = urdfOrigin(visual.rpy, visual.xyz);
  const byMaterial = new Map<
    string,
    { material: string; color: number[]; parts: THREE.BufferGeometry[] }
  >();
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    const source = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry;
    const position = source.getAttribute("position");
    const normal = source.getAttribute("normal");
    const groups =
      source.groups.length > 0
        ? source.groups
        : [{ start: 0, count: position.count, materialIndex: 0 }];
    const transform = new THREE.Matrix4().multiplyMatrices(
      visualMatrix,
      mesh.matrixWorld,
    );
    for (const group of groups) {
      const material = materials[
        group.materialIndex ?? 0
      ] as THREE.MeshPhongMaterial;
      const name = material.name || "default";
      const positions = new Float32Array(group.count * 3);
      const normals = new Float32Array(group.count * 3);
      for (let i = 0; i < group.count; i += 1) {
        positions[i * 3] = position.getX(group.start + i);
        positions[i * 3 + 1] = position.getY(group.start + i);
        positions[i * 3 + 2] = position.getZ(group.start + i);
        normals[i * 3] = normal.getX(group.start + i);
        normals[i * 3 + 1] = normal.getY(group.start + i);
        normals[i * 3 + 2] = normal.getZ(group.start + i);
      }
      const part = new THREE.BufferGeometry();
      part.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      part.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
      part.applyMatrix4(transform);
      const entry = byMaterial.get(name) ?? {
        material: name,
        color: [material.color.r, material.color.g, material.color.b, 1],
        parts: [],
      };
      entry.parts.push(part);
      byMaterial.set(name, entry);
    }
  });
  return [...byMaterial.values()]
    .sort((left, right) => left.material.localeCompare(right.material))
    .map(({ material, color, parts }) => ({
      material,
      color,
      geometry: concatenate(parts),
    }));
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Quantize to int16 positions / int8 normals and drop duplicate vertices. */
function quantize(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const lookup = new Map<string, number>();
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const direction = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    const p = [
      Math.round(position.getX(i) / POSITION_STEP_M),
      Math.round(position.getY(i) / POSITION_STEP_M),
      Math.round(position.getZ(i) / POSITION_STEP_M),
    ];
    if (p.some((value) => Math.abs(value) > 32_767)) {
      throw new Error("Mesh exceeds the int16 position range.");
    }
    direction.set(normal.getX(i), normal.getY(i), normal.getZ(i)).normalize();
    const n = [
      Math.round(direction.x * 127),
      Math.round(direction.y * 127),
      Math.round(direction.z * 127),
    ];
    const key = `${p.join(",")}|${n.join(",")}`;
    let vertex = lookup.get(key);
    if (vertex === undefined) {
      vertex = positions.length / 4;
      lookup.set(key, vertex);
      positions.push(p[0]!, p[1]!, p[2]!, 0);
      normals.push(n[0]!, n[1]!, n[2]!, 0);
    }
    indices.push(vertex);
  }
  return {
    positions: Int16Array.from(positions),
    normals: Int8Array.from(normals),
    indices,
    count: positions.length / 4,
  };
}

function buildGlb(
  links: Array<{ link: string; primitives: Primitive[] }>,
): Buffer {
  const chunks: Buffer[] = [];
  let byteOffset = 0;
  const gltf: Gltf = {
    asset: {
      version: "2.0",
      generator: "palette_3d_viewer scripts/convert-ur10e-meshes.ts",
      copyright:
        "Meshes from UniversalRobots/Universal_Robots_ROS2_Description (BSD-3-Clause)",
    },
    extensionsUsed: ["KHR_mesh_quantization"],
    extensionsRequired: ["KHR_mesh_quantization"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "ur10e", children: [] }],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };
  const materialIndex = new Map<string, number>();
  const pushView = (data: Buffer, target: number, byteStride?: number) => {
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: data.length,
      ...(byteStride ? { byteStride } : {}),
      target,
    });
    const padded = Buffer.concat([
      data,
      Buffer.alloc((4 - (data.length % 4)) % 4),
    ]);
    chunks.push(padded);
    byteOffset += padded.length;
    return gltf.bufferViews.length - 1;
  };
  for (const { link, primitives } of links) {
    const meshPrimitives: Gltf["meshes"][number]["primitives"] = [];
    for (const primitive of primitives) {
      if (!materialIndex.has(primitive.material)) {
        materialIndex.set(primitive.material, gltf.materials.length);
        gltf.materials.push({
          name: primitive.material,
          pbrMetallicRoughness: {
            baseColorFactor: primitive.color.map(round),
            metallicFactor: 0.1,
            roughnessFactor: 0.6,
          },
        });
      }
      const quantized = quantize(primitive.geometry);
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < quantized.count; i += 1) {
        for (let axis = 0; axis < 3; axis += 1) {
          const value = quantized.positions[i * 4 + axis]!;
          min[axis] = Math.min(min[axis]!, value);
          max[axis] = Math.max(max[axis]!, value);
        }
      }
      gltf.accessors.push({
        bufferView: pushView(Buffer.from(quantized.positions.buffer), 34962, 8),
        componentType: 5122,
        count: quantized.count,
        type: "VEC3",
        min,
        max,
      });
      const positionAccessor = gltf.accessors.length - 1;
      gltf.accessors.push({
        bufferView: pushView(Buffer.from(quantized.normals.buffer), 34962, 4),
        componentType: 5120,
        normalized: true,
        count: quantized.count,
        type: "VEC3",
      });
      const normalAccessor = gltf.accessors.length - 1;
      const wide = quantized.count > 65_535;
      const indexArray = wide
        ? Uint32Array.from(quantized.indices)
        : Uint16Array.from(quantized.indices);
      gltf.accessors.push({
        bufferView: pushView(Buffer.from(indexArray.buffer), 34963),
        componentType: wide ? 5125 : 5123,
        count: quantized.indices.length,
        type: "SCALAR",
      });
      meshPrimitives.push({
        attributes: { POSITION: positionAccessor, NORMAL: normalAccessor },
        indices: gltf.accessors.length - 1,
        material: materialIndex.get(primitive.material)!,
      });
    }
    gltf.meshes.push({ name: link, primitives: meshPrimitives });
    // The link node is the URDF link frame; its child dequantizes positions.
    gltf.nodes.push({
      name: `${link}-mesh`,
      mesh: gltf.meshes.length - 1,
      scale: [POSITION_STEP_M, POSITION_STEP_M, POSITION_STEP_M],
    });
    gltf.nodes.push({ name: link, children: [gltf.nodes.length - 1] });
    gltf.nodes[0]!.children!.push(gltf.nodes.length - 1);
  }
  const binary = Buffer.concat(chunks);
  gltf.buffers[0].byteLength = binary.length;
  const jsonText = JSON.stringify(gltf);
  const json = Buffer.concat([
    Buffer.from(jsonText, "utf8"),
    Buffer.alloc((4 - (Buffer.byteLength(jsonText) % 4)) % 4, 0x20),
  ]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + binary.length, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, json, binaryHeader, binary]);
}

const visuals = readVisuals(
  readFileSync(join(sourceDir, "ur10e.urdf"), "utf8"),
);
const links = visuals.map((visual) => ({
  link: visual.link,
  primitives: linkPrimitives(visual),
}));
const glb = buildGlb(links);
writeFileSync(outputPath, glb);
for (const { link, primitives } of links) {
  const triangles = primitives.reduce(
    (sum, { geometry }) => sum + geometry.getAttribute("position").count / 3,
    0,
  );
  console.log(
    `${link}: ${primitives.length} primitives, ${triangles} triangles`,
  );
}
console.log(`${outputPath}: ${glb.length} bytes`);
