/**
 * Colours for the 3D stage. The stage is always dark (`--viewport*` in
 * src/styles/globals.css, see docs/DESIGN.md), so these are fixed values
 * mirrored from the tokens; sceneTheme.node.test.ts keeps them in sync.
 * Physical material colours (cardboard, pallet wood, gripper CAD) are not
 * theme colours and stay where they are defined.
 */
export const SCENE_THEME = {
  /** --viewport */
  background: 0x111a26,
  /** --viewport-ink */
  ink: 0xe8eef4,
  /** --viewport-line */
  line: 0x2c3d55,
  gridMinor: 0x1c2b40,

  /** Selected grip: mist fill, ink edge, steel place marker. */
  selection: 0xb8dde1,
  selectionEdge: 0xe8eef4,
  placeMarker: 0x8bb0c9,

  /** Cell equipment: steel-tinted greys so it recedes behind the load. */
  equipment: 0x34465e,
  equipmentEdge: 0x5d7390,
  robotLink: 0x6f84a0,
  robotJoint: 0x9aadc0,

  /** Envelopes and diagnostic overlays (--caution / --info, dark values). */
  envelope: 0xe2b45a,
  calibrationPickup: 0x8bb0c9,
  calibrationPallet: 0xe2b45a,
} as const;

export function hexToCss(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}
