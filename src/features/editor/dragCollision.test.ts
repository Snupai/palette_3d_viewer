import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import {
  placementClearanceBounds,
  rectangleBoundsOverlap,
  type RectangleBoundsMm,
} from "~/domain/geometry";
import {
  createDragCollisionContext,
  resolveDragDelta,
  roundDragDelta,
  type DragCollisionContext,
} from "~/features/editor/dragCollision";
import { validateProjectPattern } from "~/features/editor/editorModel";

function box(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): RectangleBoundsMm {
  return { minX, minY, maxX, maxY };
}

function context(
  moving: readonly RectangleBoundsMm[],
  obstacles: readonly RectangleBoundsMm[],
  envelope: RectangleBoundsMm | null = null,
): DragCollisionContext {
  return {
    moving: moving.map((bounds) => ({ clearance: bounds, physical: bounds })),
    obstacles,
    envelope,
  };
}

function expectDelta(
  actual: { x: number; y: number },
  expected: { x: number; y: number },
) {
  expect(actual.x).toBeCloseTo(expected.x, 9);
  expect(actual.y).toBeCloseTo(expected.y, 9);
}

const origin = { x: 0, y: 0 };

describe("resolveDragDelta", () => {
  it("moves freely when nothing is in the way", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(0, 200, 100, 250)]);
    expectDelta(resolveDragDelta(ctx, origin, { x: 120, y: 30 }), {
      x: 120,
      y: 30,
    });
  });

  it("stops flush against the edge of a package it runs into", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(200, 0, 300, 50)]);
    expectDelta(resolveDragDelta(ctx, origin, { x: 300, y: 0 }), {
      x: 100,
      y: 0,
    });
  });

  it("does not tunnel through a package on a single large jump", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(200, 0, 210, 50)]);
    expectDelta(resolveDragDelta(ctx, origin, { x: 1_000, y: 0 }), {
      x: 100,
      y: 0,
    });
  });

  it("slides along the contact edge when dragged diagonally", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(200, 0, 300, 200)]);
    expectDelta(resolveDragDelta(ctx, origin, { x: 300, y: 60 }), {
      x: 100,
      y: 60,
    });
  });

  it("slides along a top edge it is already touching", () => {
    const ctx = context([box(0, 50, 100, 100)], [box(0, 0, 400, 50)]);
    expectDelta(resolveDragDelta(ctx, origin, { x: 80, y: -40 }), {
      x: 80,
      y: 0,
    });
  });

  it("can pass a corner it only touches", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(100, 50, 200, 100)]);
    expectDelta(resolveDragDelta(ctx, origin, { x: 150, y: 0 }), {
      x: 150,
      y: 0,
    });
  });

  it("stops the whole group when its leading package hits", () => {
    const ctx = context(
      [box(0, 0, 100, 50), box(100, 0, 200, 50)],
      [box(250, 0, 350, 50)],
    );
    expectDelta(resolveDragDelta(ctx, origin, { x: 200, y: 0 }), {
      x: 50,
      y: 0,
    });
  });

  it("keeps packages inside the pallet envelope", () => {
    const ctx = context([box(0, 0, 100, 50)], [], box(0, 0, 400, 300));
    expectDelta(resolveDragDelta(ctx, origin, { x: -50, y: 400 }), {
      x: 0,
      y: 250,
    });
  });

  it("lets already overlapping packages be pulled apart", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(50, 0, 150, 50)]);
    expectDelta(resolveDragDelta(ctx, origin, { x: -30, y: 0 }), {
      x: -30,
      y: 0,
    });
  });

  it("does not push already overlapping packages further together", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(50, 0, 150, 50)]);
    expectDelta(resolveDragDelta(ctx, origin, { x: 30, y: 0 }), {
      x: 0,
      y: 0,
    });
  });

  it("lets a package slide while it fully spans an existing overlap", () => {
    // A (100 × 50) spans the rotated B (50 × 100) along x: moving A along x
    // keeps the overlap area at 2500 mm² — allowed, as the move command does.
    const ctx = context([box(50, 75, 150, 125)], [box(85, 50, 135, 150)]);
    expectDelta(resolveDragDelta(ctx, origin, { x: 5, y: 0 }), {
      x: 5,
      y: 0,
    });
    expect(roundDragDelta(ctx, { x: 5, y: 0 })).toEqual({ x: 5, y: 0 });

    const project = dragProject({
      length: 100,
      clearanceMm: 4,
      palletLength: 600,
    });
    const pattern = {
      ...dragPattern(100, 110),
      placements: dragPattern(100, 110).placements.map((placement, index) =>
        index === 1
          ? {
              ...placement,
              rotation: 90 as const,
              positionMm: { x: 110, y: 100 },
            }
          : { ...placement, positionMm: { x: 100, y: 100 } },
      ),
    };
    const withClearance = createDragCollisionContext(project, pattern, ["a"]);
    const committed = roundDragDelta(
      withClearance,
      resolveDragDelta(withClearance, origin, { x: 5, y: 0 }),
    );
    expect(committed).toEqual({ x: 5, y: 0 });
  });

  it("allows a diagonal repair that shrinks two existing overlaps", () => {
    // A overlaps B (1500 mm²) and C (1200 mm²). Moving A by (+5, −5) grows
    // the x overlap with B and the y overlap with C, but both areas shrink
    // (to 1375 and 1125 mm²), so the move command accepts it.
    const ctx = context(
      [box(150, 75, 250, 125)],
      [box(200, 95, 300, 145), box(80, 65, 180, 115)],
    );
    expectDelta(resolveDragDelta(ctx, origin, { x: 5, y: -5 }), {
      x: 5,
      y: -5,
    });
    expect(roundDragDelta(ctx, { x: 5, y: -5 })).toEqual({ x: 5, y: -5 });
    // Pushing straight into B still grows that overlap and is blocked.
    expectDelta(resolveDragDelta(ctx, origin, { x: 5, y: 0 }), origin);
  });

  it("does not let an existing overlap grow inside the touch tolerance", () => {
    // Edges 9e-10 mm apart are "equal" for the overlap test, but the growth
    // rate must still see that moving right and up widens the overlap.
    const ctx = context(
      [box(-9e-10, 0, 100 - 9e-10, 4_000)],
      [box(0, 0, 100, 4_000)],
    );
    const resolved = resolveDragDelta(ctx, origin, { x: 9e-10, y: 2e-9 });
    expect(resolved.x).toBe(0);
  });

  it("lets a package outside the envelope move back in but not further out", () => {
    const ctx = context([box(-10, 0, 90, 50)], [], box(0, 0, 400, 300));
    expectDelta(resolveDragDelta(ctx, origin, { x: -50, y: 0 }), {
      x: 0,
      y: 0,
    });
    expectDelta(resolveDragDelta(ctx, origin, { x: 30, y: 0 }), {
      x: 30,
      y: 0,
    });
  });

  it("continues from the resolved position so packages can be routed around", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(200, 0, 300, 50)]);
    const blocked = resolveDragDelta(ctx, origin, { x: 300, y: 0 });
    const lifted = resolveDragDelta(ctx, blocked, { x: 300, y: 100 });
    expectDelta(lifted, { x: 100, y: 100 });
    expectDelta(resolveDragDelta(ctx, lifted, { x: 300, y: 100 }), {
      x: 300,
      y: 100,
    });
  });

  it("respects package clearance from the project", () => {
    const project = dragProject({ length: 100, clearanceMm: 10 });
    const pattern = dragPattern(50, 300);
    const ctx = createDragCollisionContext(project, pattern, ["a"]);
    expectDelta(resolveDragDelta(ctx, origin, { x: 400, y: 0 }), {
      x: 140,
      y: 0,
    });
  });
});

