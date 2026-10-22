// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hexToCss, SCENE_THEME } from "./sceneTheme";

const css = readFileSync(
  join(process.cwd(), "src", "styles", "globals.css"),
  "utf8",
);

function rootToken(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6});`).exec(css)?.[1];
}

describe("SCENE_THEME", () => {
  it("mirrors the viewport tokens from globals.css", () => {
    expect(rootToken("viewport")).toBe(hexToCss(SCENE_THEME.background));
    expect(rootToken("viewport-ink")).toBe(hexToCss(SCENE_THEME.ink));
    expect(rootToken("viewport-line")).toBe(hexToCss(SCENE_THEME.line));
  });

  it("formats colours as six-digit CSS hex", () => {
    expect(hexToCss(0x00ff00)).toBe("#00ff00");
    expect(hexToCss(SCENE_THEME.background)).toBe("#111a26");
  });
});
