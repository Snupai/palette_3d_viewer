// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createSession, verifySession } from "~/server/auth/accounts";
import { deleteUser } from "~/server/auth/deleteUser";
import type { OpenDatabase } from "~/server/db/database";
import { plannerRecords, sessions, users } from "~/server/db/schema";
import { setServerDatabaseForTesting } from "~/server/db/serverDatabase";
import { openMigratedTestDatabase } from "~/server/db/testing";

import { GET as readRecord } from "../records/[store]/[id]/route";
import { DELETE } from "./users/[id]/route";

let database: OpenDatabase;
let adminCookie: string;
let userCookie: string;
const now = new Date();

beforeAll(async () => {
  database = await openMigratedTestDatabase();
});
afterAll(async () => {
  setServerDatabaseForTesting(undefined);
  await database.close();
});
beforeEach(async () => {
  setServerDatabaseForTesting(database.db);
  await database.db.delete(plannerRecords);
  await database.db.delete(users);
  await database.db.insert(users).values([
    { id: "admin", username: "chef", role: "admin", passwordHash: "unused" },
    { id: "user", username: "planer", role: "user", passwordHash: "unused" },
  ]);
  adminCookie = `palette_session=${(await createSession(database.db, "admin", now)).token}`;
  userCookie = `palette_session=${(await createSession(database.db, "user", now)).token}`;
});

function remove(id: string, cookie?: string) {
  return DELETE(
    new Request(`https://palette.local/api/admin/users/${id}`, {
      method: "DELETE",
      headers: cookie ? { cookie } : {},
    }),
    { params: Promise.resolve({ id }) },
  );
}

describe("DELETE /api/admin/users/:id", () => {
  it("guards anonymous, non-admin and local-mode requests", async () => {
    const anonymous = await remove("user");
    const forbidden = await remove("admin", userCookie);
    setServerDatabaseForTesting(null);
    const local = await remove("user", adminCookie);
    expect([anonymous.status, forbidden.status, local.status]).toEqual([
      401, 403, 404,
    ]);
    expect(await anonymous.json()).toEqual({ error: "unauthenticated" });
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
    expect(await database.db.select({ id: users.id }).from(users)).toHaveLength(
      2,
    );
  });

  it("revokes every target session while retaining readable records and the admin session", async () => {
    const second = await createSession(database.db, "user", now);
    await database.db.insert(plannerRecords).values({
      store: "projects",
      id: "saved-plan",
      json: { id: "saved-plan", name: "Plan" },
      createdBy: "user",
      version: 3,
    });
    const response = await remove("user", adminCookie);
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      await verifySession(database.db, userCookie.split("=")[1]!, now),
    ).toBeNull();
    expect(await verifySession(database.db, second.token, now)).toBeNull();
    expect(
      (await database.db.select().from(sessions)).map((row) => row.userId),
    ).toEqual(["admin"]);
    const record = await readRecord(
      new Request("https://palette.local/api/records/projects/saved-plan"),
      {
        params: Promise.resolve({ store: "projects", id: "saved-plan" }),
      },
    );
    expect(record.status).toBe(200);
    expect(await record.json()).toEqual({
      record: { id: "saved-plan", name: "Plan" },
      version: 3,
      createdBy: null,
    });
    expect((await remove("user", adminCookie)).status).toBe(404);
  });

  it("protects the last admin and self-deletion even with another admin", async () => {
    const last = await remove("admin", adminCookie);
    expect(last.status).toBe(409);
    expect(await last.json()).toEqual({ error: "last_admin" });
    await database.db.insert(users).values({
      id: "other",
      username: "vertretung",
      role: "admin",
      passwordHash: "unused",
    });
    const self = await remove("admin", adminCookie);
    expect(self.status).toBe(409);
    expect(await self.json()).toEqual({ error: "self_deletion" });
    expect((await remove("other", adminCookie)).status).toBe(204);
    expect(
      (await database.db.select().from(users)).map((row) => row.id).sort(),
    ).toEqual(["admin", "user"]);
  });

  it("rejects a caller deleted after authorization, preserving the remaining admin", async () => {
    await database.db.insert(users).values({
      id: "other",
      username: "vertretung",
      role: "admin",
      passwordHash: "unused",
    });
    expect(await deleteUser(database.db, "admin", "other")).toBe("deleted");
    expect(await deleteUser(database.db, "other", "admin")).toBe("forbidden");
    expect(await deleteUser(database.db, "admin", "missing")).toBe(
      "user_not_found",
    );
  });
});