function dragProject({
  length,
  clearanceMm,
  palletLength = 400,
}: {
  length: number;
  clearanceMm: number;
  palletLength?: number;
}) {
  return createProject({
    id: "drag-project",
    package: {
      dimensionsMm: { length, width: 50, height: 40 },
      clearanceMm,
      multiPickAllowed: true,
      palletizingDirection: "x-positive-y-positive",
    },
    pallet: {
      id: "drag-pallet",
      name: "Drag pallet",
      kind: "custom",
      dimensionsMm: { length: palletLength, width: 300, height: 20 },
      storageEnvelopeMm: { length: palletLength, width: 300, height: 500 },
      allowedOverhangMm: { length: 0, width: 0 },
      tareKg: null,
      maxGrossKg: null,
      subPalletPattern: "none",
    },
  });
}

function dragPattern(...xs: number[]) {
  return {
    id: "pattern-1",
    name: "Pattern 1",
    grips: [],
    placements: xs.map((x, index) => ({
      id: String.fromCharCode(97 + index),
      sequence: index,
      positionMm: { x, y: 25 },
      rotation: 0 as const,
      gripId: null,
      labelSide: null,
    })),
  };
}

describe("drag and validation agree", () => {
  it("never flags flush packages whose float coordinates touch (phone report)", () => {
    // Solver-style flush neighbours: 60.65 + 121.3 = 181.95 leaves the edges
    // 1.4e-14 mm apart in floats, which the strict check used to report as
    // "overlap or violate clearance" and every move was then rejected.
    const project = dragProject({
      length: 121.3,
      clearanceMm: 0,
      palletLength: 600,
    });
    const pattern = dragPattern(60.65, 181.95, 400);
    const [a, b] = pattern.placements;
    const size = project.package.dimensionsMm;
    expect(
      rectangleBoundsOverlap(
        placementClearanceBounds(a!, size, 0),
        placementClearanceBounds(b!, size, 0),
      ),
    ).toBe(true);
    expect(committedErrors(project, pattern, origin)).toEqual([]);

    // Dragging "c" against "b" stops flush and commits without an error.
    const ctx = createDragCollisionContext(project, pattern, ["c"]);
    const resolved = resolveDragDelta(ctx, origin, { x: -400, y: 0 });
    expectDelta(resolved, { x: -96.75, y: 0 });
    const committed = roundDragDelta(ctx, resolved);
    expect(committed).toEqual({ x: -96.7, y: 0 });
    expect(committedErrors(project, pattern, committed, "c")).toEqual([]);
  });

  it("keeps the configured clearance while dragging", () => {
    const project = dragProject({
      length: 100,
      clearanceMm: 4,
      palletLength: 600,
    });
    const pattern = dragPattern(50, 300);
    const ctx = createDragCollisionContext(project, pattern, ["a"]);
    const committed = roundDragDelta(
      ctx,
      resolveDragDelta(ctx, origin, { x: 300, y: 0 }),
    );
    // b starts at 250; a must end 4 mm before it.
    expect(committed).toEqual({ x: 146, y: 0 });
    expect(committedErrors(project, pattern, committed)).toEqual([]);
    expect(committedErrors(project, pattern, { x: 146.5, y: 0 })).toEqual([
      "placement-overlap",
    ]);
  });
});

