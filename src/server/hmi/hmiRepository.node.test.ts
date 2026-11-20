// @vitest-environment node
import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OpenDatabase } from "../db/database";
import { hmiDevices, planFinals, plannerRecords } from "../db/schema";
import { openMigratedTestDatabase } from "../db/testing";
import { markFinal, withdrawFinal } from "../finals/finalRepository";
import {
  authenticateHmi,
  createHmiRateLimiter,
  readBearerToken,
} from "./hmiAuth";
import {
  createHmi,
  getHmi,
  LAST_SEEN_WRITE_INTERVAL_MS,
  listHmis,
  recordHmiSeen,
  regenerateHmiToken,
  renameHmi,
  reportHmiStatus,
  revokeHmi,
} from "./hmiRepository";

const T0 = new Date("2026-11-20T08:00:00.000Z");
const T1 = new Date("2026-11-20T09:00:00.000Z");
const ROB = ["1200 800 144", "200 300 150", "1", "1", "0 0", "1 0", "2"]
  .concat(["100 50 0 150 200 0 1 0 0", "100 50 0 450 200 0 1 0 0"])
  .join("\r\n");
const UNKNOWN_TOKEN = "A".repeat(43);

let database: OpenDatabase;

beforeAll(async () => {
  database = await openMigratedTestDatabase();
});

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await database.db.delete(hmiDevices);
  await database.db.delete(planFinals);
  await database.db.delete(plannerRecords);
});

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function register(name = "Linie 3") {
  const created = await createHmi(database.db, name, T0);
  if (!created.ok) throw new Error("createHmi failed");
  return created;
}

async function storedRow(id: string) {
  const [row] = await database.db
    .select()
    .from(hmiDevices)
    .where(eq(hmiDevices.id, id));
  return row!;
}

async function finalOf(recordId: string, name: string) {
  await database.db
    .insert(plannerRecords)
    .values({ store: "projects", id: recordId, json: { id: recordId } });
  const marked = await markFinal(
    database.db,
    {
      recordId,
      recordVersion: 1,
      name,
      fileName: `${recordId}.rob`,
      robText: ROB,
      userId: null,
    },
    T0,
  );
  if (!marked.ok) throw new Error("markFinal failed");
  return marked.final;
}

function authenticate(
  token: string,
  now = T1,
  limiter = createHmiRateLimiter(() => now.getTime()),
) {
  return authenticateHmi(database.db, `Bearer ${token}`, { now, limiter });
}

describe("createHmi", () => {
  it("stores only the SHA-256 of the token and returns the token once", async () => {
    const { hmi, token } = await register("  Linie 3  ");

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hmi).toEqual({
      id: hmi.id,
      name: "Linie 3",
      createdAt: T0,
      revokedAt: null,
      lastSeenAt: null,
      appVersion: null,
      activeFinal: null,
    });
    const row = await storedRow(hmi.id);
    expect(row.tokenHash).toBe(sha256(token));
    expect(Object.values(row)).not.toContain(token);
  });

  it("refuses empty, too long and unprintable names", async () => {
    for (const name of ["   ", "a".repeat(101), "Linie\n3", 3, undefined]) {
      expect(await createHmi(database.db, name, T0)).toEqual({
        ok: false,
        kind: "invalid-name",
      });
    }
    expect(await listHmis(database.db)).toEqual([]);
  });
});

