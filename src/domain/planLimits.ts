/**
 * Hard upper bounds for counts that are expanded into per-item arrays (boxes,
 * sheets, layers). They reject hostile or corrupt `.rob` files and persisted
 * projects before geometry or stack materialization allocates proportional
 * work. Each limit leaves wide headroom above real palletizing plans.
 */

/** Packages one grip (one `.rob` coordinate line) may carry; real grippers pick a handful. */
export const MAX_PACKAGES_PER_GRIP = 64;

/** Packages one layer pattern may expand to (sum of its grips' package counts). */
export const MAX_PACKAGES_PER_LAYER = 2_000;

/** Package layers in one stack (`.rob` layer-order rows, project stack layers). */
export const MAX_STACK_LAYERS = 1_000;

/** Interlayer sheets at one stack boundary (`.rob` Zwischenlage column). */
export const MAX_INTERLAYERS_PER_BOUNDARY = 16;

/** Boxes one `.rob` import or one project may expand to, across unique and stacked layers. */
export const MAX_EXPANDED_PACKAGES = 100_000;
