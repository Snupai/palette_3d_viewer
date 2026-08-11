import type * as THREE from "three";
import type { LayerPatternPreview } from "~/domain/layerPatternPreview";
import type { Box, PalletData } from "~/domain/palletTypes";

export const VIEWER_CAMERA_PRESETS = ["top", "front", "right-top"] as const;
export type ViewerCameraPreset = (typeof VIEWER_CAMERA_PRESETS)[number];

/** Coordinates are already transformed into the viewer's X/Y pallet, Z-up frame. */
export type ViewerScenePose = {
  positionMm: { x: number; y: number; z: number };
  yawDeg: number;
};

export type ViewerSimulationPackagePhase = "feed" | "attached" | "placed";

export type ViewerSimulationPackage = {
  placementId: string;
  phase: ViewerSimulationPackagePhase;
  pose: ViewerScenePose;
};

export type ViewerSimulationState = {
  packages: readonly ViewerSimulationPackage[];
  completedPackageLayerIndexes: readonly number[];
};

export type ViewerConveyorConfig = {
  centerMm: { x: number; y: number; z: number };
  dimensionsMm: { length: number; width: number; height: number };
  travelAxis?: "x" | "y";
};

export type ViewerGripperEnvelopeMm = {
  negativeX: number;
  positiveX: number;
  negativeY: number;
  positiveY: number;
  belowZ: number;
  aboveZ: number;
};

export type ViewerSelectedGripperConfig = {
  pose?: ViewerScenePose | null;
  envelopeMm?: ViewerGripperEnvelopeMm | null;
  showModel?: boolean;
};

export type ViewerRobotConfig = {
  baseMm: { x: number; y: number; z: number };
  baseHeightMm: number;
  upperArmLengthMm: number;
  forearmLengthMm: number;
  homePose?: ViewerScenePose | null;
};

/** Neutral scene equipment DTO. Robotics and stack calculations stay outside Three.js. */
export type ViewerEquipmentConfig = {
  conveyor?: ViewerConveyorConfig | null;
  selectedGripper?: ViewerSelectedGripperConfig | null;
  robot?: ViewerRobotConfig | null;
};

export type ViewerSceneBuildOptions = {
  /** Generic per-layer render offsets; RobViewer uses the final entry for lifted-top display. */
  layerOffsetsZMm?: readonly number[];
  showLayerLabels?: boolean;
};

export type ViewerSceneOptions = ViewerSceneBuildOptions & {
  equipment?: ViewerEquipmentConfig;
};

export type ViewerCaptureOptions = {
  width?: number;
  height?: number;
  cameraPreset?: ViewerCameraPreset;
};

export type ViewerCaptureResult =
  | {
      status: "captured";
      dataUrl: string;
      width: number;
      height: number;
      cameraPreset: ViewerCameraPreset;
    }
  | {
      status: "fallback";
      reason:
        | "viewer-unavailable"
        | "canvas-capture-unavailable"
        | "empty-canvas-capture"
        | "canvas-capture-failed";
      fallback: "layer-pattern-svg";
      message: string;
    };

export type RobViewerReportCaptureResult =
  | Extract<ViewerCaptureResult, { status: "captured" }>
  | (Extract<ViewerCaptureResult, { status: "fallback" }> & {
      layerPattern: LayerPatternPreview | null;
    });

export type RobViewerHandle = {
  setCameraPreset(preset: ViewerCameraPreset): void;
  captureReportFrame(
    options?: ViewerCaptureOptions & { fallbackLayerIndex?: number },
  ): Promise<RobViewerReportCaptureResult>;
};

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
  /** Zwischenlage directly above this package layer. */
  zwischenlage: number;
};

export type RobViewerProps = {
  data: PalletData;
  cameraResetKey?: string | null;
  cameraPreset?: ViewerCameraPreset | null;
  /** 1-based from bottom: layers 1..N solid, above hidden. */
  visibleUpToLayer: number;
  liftTopLayerMm?: number;
  showLayerLabels?: boolean;
  showSceneControls?: boolean;
  equipment?: ViewerEquipmentConfig;
  simulationPose?: ViewerScenePose | null;
  simulationState?: ViewerSimulationState | null;
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
  /** Zwischenlage directly above this package layer. */
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

export type LayerLabelRender = {
  layerNum: number;
  object: THREE.Group;
};

export type BuiltViewerScene = {
  root: THREE.Group;
  bounds: THREE.Box3 | null;
  layerRenders: LayerRender[];
  interlayerRenders: InterlayerRender[];
  layerLabels: LayerLabelRender[];
  pickEntries: BoxPickEntry[];
  setSimulationState(state: ViewerSimulationState | null): void;
  dispose(): void;
};
