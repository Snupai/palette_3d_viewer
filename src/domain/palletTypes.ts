export type Side = "top" | "right" | "bottom" | "left";
export type Corner = "top_right" | "bottom_right" | "bottom_left" | "top_left";

export type Rotation = 0 | 90 | 180 | 270;

export interface Rectangle {
  width: number;
  length: number;
  x: number;
  y: number;
}

export interface Box {
  blueNumber: number;
  blueLine: Side | Corner | null;
  rotation: Rotation;
  rect: Rectangle;
  height: number;
  /** Place/grip center from the .rob coordinate line (shared by multi-package grips). */
  placeX: number;
  placeY: number;
  /** Number of packages gripped together on this coordinate line. */
  numPackages: number;
}

export interface Grip {
  /** Client-only stable id for drag tracking and React keys. */
  id: string;
  /** Robot pick pose: the first three values of a .rob coordinate line. */
  pickX: number;
  pickY: number;
  pickRotation: Rotation;
  /** Robot place pose: values four through six of a .rob coordinate line. */
  x: number;
  y: number;
  rotation: Rotation;
  numPackages: number;
  dx: number;
  dy: number;
  /** Migration fallback for editor data saved before pick fields were named. */
  rawLead?: [number, number, number];
}

export interface Layer {
  unique_layer_id: number;
  boxes: Box[];
  /**
   * Zwischenlage under this physical layer.
   * Layer 1 reads it from the second value on line 5; later layers read it
   * from the second value of the preceding layer-order row.
   * Typically 0 or 1; multiplied by {@link ZWISCHENLAGE_HEIGHT_MM} for Z.
   */
  zwischenlage: number;
}

export interface PalletData {
  layers: Layer[];
  /** Editable source data, keyed by 1-based unique layer id. */
  uniqueLayers: Record<number, Grip[]>;
  layer_count: number;
  total_boxes: number;
  package: { width: number; length: number; height: number };
  pallet: { width: number; length: number; height: number } | null;
  inputDirection: 0 | 1;
  /** Whether the optional input-direction value was present on package line 2. */
  inputDirectionExplicit?: boolean;
  /** Final .rob layer-order flag after the top layer; kept for round-tripping. */
  trailingZwischenlage?: number;
}

export type GripCollision = {
  firstGripIndex: number;
  secondGripIndex: number;
};

/** Thickness of one Zwischenlage in mm (matches robot `Dicke_ZwLagen`). */
export const ZWISCHENLAGE_HEIGHT_MM = 3;
