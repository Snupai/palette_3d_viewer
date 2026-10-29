import { describe, expect, it } from "vitest";
import {
  realizeRegionLineSpacing,
  type RegionLineSpacingRequest,
} from "~/domain/solver/region-topology/spacing";

function line(
  policy: RegionLineSpacingRequest["policy"],
): RegionLineSpacingRequest {
  return {
    minimumMm: 0,
    maximumMm: 9,
    itemSpanMm: 2,
    clearanceMm: 0,
    count: 3,
    policy,
  };
}

describe("region line spacing", () => {
  it("returns exact compact, continuous, and integer-balanced centers", () => {
    expect(realizeRegionLineSpacing(line("compact"))).toEqual({
      status: "feasible",
      centersMm: [1, 3, 5],
      quantization: "continuous",
    });
    expect(realizeRegionLineSpacing(line("continuous-space-between"))).toEqual({
      status: "feasible",
      centersMm: [1, 4.5, 8],
      quantization: "continuous",
    });
    expect(realizeRegionLineSpacing(line("integer-balanced"))).toEqual({
      status: "feasible",
      centersMm: [1, 4, 8],
      quantization: "integer-center",
    });
  });

  it("centers a single item and preserves half-toward-zero integer ties", () => {
    expect(
      realizeRegionLineSpacing({
        ...line("continuous-space-between"),
        minimumMm: -2,
        maximumMm: 7,
        count: 1,
      }),
    ).toEqual({
      status: "feasible",
      centersMm: [2.5],
      quantization: "continuous",
    });
    expect(
      realizeRegionLineSpacing({
        ...line("integer-balanced"),
        minimumMm: -2,
        maximumMm: 7,
        count: 1,
      }),
    ).toEqual({
      status: "feasible",
      centersMm: [2],
      quantization: "integer-center",
    });
  });

  it("distributes residual between suction groups and leaves seam spacing compact", () => {
    expect(
      realizeRegionLineSpacing({
        ...line("suction-group-aware"),
        groupCapacity: 2,
      }),
    ).toEqual({
      status: "feasible",
      centersMm: [1, 3, 8],
      quantization: "continuous",
    });
    expect(
      realizeRegionLineSpacing({
        ...line("suction-group-aware"),
        groupCapacity: 2,
        groupRemainder: "first",
      }),
    ).toEqual({
      status: "feasible",
      centersMm: [1, 6, 8],
      quantization: "continuous",
    });
    expect(realizeRegionLineSpacing(line("inter-region-seam"))).toEqual({
      status: "feasible",
      centersMm: [1, 3, 5],
      quantization: "continuous",
    });
  });

  it("uses inward integer endpoints and rejects impossible quantization", () => {
    expect(
      realizeRegionLineSpacing({
        minimumMm: 0,
        maximumMm: 10,
        itemSpanMm: 3,
        clearanceMm: 0,
        count: 3,
        policy: "integer-balanced",
        centerPhaseMm: 0.5,
      }),
    ).toEqual({
      status: "feasible",
      centersMm: [1.5, 4.5, 8.5],
      quantization: "half-mm-center",
    });
    expect(
      realizeRegionLineSpacing({
        minimumMm: 0,
        maximumMm: 9,
        itemSpanMm: 2,
        clearanceMm: 0,
        count: 3,
        policy: "suction-group-aware",
        groupCapacity: 2,
        centerPhaseMm: 0.5,
      }),
    ).toEqual({
      status: "feasible",
      centersMm: [1.5, 3.5, 7.5],
      quantization: "half-mm-center",
    });
    expect(
      realizeRegionLineSpacing({
        minimumMm: 0,
        maximumMm: 4,
        itemSpanMm: 1,
        clearanceMm: 0,
        count: 2,
        policy: "integer-balanced",
      }),
    ).toEqual({
      status: "feasible",
      centersMm: [1, 3],
      quantization: "integer-center",
    });
    expect(
      realizeRegionLineSpacing({
        minimumMm: 0.2,
        maximumMm: 1.2,
        itemSpanMm: 1,
        clearanceMm: 0,
        count: 1,
        policy: "integer-balanced",
      }),
    ).toEqual({
      status: "infeasible",
      reason: "quantization-out-of-bounds",
    });
    expect(
      realizeRegionLineSpacing({
        minimumMm: 0,
        maximumMm: 3,
        itemSpanMm: 1.5,
        clearanceMm: 0,
        count: 2,
        policy: "integer-balanced",
      }),
    ).toEqual({
      status: "infeasible",
      reason: "quantization-violates-clearance",
    });
    expect(
      realizeRegionLineSpacing({
        minimumMm: 0,
        maximumMm: 5,
        itemSpanMm: 2,
        clearanceMm: 1,
        count: 2,
        policy: "compact",
      }),
    ).toEqual({
      status: "feasible",
      centersMm: [1, 4],
      quantization: "continuous",
    });
  });
});
