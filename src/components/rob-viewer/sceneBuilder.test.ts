import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { buildViewerScene } from "~/components/rob-viewer/sceneBuilder";
import type { Box, PalletData } from "~/domain/palletTypes";

function box(
  blueNumber: number,
  x: number,
  y: number,
  rotation: Box["rotation"] = 0,
): Box {
  return {
    blueNumber,
    blueLine: null,
    rotation,
    rect: { width: 200, length: 300, x, y },
    height: 100,
    placeX: x,
    placeY: y,
    numPackages: 1,
  };
}

function palletData(): PalletData {
  return {
    layers: [
      {
        unique_layer_id: 1,
        zwischenlage: 1,
        boxes: [box(1, 200, 200), box(1, 500, 200)],
      },
      {
        unique_layer_id: 2,
        zwischenlage: 0,
        boxes: [box(2, 300, 300, 90)],
      },
    ],
    uniqueLayers: {},
    layer_count: 2,
    total_boxes: 3,
    package: { width: 200, length: 300, height: 100 },
    pallet: { width: 1200, length: 800, height: 144 },
    inputDirection: 0,
    trailingZwischenlage: 1,
  };
}

describe("viewer scene builder", () => {
  it("builds combined layer geometry with stable pick ranges and Z values", () => {
    const scene = new THREE.Scene();
    const built = buildViewerScene(scene, palletData());

    expect(scene.children).toContain(built.root);
    expect(built.layerRenders).toHaveLength(2);
    expect(built.pickEntries).toHaveLength(3);
    expect(built.interlayerRenders).toHaveLength(2);
    expect(built.bounds?.isEmpty()).toBe(false);

    expect(built.pickEntries.map((entry) => entry.firstFace)).toEqual([
      0, 12, 0,
    ]);
    expect(built.pickEntries.map((entry) => entry.faceCount)).toEqual([
      12, 12, 12,
    ]);
    expect(built.pickEntries.map((entry) => entry.zBottom)).toEqual([
      3, 3, 103,
    ]);
    expect(built.pickEntries.map((entry) => entry.placeZ)).toEqual([
      103, 103, 203,
    ]);
    expect(built.pickEntries.map((entry) => entry.zwischenlage)).toEqual([
      0, 0, 1,
    ]);

    const bottomGeometry = built.layerRenders[0]!.solidMesh.geometry;
    expect(bottomGeometry.index?.count).toBe(72);
    expect(bottomGeometry.getAttribute("color").count).toBe(48);

    expect(built.interlayerRenders[0]).toMatchObject({
      layerNum: 0,
      isAboveLayer: false,
    });
    expect(built.interlayerRenders[1]).toMatchObject({
      layerNum: 1,
      isAboveLayer: true,
    });

    built.dispose();
  });

  it("updates stable simulation package groups and hides merged package layers", () => {
    const scene = new THREE.Scene();
    const built = buildViewerScene(scene, palletData());

    built.setSimulationState({
      packages: [
        {
          placementId: "package-a",
          phase: "attached",
          pose: {
            positionMm: { x: 10, y: 20, z: 300 },
            yawDeg: 90,
          },
        },
        {
          placementId: "package-b",
          phase: "placed",
          pose: {
            positionMm: { x: 100, y: 200, z: 50 },
            yawDeg: 0,
          },
        },
      ],
      completedPackageLayerIndexes: [],
    });

    const packageA = built.root.getObjectByName("simulation-package:package-a")!;
    const packageB = built.root.getObjectByName("simulation-package:package-b")!;
    expect(built.layerRenders.every(({ solidMesh }) => !solidMesh.visible)).toBe(
      true,
    );
    expect(
      built.layerRenders.every(({ solidEdges }) => !solidEdges.visible),
    ).toBe(true);
    expect(packageA.visible).toBe(true);
    expect(packageA.position.toArray()).toEqual([10, 20, 300]);
    expect(packageA.rotation.z).toBeCloseTo(Math.PI / 2);
    expect(packageA.userData.phase).toBe("attached");

    built.setSimulationState({
      packages: [
        {
          placementId: "package-a",
          phase: "placed",
          pose: {
            positionMm: { x: 30, y: 40, z: 50 },
            yawDeg: 180,
          },
        },
      ],
      completedPackageLayerIndexes: [0],
    });

    expect(built.root.getObjectByName("simulation-package:package-a")).toBe(
      packageA,
    );
    expect(packageA.position.toArray()).toEqual([30, 40, 50]);
    expect(packageA.rotation.z).toBeCloseTo(Math.PI);
    expect(packageA.userData.phase).toBe("placed");
    expect(packageB.visible).toBe(false);

    built.setSimulationState(null);
    expect(packageA.visible).toBe(false);
    expect(packageB.visible).toBe(false);

    built.dispose();
  });

  it("reveals each upper interlayer only after its lower package layer is complete", () => {
    const scene = new THREE.Scene();
    const data = palletData();
    data.layers[1]!.zwischenlage = 1;
    const built = buildViewerScene(scene, data);
    const [baseSheet, betweenSheet, deckSheet] = built.interlayerRenders;

    built.setSimulationState({
      packages: [],
      completedPackageLayerIndexes: [],
    });
    expect(baseSheet?.mesh.visible).toBe(true);
    expect(betweenSheet?.mesh.visible).toBe(false);
    expect(deckSheet?.mesh.visible).toBe(false);

    built.setSimulationState({
      packages: [],
      completedPackageLayerIndexes: [0],
    });
    expect(baseSheet?.mesh.visible).toBe(true);
    expect(betweenSheet?.mesh.visible).toBe(true);
    expect(deckSheet?.mesh.visible).toBe(false);

    built.setSimulationState({
      packages: [],
      completedPackageLayerIndexes: [0, 1],
    });
    expect(betweenSheet?.mesh.visible).toBe(true);
    expect(deckSheet?.mesh.visible).toBe(true);

    built.setSimulationState({
      packages: [],
      completedPackageLayerIndexes: [],
    });
    expect(betweenSheet?.mesh.visible).toBe(false);
    expect(deckSheet?.mesh.visible).toBe(false);

    built.dispose();
  });

  it("reports the Zwischenlage directly above each package layer", () => {
    const scene = new THREE.Scene();
    const data = palletData();
    data.layers[1]!.zwischenlage = 1;
    data.trailingZwischenlage = 0;

    const built = buildViewerScene(scene, data);

    expect(built.pickEntries.map((entry) => entry.zwischenlage)).toEqual([
      1, 1, 0,
    ]);

    built.dispose();
  });

  it("renders exact variable base, interlayer, and deck thicknesses", () => {
    const scene = new THREE.Scene();
    const data = palletData();
    data.layers[0]!.interlayerThicknessesMm = [5];
    data.layers[1]!.zwischenlage = 1;
    data.layers[1]!.interlayerThicknessesMm = [7];
    data.trailingInterlayerThicknessesMm = [11];

    const built = buildViewerScene(scene, data);

    expect(
      built.pickEntries.map(({ zBottom, placeZ }) => [zBottom, placeZ]),
    ).toEqual([
      [5, 105],
      [5, 105],
      [112, 212],
    ]);
    expect(
      built.interlayerRenders.map(
        ({ mesh }) => (mesh.geometry as THREE.BoxGeometry).parameters.depth,
      ),
    ).toEqual([5, 7, 11]);

    built.dispose();
  });

  it("uses variable pallet and sheet footprints, lifted layer offsets, and optional labels", () => {
    const scene = new THREE.Scene();
    const data = palletData();
    data.pallet = { width: 1000, length: 700, height: 180 };
    data.interlayer = { width: 900, length: 650 };
    data.layers[0]!.interlayerDimensions = { width: 850, length: 600 };
    data.layers[1]!.zwischenlage = 1;
    data.layers[1]!.interlayerDimensions = { width: 825, length: 575 };
    data.trailingInterlayerDimensions = { width: 800, length: 550 };

    const built = buildViewerScene(scene, data, {
      layerOffsetsZMm: [0, 250],
      showLayerLabels: true,
    });

    expect(
      built.pickEntries.map(({ zBottom, placeZ }) => [zBottom, placeZ]),
    ).toEqual([
      [3, 103],
      [3, 103],
      [356, 456],
    ]);
    expect(built.layerLabels).toHaveLength(2);
    expect(built.layerLabels[1]?.object.position.z).toBe(406);
    expect(
      (built.root.getObjectByName("pallet") as THREE.Mesh<THREE.BoxGeometry>)
        .geometry.parameters,
    ).toMatchObject({ width: 1000, height: 700, depth: 180 });
    expect(
      built.interlayerRenders.map(({ mesh }) => {
        const parameters = (mesh.geometry as THREE.BoxGeometry).parameters;
        return [parameters.width, parameters.height, parameters.depth];
      }),
    ).toEqual([
      [850, 600, 3],
      [825, 575, 3],
      [800, 550, 3],
    ]);
    expect(built.bounds?.max.z).toBe(459);

    built.dispose();
  });

  it("removes its root and disposes shared scene resources idempotently", () => {
    const scene = new THREE.Scene();
    const built = buildViewerScene(scene, palletData(), {
      showLayerLabels: true,
    });
    const geometry = built.layerRenders[0]!.solidMesh.geometry;
    const material = built.layerRenders[0]!.solidMesh
      .material as THREE.Material;
    const labelMesh = built.layerLabels[0]!.object.children[1] as THREE.Mesh;
    const geometryDispose = vi.spyOn(geometry, "dispose");
    const materialDispose = vi.spyOn(material, "dispose");
    const labelGeometryDispose = vi.spyOn(labelMesh.geometry, "dispose");
    const labelMaterialDispose = vi.spyOn(
      labelMesh.material as THREE.Material,
      "dispose",
    );

    built.dispose();
    built.dispose();

    expect(scene.children).not.toContain(built.root);
    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(labelGeometryDispose).toHaveBeenCalledTimes(1);
    expect(labelMaterialDispose).toHaveBeenCalledTimes(1);
  });
});
