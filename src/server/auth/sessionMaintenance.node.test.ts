// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenDatabase } from "../db/database";
import { sessions, users } from "../db/schema";
import { openMigratedTestDatabase } from "../db/testing";
import { createSession, verifySession } from "./accounts";
import { hashSessionToken } from "./sessionToken";

const NOW = new Date("2027-01-15T06:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const at = (offset: number) => new Date(NOW.getTime() + offset);
let database: OpenDatabase;

beforeEach(async () => {
  database = await openMigratedTestDatabase();
  await database.db.insert(users).values({
    id: "user",
    username: "werker",
    passwordHash: "unused",
    role: "user",
    createdAt: NOW,
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await database.close();
});

async function storedTokens() {
  const rows = await database.db.select().from(sessions);
  return rows.map((row) => row.tokenHash).sort();
}

describe("session verification maintenance", () => {
  it("purges abandoned sessions including the expiry boundary and preserves valid ones", async () => {
    await createSession(database.db, "user", NOW, 999);
    await createSession(database.db, "user", NOW, 1000);
    const valid = await createSession(database.db, "user", NOW);

    expect(
      await verifySession(database.db, valid.token, at(1000)),
    ).toMatchObject({
      user: { id: "user" },
      expiresAt: valid.expiresAt,
    });
    expect(await storedTokens()).toEqual([hashSessionToken(valid.token)]);
  });

  it("throttles cleanup until the next hour, then removes newly expired sessions", async () => {
    const valid = await createSession(database.db, "user", NOW);
    await verifySession(database.db, valid.token, NOW);
    const abandoned = await createSession(database.db, "user", NOW, 1000);

    await verifySession(database.db, valid.token, at(HOUR - 1));
    expect(await storedTokens()).toEqual(
      [hashSessionToken(valid.token), hashSessionToken(abandoned.token)].sort(),
    );
    await verifySession(database.db, valid.token, at(HOUR));
    expect(await storedTokens()).toEqual([hashSessionToken(valid.token)]);
  });

  it("starts only one cleanup for concurrent verifications", async () => {
    const valid = await createSession(database.db, "user", NOW);
    await createSession(database.db, "user", NOW, 0);
    const deletes = vi.spyOn(database.db, "delete");

    const results = await Promise.all([
      verifySession(database.db, valid.token, NOW),
      verifySession(database.db, valid.token, NOW),
    ]);

    expect(results.map((result) => result?.user.id)).toEqual(["user", "user"]);
    expect(deletes).toHaveBeenCalledTimes(1);
    expect(await storedTokens()).toEqual([hashSessionToken(valid.token)]);
  });

  it("keeps valid sessions usable after cleanup failure, throttles retries and recovers", async () => {
    const valid = await createSession(database.db, "user", NOW);
    const abandoned = await createSession(database.db, "user", NOW, 0);
    const deletes = vi
      .spyOn(database.db, "delete")
      .mockImplementationOnce(() => {
        throw new Error("cleanup unavailable");
      });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await verifySession(database.db, valid.token, NOW))?.user.id).toBe(
      "user",
    );
    expect(
      (await verifySession(database.db, valid.token, at(1)))?.user.id,
    ).toBe("user");
    expect(deletes).toHaveBeenCalledTimes(1);
    expect(await storedTokens()).toEqual(
      [hashSessionToken(valid.token), hashSessionToken(abandoned.token)].sort(),
    );

    expect(
      (await verifySession(database.db, valid.token, at(HOUR)))?.user.id,
    ).toBe("user");
    expect(deletes).toHaveBeenCalledTimes(2);
    expect(await storedTokens()).toEqual([hashSessionToken(valid.token)]);
  });
});