describe("roundDragDelta", () => {
  it("rounds the committed move to 0.1 mm", () => {
    const ctx = context([box(0, 0, 100, 50)], []);
    expect(roundDragDelta(ctx, { x: 12.34, y: -7.06 })).toEqual({
      x: 12.3,
      y: -7.1,
    });
  });

  it("rounds back towards the start when rounding up would overlap a package", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(100.06, 0, 200, 50)]);
    expect(roundDragDelta(ctx, { x: 0.06, y: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("commits a contact move that editor validation accepts despite float error", () => {
    const project = dragProject({ length: 99.9, clearanceMm: 0 });
    const pattern = dragPattern(50, 200.1);
    const ctx = createDragCollisionContext(project, pattern, ["a"]);
    const resolved = resolveDragDelta(ctx, origin, { x: 200, y: 0 });
    const committed = roundDragDelta(ctx, resolved);
    // Flush contact: float error within the shared tolerance is no overlap.
    expect(committed).toEqual({ x: 50.2, y: 0 });
    expect(committedErrors(project, pattern, committed)).toEqual([]);
  });

  it("commits a flush contact approached from the far side", () => {
    const project = dragProject({ length: 99, clearanceMm: 0 });
    const pattern = dragPattern(50, 200.4);
    const ctx = createDragCollisionContext(project, pattern, ["a"]);
    let resolved = origin;
    for (const target of [
      { x: 0, y: 100 },
      { x: 400, y: 100 },
      { x: 400, y: 0 },
      { x: 100, y: 0 },
    ]) {
      resolved = resolveDragDelta(ctx, resolved, target);
    }
    expectDelta(resolved, { x: 249.4, y: 0 });
    const committed = roundDragDelta(ctx, resolved);
    expect(committed).toEqual({ x: 249.4, y: 0 });
    expect(committedErrors(project, pattern, committed)).toEqual([]);
  });

  it("commits the flush 0.1 mm position in a tight gap", () => {
    const project = dragProject({
      length: 99,
      clearanceMm: 0,
      palletLength: 600,
    });
    const pattern = dragPattern(50, 200.4, 398.42);
    const ctx = createDragCollisionContext(project, pattern, ["a"]);
    let resolved = origin;
    for (const target of [
      { x: 0, y: 100 },
      { x: 249.41, y: 100 },
      { x: 249.41, y: 0 },
      { x: 100, y: 0 },
    ]) {
      resolved = resolveDragDelta(ctx, resolved, target);
    }
    const committed = roundDragDelta(ctx, resolved);
    expect(committed).toEqual({ x: 249.4, y: 0 });
    expect(committedErrors(project, pattern, committed)).toEqual([]);
  });

  it("absorbs float error at a contact that lies off both grids", () => {
    const project = dragProject({
      length: 99,
      clearanceMm: 0,
      palletLength: 600,
    });
    const pattern = dragPattern(50, 200.02, 398.021);
    const ctx = createDragCollisionContext(project, pattern, ["a"]);
    let resolved = origin;
    let committable = origin;
    for (const target of [
      { x: 0, y: 100 },
      { x: 249.02, y: 100 },
      { x: 249.02, y: 0 },
      { x: 100, y: 0 },
    ]) {
      resolved = resolveDragDelta(ctx, resolved, target);
      committable = roundDragDelta(ctx, resolved, committable);
    }
    expect(committable.x).toBeCloseTo(249.02, 5);
    expect(committable.y).toBe(0);
    expect(committedErrors(project, pattern, committable)).toEqual([]);
  });

  it("snaps drags of imported .rob plans to whole millimetres", () => {
    const project = dragProject({ length: 100, clearanceMm: 0 });
    const imported = {
      ...project,
      source: { kind: "rob-import" as const, fileName: "plan.rob" },
    };
    const pattern = dragPattern(50, 300);
    expect(
      roundDragDelta(createDragCollisionContext(imported, pattern, ["a"]), {
        x: 12.34,
        y: 7.6,
      }),
    ).toEqual({ x: 12, y: 8 });
    expect(
      roundDragDelta(createDragCollisionContext(project, pattern, ["a"]), {
        x: 12.34,
        y: 7.6,
      }),
    ).toEqual({ x: 12.3, y: 7.6 });
  });

  it("keeps imported plans on whole millimetres even at an off-grid contact", () => {
    // 201 mm packages put the flush contact at 101.5 mm; .rob cannot store it.
    const ctx = {
      ...context([box(0, 0, 201, 50)], [box(302.5, 0, 503.5, 50)]),
      gridMm: 1,
    };
    const resolved = resolveDragDelta(ctx, origin, { x: 400, y: 0 });
    expectDelta(resolved, { x: 101.5, y: 0 });
    expect(roundDragDelta(ctx, resolved)).toEqual({ x: 101, y: 0 });

    // Only 47.2–47.5 mm fits between the neighbours: no whole millimetre,
    // so the last valid grid position is kept instead of an off-grid one.
    const squeezed = {
      ...context(
        [box(0, 0, 10, 50)],
        [box(40, 0, 47.2, 50), box(57.5, 0, 100, 50)],
      ),
      gridMm: 1,
    };
    expect(
      roundDragDelta(squeezed, { x: 47.4, y: 0 }, { x: 30, y: 0 }),
    ).toEqual({ x: 30, y: 0 });
    expect(
      roundDragDelta({ ...squeezed, gridMm: 0.1 }, { x: 47.4, y: 0 }),
    ).toEqual({ x: 47.4, y: 0 });
  });

  it("falls back to the last committable position when nothing nearby is valid", () => {
    const ctx = context([box(0, 0, 100, 50)], [box(100, 0, 100.5, 50)]);
    expect(roundDragDelta(ctx, { x: 50, y: 0 }, { x: -7, y: 0 })).toEqual({
      x: -7,
      y: 0,
    });
  });
});

/** Blocking geometry errors the editor would report after moving "a". */
function committedErrors(
  project: ReturnType<typeof dragProject>,
  pattern: ReturnType<typeof dragPattern>,
  delta: { x: number; y: number },
  movedId = "a",
) {
  return validateProjectPattern(project, {
    ...pattern,
    placements: pattern.placements.map((placement) =>
      placement.id === movedId
        ? {
            ...placement,
            positionMm: {
              x: placement.positionMm.x + delta.x,
              y: placement.positionMm.y + delta.y,
            },
          }
        : placement,
    ),
  })
    .filter(({ severity }) => severity === "error")
    .map(({ code }) => code);
}
