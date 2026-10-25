import { describe, expect, it } from "vitest";
import { createTranslator, interpolate, selectPluralKey } from "./format";
import { matchLocale, resolveLocale } from "./locales";
import { MESSAGES, de, en } from "./messages";

describe("resolveLocale", () => {
  it("prefers the stored choice over the system language", () => {
    expect(resolveLocale("en", ["de-DE"])).toBe("en");
  });
  it("uses the first matching system language", () => {
    expect(resolveLocale(null, ["fr-FR", "en-US", "de"])).toBe("en");
    expect(resolveLocale(undefined, ["de-AT"])).toBe("de");
  });
  it("falls back to German when nothing matches", () => {
    expect(resolveLocale("xx", ["fr-FR"])).toBe("de");
    expect(resolveLocale(null, [])).toBe("de");
  });
  it("matches region and underscore variants", () => {
    expect(matchLocale("en_US")).toBe("en");
    expect(matchLocale("DE-ch")).toBe("de");
    expect(matchLocale("")).toBeNull();
  });
});

describe("interpolate", () => {
  it("fills named placeholders and keeps unknown ones visible", () => {
    expect(interpolate("{count} von {total}", { count: 2, total: 5 })).toBe(
      "2 von 5",
    );
    expect(interpolate("Lage {n}", {})).toBe("Lage {n}");
  });
  it("selects plural variants by count", () => {
    const has = (k: string) => ["x_one", "x_other"].includes(k);
    expect(selectPluralKey("x", { count: 1 }, has)).toBe("x_one");
    expect(selectPluralKey("x", { count: 0 }, has)).toBe("x_other");
    expect(selectPluralKey("x", undefined, has)).toBe("x");
    expect(selectPluralKey("y", { count: 3 }, has)).toBe("y");
  });
  it("falls back to German for a key missing in the active locale", () => {
    const t = createTranslator<"a" | "b">({ a: "A" } as never, {
      a: "a",
      b: "b",
    });
    expect(t("b")).toBe("b");
  });
});

describe("message catalogs", () => {
  it("English covers exactly the German key set", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });
  it("every message is a non-empty string in every locale", () => {
    for (const messages of Object.values(MESSAGES)) {
      for (const [key, value] of Object.entries(messages)) {
        expect(typeof value, key).toBe("string");
        expect(value.length, key).toBeGreaterThan(0);
      }
    }
  });
  it("plural variants exist pairwise", () => {
    for (const key of Object.keys(de)) {
      if (key.endsWith("_one"))
        expect(de).toHaveProperty(`${key.slice(0, -4)}_other`);
      if (key.endsWith("_other"))
        expect(de).toHaveProperty(`${key.slice(0, -6)}_one`);
    }
  });
  it("placeholders match between locales", () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const key of Object.keys(de) as (keyof typeof de)[]) {
      expect(placeholders(en[key]), key).toEqual(placeholders(de[key]));
    }
  });
});
