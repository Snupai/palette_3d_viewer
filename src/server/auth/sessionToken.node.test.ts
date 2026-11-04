// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  generateSessionToken,
  hashSessionToken,
  isSessionExpired,
  isWellFormedSessionToken,
  sessionCookieOptions,
  sessionExpiresAt,
  sessionTokenHashesEqual,
  SESSION_TTL_MS,
} from "./sessionToken";

describe("session tokens", () => {
  it("generates distinct 43-character base64url tokens", () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).toHaveLength(43);
    expect(isWellFormedSessionToken(a)).toBe(true);
    expect(a).not.toBe(b);
  });

  it("hashes tokens to a fixed SHA-256 hex digest", () => {
    expect(hashSessionToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("compares hashes exactly", () => {
    const h = hashSessionToken("abc");
    expect(sessionTokenHashesEqual(h, hashSessionToken("abc"))).toBe(true);
    expect(sessionTokenHashesEqual(h, hashSessionToken("abd"))).toBe(false);
    expect(sessionTokenHashesEqual(h, "ab")).toBe(false);
  });

  it("rejects malformed tokens", () => {
    expect(isWellFormedSessionToken("")).toBe(false);
    expect(isWellFormedSessionToken("a".repeat(42))).toBe(false);
    expect(isWellFormedSessionToken(`${"a".repeat(42)}=`)).toBe(false);
  });

  it("expires sessions exactly at expires_at", () => {
    const expiresAt = sessionExpiresAt(1_000);
    expect(expiresAt).toBe(1_000 + SESSION_TTL_MS);
    expect(isSessionExpired(expiresAt, expiresAt - 1)).toBe(false);
    expect(isSessionExpired(expiresAt, expiresAt)).toBe(true);
  });
});

describe("session cookie options (ADR 0008)", () => {
  it("is Secure in production even on localhost", () => {
    expect(
      sessionCookieOptions({ nodeEnv: "production", hostname: "localhost" }),
    ).toEqual({
      name: "palette_session",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: 43_200,
    });
  });

  it("drops Secure only for development on loopback", () => {
    expect(
      sessionCookieOptions({ nodeEnv: "development", hostname: "127.0.0.1" })
        .secure,
    ).toBe(false);
    expect(
      sessionCookieOptions({ nodeEnv: "development", hostname: "planner.werk" })
        .secure,
    ).toBe(true);
  });
});
