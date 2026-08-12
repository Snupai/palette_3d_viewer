// @vitest-environment node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type GltfAccessor = {
  count: number;
};

type GltfNode = {
  children?: number[];
  name?: string;
};

type GltfPrimitive = {
  attributes: { POSITION: number };
  indices?: number;
  mode?: number;
};

type GltfDocument = {
  accessors: GltfAccessor[];
  cameras?: unknown[];
  extensionsRequired?: string[];
  extensionsUsed?: string[];
  meshes: Array<{ primitives: GltfPrimitive[] }>;
  nodes: GltfNode[];
  scene?: number;
  scenes: Array<{ nodes: number[] }>;
};

const GLTF_JSON_CHUNK = 0x4e4f534a;
const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const assetPath = resolve(
  process.cwd(),
  "public",
  "models",
  "robot-cell",
  "ur10-palletizer.glb",
);

const readGlbDocument = async () => {
  const bytes = await readFile(assetPath);
  expect(bytes.toString("ascii", 0, 4)).toBe("glTF");
  expect(bytes.readUInt32LE(4)).toBe(2);
  expect(bytes.readUInt32LE(8)).toBe(bytes.length);

  let offset = 12;
  while (offset < bytes.length) {
    const chunkLength = bytes.readUInt32LE(offset);
    const chunkType = bytes.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkType === GLTF_JSON_CHUNK) {
      return {
        bytes,
        document: JSON.parse(
          bytes
            .subarray(chunkStart, chunkStart + chunkLength)
            .toString("utf8")
            .trimEnd(),
        ) as GltfDocument,
      };
    }
    offset = chunkStart + chunkLength;
  }

  throw new Error("Robot-cell GLB has no JSON chunk.");
};

const requireNode = (document: GltfDocument, name: string) => {
  const matches = document.nodes
    .map((node, index) => ({ index, node }))
    .filter(({ node }) => node.name === name);
  expect(matches).toHaveLength(1);
  return matches[0]!;
};

describe("bundled robot-cell asset", () => {
  it("keeps the approved web asset within its decoder-free budget", async () => {
    const { bytes, document } = await readGlbDocument();

    expect(bytes.length).toBeLessThanOrEqual(MAX_ASSET_BYTES);
    expect(document.extensionsUsed).toEqual(["KHR_mesh_quantization"]);
    expect(document.extensionsRequired).toEqual(["KHR_mesh_quantization"]);
    expect(document.cameras ?? []).toHaveLength(0);

    const triangleCount = document.meshes.reduce(
      (meshTotal, mesh) =>
        meshTotal +
        mesh.primitives.reduce((primitiveTotal, primitive) => {
          if ((primitive.mode ?? 4) !== 4) {
            return primitiveTotal;
          }
          const accessorIndex =
            primitive.indices ?? primitive.attributes.POSITION;
          return (
            primitiveTotal +
            Math.floor(document.accessors[accessorIndex]!.count / 3)
          );
        }, 0),
      0,
    );

    expect(triangleCount).toBeGreaterThan(900_000);
    expect(triangleCount).toBeLessThanOrEqual(1_100_000);
  });

  it("exposes one fixed-cell root and one robot-only lift target", async () => {
    const { document } = await readGlbDocument();
    const scene = document.scenes[document.scene ?? 0]!;
    const robotCell = requireNode(document, "robot-cell");
    const fixedCell = requireNode(document, "cell-fixed");
    const liftCarriage = requireNode(document, "lift-carriage");
    const robot = requireNode(document, "eSeries_UR10e_1");

    expect(scene.nodes).toEqual([robotCell.index]);
    expect(robotCell.node.children).toEqual([
      fixedCell.index,
      liftCarriage.index,
    ]);
    expect(liftCarriage.node.children).toEqual([robot.index]);

    expect(
      document.nodes.some(({ name }) => name === "Europalette_1200x800-1"),
    ).toBe(false);
    expect(document.nodes.some(({ name }) => name === "10_01_43_00001-2")).toBe(
      false,
    );
    expect(document.nodes.some(({ name }) => name === "Intern_schrank")).toBe(
      false,
    );
  });
});
