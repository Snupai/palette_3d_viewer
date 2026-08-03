import type * as THREE from "three";
import type { Box, PalletData } from "~/domain/palletTypes";

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

export type RobViewerProps = {
  data: PalletData;
  /** 1-based from bottom: layers 1..N solid, above hidden. */
  visibleUpToLayer: number;
  onBoxSelect?: (selection: BoxSelection | null) => void;
};

export type BoxPickEntry = {
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

export type LayerRender = {
  layerNum: number;
  solidMesh: THREE.Mesh;
  solidEdges: THREE.LineSegments;
  pickEntries: BoxPickEntry[];
};

export type InterlayerRender = {
  layerNum: number;
  isAboveLayer: boolean;
  mesh: THREE.Mesh;
  edges: THREE.LineSegments;
  opaqueMaterial: THREE.Material;
  exposedMaterial: THREE.Material;
};

export type BuiltViewerScene = {
  root: THREE.Group;
  bounds: THREE.Box3 | null;
  layerRenders: LayerRender[];
  interlayerRenders: InterlayerRender[];
  pickEntries: BoxPickEntry[];
  dispose(): void;
};
