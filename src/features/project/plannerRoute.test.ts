import { describe, expect, it } from "vitest";
import { parsePlannerRoute, plannerRoutePath } from "./plannerRoute";

describe("plannerRoute", () => {
  it("maps the top-level screens", () => {
    expect(parsePlannerRoute("/")).toEqual({ kind: "welcome" });
    expect(parsePlannerRoute("/plaene")).toEqual({ kind: "library" });
    expect(parsePlannerRoute("/neu")).toEqual({ kind: "create" });
    expect(plannerRoutePath({ kind: "welcome" })).toBe("/");
    expect(plannerRoutePath({ kind: "library" })).toBe("/plaene");
    expect(plannerRoutePath({ kind: "create" })).toBe("/neu");
  });

  it("round-trips a plan with stage and tool", () => {
    const route = {
      kind: "plan",
      id: "p 1/ä",
      stage: "generate",
      view: "robotics",
    } as const;
    const path = plannerRoutePath(route);
    expect(path).toBe("/plan/p%201%2F%C3%A4/muster/robotics");
    expect(parsePlannerRoute(path)).toEqual(route);
  });

  it("round-trips the edit dialog and a plan without stage", () => {
    expect(
      plannerRoutePath({ kind: "plan", id: "x", stage: null, view: "edit" }),
    ).toBe("/plan/x/bearbeiten");
    expect(parsePlannerRoute("/plan/x/bearbeiten")).toEqual({
      kind: "plan",
      id: "x",
      stage: null,
      view: "edit",
    });
    expect(parsePlannerRoute("/plan/x")).toEqual({
      kind: "plan",
      id: "x",
      stage: null,
      view: null,
    });
  });

  it("ignores unknown stage and tool segments", () => {
    expect(parsePlannerRoute("/plan/x/foo/bar")).toEqual({
      kind: "plan",
      id: "x",
      stage: null,
      view: null,
    });
    expect(parsePlannerRoute("/unknown/path")).toEqual({ kind: "welcome" });
    expect(parsePlannerRoute("/plan")).toEqual({ kind: "welcome" });
  });
});
