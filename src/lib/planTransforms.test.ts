import { describe, expect, it } from "vitest";
import { rotateRobPlanBy180 } from "~/lib/planTransforms";

describe("rotateRobPlanBy180", () => {
  it("rotates only the place rotation field on coordinate rows", () => {
    const rawText = [
      "1200 800 144",
      "200 300 150",
      "100 50 0 600 400 0 1 0 0",
      "100 50 90 600 400 90 1 0 0",
      "100 50 180 600 400 180 1 0 0",
      "100 50 270 600 400 270 1 0 0",
    ].join("\n");

    expect(rotateRobPlanBy180(rawText)).toBe(
      [
        "1200 800 144",
        "200 300 150",
        "100 50 0 600 400 180 1 0 0",
        "100 50 90 600 400 270 1 0 0",
        "100 50 180 600 400 0 1 0 0",
        "100 50 270 600 400 90 1 0 0",
      ].join("\n"),
    );
  });

  it("preserves CRLF line endings and is reversible", () => {
    const rawText = [
      "1200 800 144",
      "200 300 150",
      "100 50 0 600 400 90 1 0 0",
    ].join("\r\n");
    const rotated = rotateRobPlanBy180(rawText);

    expect(rotated).toContain("\r\n");
    expect(rotated.replaceAll("\r\n", "")).not.toContain("\n");
    expect(rotateRobPlanBy180(rotated)).toBe(rawText);
  });
});
