import { describe, expect, it } from "vitest";

import { loginHref, safeReturnPath } from "./returnPath";

describe("safeReturnPath", () => {
  it("keeps same-origin paths with query and fragment", () => {
    expect(safeReturnPath("/hmi/2f7c1c0e-4c1d-4d8e-9a57-0e5d1c9b7a10")).toBe(
      "/hmi/2f7c1c0e-4c1d-4d8e-9a57-0e5d1c9b7a10",
    );
    expect(safeReturnPath("/admin?tab=hmis#top")).toBe("/admin?tab=hmis#top");
    expect(safeReturnPath("/a/../hmi/x")).toBe("/hmi/x");
  });

  it.each([
    null,
    undefined,
    "",
    "hmi/x",
    "https://evil.example/",
    "//evil.example/x",
    "/\\evil.example",
    "\\\\evil.example",
    "/\t/evil.example",
    "/ /evil.example",
    "/x\ny",
    "javascript:alert(1)",
    "/login",
    "/login?returnTo=/x",
    "/login/",
    "/a/..//evil.example/x",
    "/.//evil.example",
    `/${"a".repeat(2048)}`,
  ])("falls back to / for %j", (value) => {
    expect(safeReturnPath(value)).toBe("/");
  });
});

describe("loginHref", () => {
  it("encodes a safe return path and drops an unsafe one", () => {
    expect(loginHref("/hmi/abc")).toBe("/login?returnTo=%2Fhmi%2Fabc");
    expect(loginHref("//evil.example")).toBe("/login");
    expect(loginHref("/")).toBe("/login");
  });
});
