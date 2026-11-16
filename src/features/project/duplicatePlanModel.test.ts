import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { findDuplicatePlans, planIdentity } from "./duplicatePlanModel";

const plan = (
  id: string,
  numbers: { productNumber?: string; projectNumber?: string },
  updatedAt = 1,
) => createProject({ id, ...numbers }, { now: () => updatedAt });

describe("planIdentity", () => {
  it("uses the product number, else the project number, case-insensitively", () => {
    expect(planIdentity(plan("a", { productNumber: " 699-00277 " }))).toBe(
      "699-00277",
    );
    expect(planIdentity(plan("a", { projectNumber: "P-12AB" }))).toBe("p-12ab");
    expect(
      planIdentity(plan("a", { productNumber: "X1", projectNumber: "P" })),
    ).toBe("x1");
  });

  it("gives untitled plans no identity", () => {
    expect(planIdentity(plan("a", {}))).toBeNull();
  });
});

describe("findDuplicatePlans", () => {
  const older = plan("old", { productNumber: "699-00277" }, 10);
  const newer = plan("newer", { productNumber: "699-00277" }, 20);
  const other = plan("other", { productNumber: "699-00278" }, 30);
  const stored = [older, other, newer];

  it("finds stored plans with the same number for a new plan, newest first", () => {
    const fresh = plan("fresh", { productNumber: "699-00277" });
    expect(findDuplicatePlans(fresh, null, stored).map(({ id }) => id)).toEqual(
      ["newer", "old"],
    );
  });

  it("ignores the plan itself when it is saved again under its number", () => {
    expect(findDuplicatePlans(older, older, stored)).toEqual([]);
  });

  it("asks when a stored plan is renamed onto another plan's number", () => {
    const renamed = { ...other, productNumber: "699-00277" };
    expect(
      findDuplicatePlans(renamed, other, stored).map(({ id }) => id),
    ).toEqual(["newer", "old"]);
  });

  it("never matches untitled plans", () => {
    const untitled = plan("u", {});
    expect(findDuplicatePlans(untitled, null, [plan("v", {})])).toEqual([]);
  });
});
