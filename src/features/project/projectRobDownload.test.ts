// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import {
  hasRobPlan,
  libraryRobDownload,
} from "~/features/project/projectRobDownload";

const ids = { now: () => 1, createId: (kind: string) => `${kind}-rob` };

const robText = "1200 800 144\n400 300 200\n1\n1\n1 0\n\n0 0 0 1 0 0\n";

function imported(rawRobText?: string) {
  return createProject(
    {
      id: "imported",
      source: {
        kind: "rob-import",
        fileName: "line-7.rob",
        ...(rawRobText ? { rawRobText } : {}),
      },
    },
    ids,
  );
}

function stacked(layerCount: number) {
  return createProject(
    {
      id: "stacked",
      productNumber: "SKU 9",
      solutions: [
        {
          id: "solution-1",
          name: "Stacked",
          origin: "calculated",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern 1",
              grips: [],
              placements: [
                {
                  id: "placement-1",
                  sequence: 0,
                  positionMm: { x: 100, y: 50 },
                  rotation: 0,
                  gripId: null,
                  labelSide: null,
                },
              ],
            },
          ],
          stack: {
            interlayerThicknessMm: 3,
            layers: Array.from({ length: layerCount }, (_, index) => ({
              id: `layer-${index + 1}`,
              patternId: "pattern-1",
              interlayerBefore: 0,
            })),
            trailingInterlayer: 0,
          },
          robotCycles: [],
        },
      ],
      activeSolutionId: "solution-1",
    },
    ids,
  );
}

describe("hasRobPlan", () => {
  it("offers a download for retained imports and saved stacks only", () => {
    expect(hasRobPlan(imported(robText))).toBe(true);
    expect(hasRobPlan(imported())).toBe(false);
    expect(hasRobPlan(stacked(2))).toBe(true);
    expect(hasRobPlan(stacked(0))).toBe(false);
    expect(hasRobPlan(createProject({ id: "empty" }, ids))).toBe(false);
  });
});

describe("libraryRobDownload", () => {
  it("returns the imported file verbatim under its original name", () => {
    expect(libraryRobDownload(imported(robText))).toEqual({
      ok: true,
      fileName: "line-7.rob",
      text: robText,
    });
  });

  it("explains why nothing can be downloaded", () => {
    expect(libraryRobDownload(imported())).toEqual({
      ok: false,
      message: "This project keeps no .rob file text.",
    });
    expect(libraryRobDownload(stacked(0))).toEqual({
      ok: false,
      message: "Save a stack for this project before downloading a .rob plan.",
    });
  });
});
