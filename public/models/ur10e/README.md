# UR10e articulated model

`ur10e.glb` is the visual model of the Universal Robots UR10e, one node per
URDF link (`base_link_inertia`, `shoulder_link`, `upper_arm_link`,
`forearm_link`, `wrist_1_link`, `wrist_2_link`, `wrist_3_link`). Each link node
is the URDF link frame (Z-up, metres); its `<link>-mesh` child holds the
geometry, quantized to 0.1 mm / int8 normals via `KHR_mesh_quantization`
(no decoder needed).

- Source: [UniversalRobots/Universal_Robots_ROS2_Description](https://github.com/UniversalRobots/Universal_Robots_ROS2_Description),
  commit `0eb1a861f7772fceb38510d90fa2f98ec668070c` (`ur.urdf.xacro`,
  `ur_type:=ur10e`). The URDF and Collada meshes were expanded from that
  commit by an external generator whose FK check confirms UR's published DH
  parameters; the source URDF has SHA-256
  `412770413efa0342684337b7fce3594ec15995dae0fbb2a7f05e6473a20e28d3`.
- Conversion: `bun run scripts/convert-ur10e-meshes.ts <ur10e-folder> public/models/ur10e/ur10e.glb`
  bakes the Collada node transforms and the URDF `<visual><origin>` into each
  link; the output is byte-identical for identical input.
- SHA-256 of `ur10e.glb`:
  `08eb736d8864481dde95d3af3e16c3a5d1ea550685dc7f497088b89313ddfbf5`
  (pinned as `BUNDLED_ROBOT_CELL.articulatedArm.revision`).
- Licence: BSD 3-Clause; [`LICENSE`](./LICENSE) is the upstream licence text,
  copied verbatim (the upstream file carries no separate copyright line).

The joint chain used to pose the links lives in
`src/domain/robotics/ur10eKinematics.ts`. Only the UR10e is bundled; UR20
meshes are under different terms and are intentionally not included.