describe("admin operations", () => {
  it("lists HMIs by name, case-insensitively", async () => {
    await register("linie 2");
    await register("Linie 10");
    await register("Halle Süd");
    expect((await listHmis(database.db)).map((hmi) => hmi.name)).toEqual([
      "Halle Süd",
      "Linie 10",
      "linie 2",
    ]);
  });

  it("renames, and reports unknown ids and bad names", async () => {
    const { hmi } = await register();
    expect(await renameHmi(database.db, hmi.id, " Linie 4 ")).toEqual({
      ok: true,
      hmi: { ...hmi, name: "Linie 4" },
    });
    expect(await renameHmi(database.db, hmi.id, "")).toEqual({
      ok: false,
      kind: "invalid-name",
    });
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect(await renameHmi(database.db, unknown, "x")).toEqual({
      ok: false,
      kind: "not-found",
      id: unknown,
    });
    expect(await renameHmi(database.db, "not-a-uuid", "x")).toEqual({
      ok: false,
      kind: "not-found",
      id: "not-a-uuid",
    });
  });

  it("revokes idempotently: the first revocation time stays", async () => {
    const { hmi, token } = await register();
    expect(await revokeHmi(database.db, hmi.id, T1)).toEqual({
      ok: true,
      hmi: { ...hmi, revokedAt: T1 },
    });
    const later = new Date("2026-11-21T00:00:00.000Z");
    expect(await revokeHmi(database.db, hmi.id, later)).toMatchObject({
      hmi: { revokedAt: T1 },
    });
    expect(await authenticate(token)).toEqual({
      ok: false,
      kind: "unauthenticated",
    });
  });

  it("regenerates the token: the old one stops, the new one works, a revocation is lifted", async () => {
    const { hmi, token: oldToken } = await register();
    await revokeHmi(database.db, hmi.id, T1);

    const regenerated = await regenerateHmiToken(database.db, hmi.id);
    if (!regenerated.ok) throw new Error("regenerate failed");

    expect(regenerated.token).not.toBe(oldToken);
    expect(regenerated.hmi).toEqual({ ...hmi, revokedAt: null });
    expect((await storedRow(hmi.id)).tokenHash).toBe(sha256(regenerated.token));
    expect(await authenticate(oldToken)).toEqual({
      ok: false,
      kind: "unauthenticated",
    });
    expect(await authenticate(regenerated.token)).toMatchObject({
      ok: true,
      hmi: { id: hmi.id, name: "Linie 3" },
    });
  });
});

describe("authenticateHmi", () => {
  it("refuses missing, malformed and unknown tokens", async () => {
    await register();
    const limiter = createHmiRateLimiter(() => T1.getTime());
    for (const header of [
      null,
      "",
      "Bearer",
      `Basic ${UNKNOWN_TOKEN}`,
      "Bearer short",
      `Bearer ${UNKNOWN_TOKEN}`,
    ]) {
      expect(
        await authenticateHmi(database.db, header, { now: T1, limiter }),
      ).toEqual({ ok: false, kind: "unauthenticated" });
    }
  });

  it("limits each token separately and tells when to retry", async () => {
    const a = await register("A");
    const b = await register("B");
    let clock = T1.getTime();
    const limiter = createHmiRateLimiter(() => clock, 2, 60_000);
    const run = (token: string) =>
      authenticateHmi(database.db, `Bearer ${token}`, {
        now: new Date(clock),
        limiter,
      });

    expect(await run(a.token)).toMatchObject({ ok: true });
    clock += 1_000;
    expect(await run(a.token)).toMatchObject({ ok: true });
    clock += 9_500;
    expect(await run(a.token)).toEqual({
      ok: false,
      kind: "rate-limited",
      retryAfter: 50,
    });
    expect(await run(b.token)).toMatchObject({ ok: true });
    clock = T1.getTime() + 60_000;
    expect(await run(a.token)).toMatchObject({ ok: true });
  });

  it("writes last_seen_at at most every few seconds", async () => {
    const { hmi, token } = await register();
    const limiter = createHmiRateLimiter(() => T1.getTime());
    const at = (offsetMs: number) =>
      authenticateHmi(database.db, `Bearer ${token}`, {
        now: new Date(T1.getTime() + offsetMs),
        limiter,
      });

    await at(0);
    expect((await storedRow(hmi.id)).lastSeenAt).toEqual(T1);
    await at(10_000);
    expect((await storedRow(hmi.id)).lastSeenAt).toEqual(T1);
    await at(LAST_SEEN_WRITE_INTERVAL_MS);
    expect((await storedRow(hmi.id)).lastSeenAt).toEqual(
      new Date(T1.getTime() + LAST_SEEN_WRITE_INTERVAL_MS),
    );
    expect(LAST_SEEN_WRITE_INTERVAL_MS).toBe(15_000);
  });

  it("does not record a visit when told not to", async () => {
    const { hmi, token } = await register();
    await authenticateHmi(database.db, `Bearer ${token}`, {
      now: T1,
      limiter: createHmiRateLimiter(() => T1.getTime()),
      recordSeen: false,
    });
    expect((await storedRow(hmi.id)).lastSeenAt).toBeNull();
  });
});

