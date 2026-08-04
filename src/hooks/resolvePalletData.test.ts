import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePalletData } from "~/hooks/usePalletLibrary";
import { parseRobText } from "~/lib/robParser";

const rawText = readFileSync(
  resolve(process.cwd(), "src", "lib", "__fixtures__", "anonymized-plan-lf.rob"),
  "utf8",
);
const parsed = parseRobText(rawText);

describe("resolvePalletData", () => {
  it("re-parses raw .rob so entries stored without newer optional fields recover them", () => {
    // An entry written by an older parser: optional fields are absent, which
    // still passes storage validation, so `data` alone stays stale.
    const { trailingZwischenlage, inputDirectionExplicit, ...staleData } =
      parsed;
    expect(trailingZwischenlage).toBeDefined();
    expect(inputDirectionExplicit).toBeDefined();

    const resolved = resolvePalletData({ data: staleData, rawText });

    expect(resolved.trailingZwischenlage).toBe(trailingZwischenlage);
    expect(resolved.inputDirectionExplicit).toBe(inputDirectionExplicit);
  });

  it("falls back to stored data when raw .rob is missing or unparsable", () => {
    expect(resolvePalletData({ data: parsed }).total_boxes).toBe(
      parsed.total_boxes,
    );
    expect(
      resolvePalletData({ data: parsed, rawText: "not a rob plan" }),
    ).toEqual(parsed);
  });
});
