// @vitest-environment node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BUNDLED_UR10E_CELL } from "~/domain/robotics/ur10eCell";
import { UR10E_LINK_NAMES } from "~/domain/robotics/ur10eKinematics";
import { BUNDLED_ROBOT_CELL } from "./bundledRobotCell";

type GltfNode = {
  children?: number[];
  mesh?: number;
  name?: string;
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  translation?: [number, number, number];
};

type GltfDocument = {
  accessors: Array<{ count: number }>;
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  meshes: Array<{ primitives: Array<{ indices: number }> }>;
  nodes: GltfNode[];
  scene?: number;
  scenes: Array<{ nodes: number[] }>;
};

const GLTF_JSON_CHUNK = 0x4e4f534a;
const modelPath = (...segments: string[]) =>
  resolve(process.cwd(), "public", "models", ...segments);

const readGlb = async (path: string) => {
  const bytes = await readFile(path);
  expect(bytes.toString("ascii", 0, 4)).toBe("glTF");
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);
  const jsonLength = bytes.readUInt32LE(12);
  expect(bytes.readUInt32LE(16)).toBe(GLTF_JSON_CHUNK);
  return {
    bytes,
    document: JSON.parse(
      bytes
        .subarray(20, 20 + jsonLength)
        .toString("utf8")
        .trimEnd(),
    ) as GltfDocument,
  };
};

const nodeNamed = (document: GltfDocument, name: string) => {
  const matches = document.nodes.filter((node) => node.name === name);
  expect(matches).toHaveLength(1);
  return matches[0]!;
};

describe("bundled UR10e asset", () => {
  it("matches the pinned revision, size budget and decoder-free encoding", async () => {
    const { bytes, document } = await readGlb(modelPath("ur10e", "ur10e.glb"));

    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
      BUNDLED_ROBOT_CELL.articulatedArm.revision,
    );
    expect(bytes.length).toBe(5_145_856);
    expect(document.extensionsUsed).toEqual(["KHR_mesh_quantization"]);
    expect(document.extensionsRequired).toEqual(["KHR_mesh_quantization"]);
  });

  it("exposes one node per URDF link with its baked mesh child", async () => {
    const { document } = await readGlb(modelPath("ur10e", "ur10e.glb"));
    const root = nodeNamed(document, "ur10e");
    expect(document.scenes[document.scene ?? 0]!.nodes).toEqual([
      document.nodes.indexOf(root),
    ]);
    expect(root.children!.map((index) => document.nodes[index]!.name)).toEqual([
      ...UR10E_LINK_NAMES,
    ]);

    const triangles = UR10E_LINK_NAMES.map((name) => {
      const link = nodeNamed(document, name);
      expect(link.translation).toBeUndefined();
      expect(link.rotation).toBeUndefined();
      const mesh = document.nodes[link.children![0]!]!;
      expect(mesh.name).toBe(`${name}-mesh`);
      expect(mesh.scale).toEqual([1e-4, 1e-4, 1e-4]);
      return document.meshes[mesh.mesh!]!.primitives.reduce(
        (sum, primitive) =>
          sum + document.accessors[primitive.indices]!.count / 3,
        0,
      );
    });
    expect(triangles).toEqual([
      5_002, 30_093, 41_143, 17_929, 16_053, 18_423, 978,
    ]);
  });

  it("ships the upstream BSD-3 licence and provenance", async () => {
    const licence = await readFile(modelPath("ur10e", "LICENSE"), "utf8");
    const readme = await readFile(modelPath("ur10e", "README.md"), "utf8");

    expect(licence).toContain(
      "Redistribution and use in source and binary forms, with or without",
    );
    expect(readme).toContain("0eb1a861f7772fceb38510d90fa2f98ec668070c");
    expect(readme).toContain(
      BUNDLED_ROBOT_CELL.articulatedArm.revision.slice("sha256:".length),
    );
  });

  it("mounts the kinematic base exactly at the CAD arm node on the lift carriage", async () => {
    const { document } = await readGlb(
      modelPath("robot-cell", "ur10-palletizer.glb"),
    );
    const mount = nodeNamed(document, BUNDLED_ROBOT_CELL.nodes.staticArm);
    const [x, y, z] = mount.translation!;
    const { scaleMmPerMeter, translationMm } =
      BUNDLED_ROBOT_CELL.sourceToViewer;
    // Source (x, y, z) maps to viewer (x, −z, y) before the translation.
    const viewer = {
      x: x * scaleMmPerMeter + translationMm.x,
      y: -z * scaleMmPerMeter + translationMm.y,
      z: y * scaleMmPerMeter + translationMm.z,
    };
    expect(viewer.x).toBeCloseTo(BUNDLED_UR10E_CELL.baseMm.x, 1);
    expect(viewer.y).toBeCloseTo(BUNDLED_UR10E_CELL.baseMm.y, 1);
    expect(viewer.z).toBeCloseTo(BUNDLED_UR10E_CELL.baseMm.z, 1);

    // A pure rotation about source Y is the same yaw about viewer Z.
    const [qx, qy, qz, qw] = mount.rotation!;
    expect(qx).toBe(0);
    expect(qz).toBe(0);
    expect((2 * Math.atan2(qy, qw) * 180) / Math.PI).toBeCloseTo(
      BUNDLED_UR10E_CELL.baseYawDeg,
      5,
    );
  });
});
