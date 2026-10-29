import type {
  ViewerRobotCellAssetConfig,
  ViewerSceneCalibrationConfig,
} from "./viewerTypes";

export const BUNDLED_ROBOT_CELL = {
  assetUrl: "/models/robot-cell/ur10-palletizer.glb",
  revision:
    "sha256:71f726b56397a93cf953a14f5af8df9ead1969fd56761f1b6e792e8d3d803b7d",
  nodes: {
    root: "robot-cell",
    fixed: "cell-fixed",
    liftCarriage: "lift-carriage",
    // The CAD arm is a flat group of baked part meshes ("Copy of Base/Link1..6"),
    // not a joint chain, so it cannot be posed. It is hidden in favour of the
    // animated procedural arm; the lift column itself lives under `cell-fixed`
    // and therefore stays visible.
    staticArm: "eSeries_UR10e_1",
  },
  liftTravelMm: {
    min: 0,
    max: 900,
  },
  // Measured from the CAD mount node of `eSeries_UR10e_1` on the lift carriage
  // (source -141.4, 890.1, 1400.5 at zero travel) mapped through
  // `sourceToViewer`. Link lengths are the UR10e datasheet values: d1 = 180.7,
  // a2 = 612.7, and a3 + d5 + d6 = 807.95 so the two-link visualization reaches
  // the TCP rather than the wrist centre.
  robotMount: {
    baseMm: {
      x: 1_058.6,
      y: 599.5,
      z: 746.1,
    },
    baseHeightMm: 180.7,
    upperArmLengthMm: 612.7,
    forearmLengthMm: 807.95,
  },
  sourceToViewer: {
    scaleMmPerMeter: 1_000,
    rotationXRad: Math.PI / 2,
    // Calibrated against the CAD assembly: the +90° X rotation maps source
    // (x, y, z) to viewer (x, -z, y), so the translation places the pallet
    // station on the free floor west of the frame. A 800 x 1200 pallet then
    // occupies source x -1200..-400 / z 800..2000, which is clear of every
    // `Palettierer Grundgestell` member and butts against the z 760..800 cross
    // rail. Z is the negated pallet height so viewer z = 0 stays the pallet top
    // face while the cell floor (source y = 0) sits one pallet below it.
    translationMm: {
      x: 1_200,
      y: 2_000,
      z: -144,
    },
  },
  replacesProcedural: {
    // The CAD arm cannot be animated, so the procedural arm stays in charge of
    // the motion while the rest of the cell (frame, lift column, conveyor,
    // cabinet) keeps its CAD geometry.
    robot: false,
    conveyor: true,
  },
  evidence: {
    geometry: "CAD-derived visual geometry from the supplied cell assembly.",
    lift: "CAD-derived vertical travel: 0–900 mm.",
    placement:
      "Viewer placement derived from measured CAD bounding boxes: the pallet station is set on the free floor area west of the machine frame, with the cell floor one pallet height below the viewer origin plane.",
    limitations:
      "The CAD arm meshes carry no joint frames, so the animated arm is the procedural two-link visualization mounted at the measured CAD base. Lift position is a visualization target; UR10 kinematics, synchronized lift timing, reach, and collisions are not checked.",
  },
} as const satisfies ViewerRobotCellAssetConfig;

export const BUNDLED_ROBOT_CELL_SIMULATION_CALIBRATION = {
  robotCellRevision: BUNDLED_ROBOT_CELL.revision,
  palletPose: {
    positionMm: { x: 789, y: -5, z: 0 },
    yawDeg: 90,
  },
  pickupPose: {
    positionMm: { x: 1_492, y: 207, z: 962 },
    yawDeg: -90,
  },
} as const satisfies ViewerSceneCalibrationConfig;
