// @vitest-environment node
import { describe, expect, it } from "vitest";

import { de, en } from "~/i18n";

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "./password";
import {
  MIN_DISTINCT_PASSWORD_CHARS,
  passwordProblem,
} from "./passwordStrength";

describe("passwordProblem", () => {
  it("returns the first violated rule as a code", () => {
    expect(passwordProblem("Frische Palette 42", "planer")).toBeNull();
    expect(passwordProblem("short-pw", "planer")).toBe("too_short");
    expect(passwordProblem("x".repeat(1025), "planer")).toBe("too_long");
    expect(passwordProblem("my-PLANER-password", "planer")).toBe(
      "contains_username",
    );
    expect(passwordProblem("121212121212", "planer")).toBe("too_few_distinct");
  });

  it("matches the limits the admin screen tells the user", () => {
    for (const messages of [de, en]) {
      expect(messages["admin.error.weakPassword.tooShort"]).toContain(
        String(MIN_PASSWORD_LENGTH),
      );
      expect(messages["admin.error.weakPassword.tooLong"]).toContain(
        String(MAX_PASSWORD_LENGTH),
      );
      expect(messages["admin.error.weakPassword.tooFewDistinct"]).toContain(
        String(MIN_DISTINCT_PASSWORD_CHARS),
      );
      expect(messages["admin.field.passwordHint"]).toContain(
        `${MIN_PASSWORD_LENGTH}`,
      );
    }
  });
});
