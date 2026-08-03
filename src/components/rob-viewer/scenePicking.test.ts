import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  findPickEntryForFace,
  gripEntriesFor,
  isClickGesture,
  mapIntersectionToPickEntry,
  toBoxSelection,
} from "~/components/rob-viewer/scenePicking";
import type {
  BoxPickEntry,
  LayerRender,
} from "~/components/rob-viewer/viewerTypes";

function entry(
  layerIndex: number,
  boxIndex: number,
  blueNumber: number,
  firstFace: number,
): BoxPickEntry {
  return {
    layerIndex,
    boxIndex,
    blueNumber,
    placeX: 400,
    placeY: 300,
    zBottom: 3,
    placeZ: 153,
    numPackages: 2,
    rotation: 90,
    rect: { width: 200, length: 300, x: 400, y: 300 },
    height: 150,
    layerNum: layerIndex,
    zwischenlage: 1,
    firstFace,
    faceCount: 12,
  };
}

function layerRender(
  layerNum: number,
  pickEntries: BoxPickEntry[],
): LayerRender {
  return {
    layerNum,
    solidMesh: new THREE.Mesh(new THREE.BufferGeometry()),
    solidEdges: new THREE.LineSegments(new THREE.BufferGeometry()),
    pickEntries,
  };
}

describe("viewer picking", () => {
  it("maps merged-geometry face ranges back to the owning box", () => {
    const first = entry(0, 0, 7, 0);
    const second = entry(0, 1, 7, 12);
    const layer = layerRender(0, [first, second]);

    expect(findPickEntryForFace(layer.pickEntries, 0)).toBe(first);
    expect(findPickEntryForFace(layer.pickEntries, 11)).toBe(first);
    expect(findPickEntryForFace(layer.pickEntries, 12)).toBe(second);
    expect(findPickEntryForFace(layer.pickEntries, 23)).toBe(second);
    expect(findPickEntryForFace(layer.pickEntries, 24)).toBeNull();
    expect(
      mapIntersectionToPickEntry([layer], {
        object: layer.solidMesh,
        faceIndex: 12,
      }),
    ).toBe(second);
    expect(
      mapIntersectionToPickEntry([layer], {
        object: new THREE.Mesh(),
        faceIndex: 12,
      }),
    ).toBeNull();
  });

  it("groups only matching grip numbers on the same physical layer", () => {
    const selected = entry(0, 0, 7, 0);
    const sameGrip = entry(0, 1, 7, 12);
    const otherGrip = entry(0, 2, 8, 24);
    const otherLayer = entry(1, 0, 7, 0);
    const gripEntries = gripEntriesFor(
      [selected, sameGrip, otherGrip, otherLayer],
      selected,
    );

    expect(gripEntries).toEqual([selected, sameGrip]);
    expect(toBoxSelection(selected, gripEntries)).toEqual({
      layerIndex: 0,
      boxIndex: 0,
      blueNumber: 7,
      placeX: 400,
      placeY: 300,
      placeZ: 153,
      numPackages: 2,
      rotation: 90,
      rect: selected.rect,
      height: 150,
      gripBoxCount: 2,
      zwischenlage: 1,
    });
  });

  it("keeps the five-pixel click-versus-drag threshold", () => {
    expect(isClickGesture({ x: 10, y: 10 }, { x: 13, y: 14 })).toBe(true);
    expect(isClickGesture({ x: 10, y: 10 }, { x: 14, y: 14 })).toBe(false);
  });
});
