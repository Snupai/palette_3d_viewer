// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createLoginRateLimiter, loginClientAddress } from "./loginRateLimit";

function start(
  limiter: ReturnType<typeof createLoginRateLimiter>,
  user = "alice",
  address = "192.0.2.1",
) {
  const attempt = limiter.begin(user, address);
  if (!("finish" in attempt))
    throw new Error(`Unexpected throttle: ${attempt.retryAfter}`);
  return attempt.finish;
}

describe("failed login throttling", () => {
  it("shares normalized usernames across addresses, expires exactly, and does not extend on rejection", () => {
    let time = 0;
    const limiter = createLoginRateLimiter(() => time);
    for (let i = 0; i < 5; i++)
      start(limiter, " ALIce ", `192.0.2.${i}`)(false);
    expect(limiter.begin("alice", "other")).toEqual({ retryAfter: 900 });
    time = 899_001;
    expect(limiter.begin("Alice", "other")).toEqual({ retryAfter: 1 });
    time = 900_000;
    start(limiter)(false);
  });

  it("limits password spraying across usernames and preserves address failures after success", () => {
    const limiter = createLoginRateLimiter(() => 0);
    for (let i = 0; i < 29; i++) start(limiter, `user${i}`)(false);
    start(limiter, "valid-user")(true);
    start(limiter, "last-user")(false);
    expect(limiter.begin("fresh-user", "192.0.2.1")).toEqual({
      retryAfter: 900,
    });
    start(limiter, "fresh-user", "192.0.2.2")(false);
  });

  it("clears a user's failures on success without accumulating successful logins", () => {
    const limiter = createLoginRateLimiter(() => 0);
    for (let i = 0; i < 4; i++) start(limiter)(false);
    start(limiter)(true);
    for (let i = 0; i < 4; i++) start(limiter)(false);
    for (let i = 0; i < 40; i++) start(limiter)(true);
  });

  it("reserves concurrent checks, releases errors, and finishes only once", () => {
    const limiter = createLoginRateLimiter(() => 0);
    const pending = Array.from({ length: 5 }, () => start(limiter));
    expect(limiter.begin("alice", "other")).toEqual({ retryAfter: 900 });
    pending[0]!(null);
    pending[0]!(false);
    start(limiter)(false);
    expect(limiter.begin("alice", "other")).toEqual({ retryAfter: 900 });
    pending.slice(1).forEach((finish) => finish(true));
    start(limiter)(true);
  });

  it("bounds memory without evicting active limits and reclaims expired entries", () => {
    let time = 0;
    const limiter = createLoginRateLimiter(() => time, 3);
    start(limiter, "alice")(false);
    start(limiter, "bob")(false);
    expect(limiter.begin("carol", "192.0.2.1")).toEqual({ retryAfter: 900 });
    time = 900_000;
    start(limiter, "carol")(false);
  });

  it("retains reservations past expiry until outstanding checks finish", () => {
    let time = 0;
    const limiter = createLoginRateLimiter(() => time);
    const pending = Array.from({ length: 5 }, () => start(limiter));
    time = 900_000;
    expect(limiter.begin("alice", "other")).toEqual({ retryAfter: 1 });
    pending.forEach((finish) => finish(false));
    start(limiter)(false);
  });
});

describe("client address trust", () => {
  function request(value: string) {
    return new Request("https://palette.local", {
      headers: { "x-forwarded-for": value, "x-real-ip": "192.0.2.99" },
    });
  }
  it("ignores spoofable headers by default and uses only an explicitly trusted single IP", () => {
    expect(loginClientAddress(request("192.0.2.1"), false)).toBe("unknown");
    expect(loginClientAddress(request("192.0.2.1"), true)).toBe("192.0.2.1");
    expect(loginClientAddress(request("192.0.2.1, 192.0.2.2"), true)).toBe(
      "unknown",
    );
    expect(loginClientAddress(request("forged"), true)).toBe("unknown");
    expect(loginClientAddress(request("fe80::1%eth0"), true)).toBe("unknown");
    expect(loginClientAddress(new Request("https://palette.local"), true)).toBe(
      "unknown",
    );
    expect(loginClientAddress(request("2001:0db8:0:0:0:0:0:1"), true)).toBe(
      "[2001:db8::1]",
    );
  });
});
