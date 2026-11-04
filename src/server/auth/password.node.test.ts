// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  hashPassword,
  MAX_PASSWORD_LENGTH,
  passwordNeedsRehash,
  PasswordPolicyError,
  verifyPassword,
} from "./password";

const PASSWORD = "correct horse battery";

describe("password hashing", () => {
  it("produces an argon2id PHC string with the configured parameters", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(stored.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(passwordNeedsRehash(stored)).toBe(false);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword(stored, PASSWORD)).toBe(true);
    expect(await verifyPassword(stored, "correct horse battery!")).toBe(false);
    expect(await verifyPassword(stored, "")).toBe(false);
  });

  it("salts every hash", async () => {
    const [a, b] = await Promise.all([
      hashPassword(PASSWORD),
      hashPassword(PASSWORD),
    ]);
    expect(a).not.toBe(b);
  });

  it("treats malformed, non-argon2id and over-long input as a failed verify", async () => {
    const stored = await hashPassword(PASSWORD);
    expect(await verifyPassword("not-a-hash", PASSWORD)).toBe(false);
    expect(
      await verifyPassword(stored.replace("$argon2id$", "$argon2i$"), PASSWORD),
    ).toBe(false);
    expect(await verifyPassword("$argon2id$garbage", PASSWORD)).toBe(false);
    expect(
      await verifyPassword(stored, "x".repeat(MAX_PASSWORD_LENGTH + 1)),
    ).toBe(false);
  });

  it("enforces the length policy when hashing", async () => {
    await expect(hashPassword("short")).rejects.toBeInstanceOf(
      PasswordPolicyError,
    );
    await expect(
      hashPassword("x".repeat(MAX_PASSWORD_LENGTH + 1)),
    ).rejects.toBeInstanceOf(PasswordPolicyError);
  });

  it("flags hashes with weaker parameters for rehash", () => {
    expect(
      passwordNeedsRehash("$argon2id$v=19$m=4096,t=3,p=1$c2FsdHNhbHQ$aGFzaA"),
    ).toBe(true);
    expect(passwordNeedsRehash("$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$aA")).toBe(
      true,
    );
  });
});