describe("recordHmiSeen", () => {
  it("skips the write when another request already refreshed the row", async () => {
    const { hmi } = await register();
    const fresh = new Date(T1.getTime() + 5_000);
    await database.db
      .update(hmiDevices)
      .set({ lastSeenAt: fresh })
      .where(eq(hmiDevices.id, hmi.id));

    // The caller read the row before the concurrent refresh.
    expect(
      await recordHmiSeen(
        database.db,
        { id: hmi.id, lastSeenAt: null },
        new Date(T1.getTime() + 6_000),
      ),
    ).toBe(false);
    expect((await storedRow(hmi.id)).lastSeenAt).toEqual(fresh);
  });
});

describe("reportHmiStatus", () => {
  it("stores the active Fertigstand and app version, and marks the HMI seen", async () => {
    const { hmi } = await register();
    const final = await finalOf("p1", "SKU 9");

    expect(
      await reportHmiStatus(
        database.db,
        hmi.id,
        {
          activeFinalId: final.id,
          activeSha256: final.sha256,
          appVersion: " MultipackParser 3.4.0 ",
        },
        T1,
      ),
    ).toEqual({ activeFinalId: final.id });
    expect(await getHmi(database.db, hmi.id)).toEqual({
      ...hmi,
      lastSeenAt: T1,
      appVersion: "MultipackParser 3.4.0",
      activeFinal: {
        id: final.id,
        name: "SKU 9",
        sha256: final.sha256,
        withdrawn: false,
      },
    });

    await withdrawFinal(database.db, final.id, T1);
    expect((await getHmi(database.db, hmi.id))?.activeFinal).toEqual({
      id: final.id,
      name: "SKU 9",
      sha256: final.sha256,
      withdrawn: true,
    });
  });

  it("records no active Fertigstand for an unknown id, a checksum mismatch or a USB plan", async () => {
    const { hmi } = await register();
    const final = await finalOf("p1", "SKU 9");
    const reports = [
      {
        activeFinalId: "00000000-0000-4000-8000-000000000000",
        activeSha256: final.sha256,
      },
      { activeFinalId: final.id, activeSha256: "0".repeat(64) },
      { activeFinalId: final.id, activeSha256: null },
      { activeFinalId: null, activeSha256: null },
    ];
    for (const report of reports) {
      await reportHmiStatus(
        database.db,
        hmi.id,
        { activeFinalId: final.id, activeSha256: final.sha256, appVersion: "" },
        T0,
      );
      expect(
        await reportHmiStatus(
          database.db,
          hmi.id,
          { ...report, appVersion: "\u0007" },
          T1,
        ),
      ).toEqual({ activeFinalId: null });
      expect(await getHmi(database.db, hmi.id)).toMatchObject({
        activeFinal: null,
        appVersion: null,
      });
    }
  });
});

describe("readBearerToken", () => {
  it("reads the token of a bearer header, case-insensitively", () => {
    expect(readBearerToken("Bearer abc")).toBe("abc");
    expect(readBearerToken("bearer  abc ")).toBe("abc");
    expect(readBearerToken("Bearer a b")).toBeNull();
    expect(readBearerToken(null)).toBeNull();
  });
});
