import type { ViewerRobotCellAssetConfig } from "./viewerTypes";

export const BUNDLED_ROBOT_CELL = {
  assetUrl: "/models/robot-cell/ur10-palletizer.glb",
  revision:
    "sha256:71f726b56397a93cf953a14f5af8df9ead1969fd56761f1b6e792e8d3d803b7d",
  nodes: {
    root: "robot-cell",
    fixed: "cell-fixed",
    liftCarriage: "lift-carriage",
  },
  liftTravelMm: {
    min: 0,
    max: 900,
  },
  sourceToViewer: {
    scaleMmPerMeter: 1_000,
    rotationXRad: Math.PI / 2,
    translationMm: {
      x: 797.9647517204285,
      y: 1_399.999976158142,
      z: -125.87862270322442,
    },
  },
  replacesProcedural: {
    robot: true,
    conveyor: true,
  },
  evidence: {
    geometry: "CAD-derived visual geometry from the supplied cell assembly.",
    lift: "CAD-derived vertical travel: 0–900 mm; viewer placement is not calibrated.",
    limitations:
      "Lift position is a visualization target; UR10 kinematics, synchronized lift timing, reach, and collisions are not checked.",
  },
} as const satisfies ViewerRobotCellAssetConfig;
