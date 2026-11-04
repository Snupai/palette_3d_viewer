import { describe, expect, it } from "vitest";
import { isUserRole, normalizeUsername, UsernameError } from "./userModel";

describe("usernames", () => {
  it("trims and lower-cases", () => {
    expect(normalizeUsername("  Max.Mustermann ")).toBe("max.mustermann");
  });

  it("rejects too short, invalid characters and bad edges", () => {
    for (const bad of ["ab", "max mustermann", "-max", "max_", "ä-user"]) {
      expect(() => normalizeUsername(bad)).toThrow(UsernameError);
    }
  });

  it("knows the two roles", () => {
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("user")).toBe(true);
    expect(isUserRole("root")).toBe(false);
  });
});
