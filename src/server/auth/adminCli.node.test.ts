// @vitest-environment node
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OpenDatabase } from "../db/database";
import { sessions, users } from "../db/schema";
import { openMigratedTestDatabase } from "../db/testing";
import {
  authenticate,
  createSession,
  createUser,
  verifySession,
} from "./accounts";
import {
  AdminCliError,
  adminPasswordProblem,
  initAdmin,
  resetAdminPassword,
  type AdminCommandIo,
} from "./adminCli";

const NOW = new Date("2026-11-05T10:00:00.000Z");
const GOOD = "correct-horse-battery";
const NEW = "staple-gun-orbit-42";

/** Scripted prompt: returns `answers` in order and records every label. */
function scriptedIo(...answers: string[]) {
  const labels: string[] = [];
  const reports: string[] = [];
  const io: AdminCommandIo = {
    prompt: async (label) => {
      labels.push(label);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`unexpected prompt ${label}`);
      return answer;
    },
    report: (message) => reports.push(message),
  };
  return { io, labels, reports };
}

describe("adminPasswordProblem", () => {
  it("accepts a long, varied password", () => {
    expect(adminPasswordProblem(GOOD, "admin")).toBeNull();
  });

  it("rejects short, username-containing and low-variety passwords", () => {
    expect(adminPasswordProblem("short-pw", "admin")).toBe(
      "password must be at least 12 characters",
    );
    expect(adminPasswordProblem("my-ADMIN-password", "admin")).toBe(
      "password must not contain the username",
    );
    expect(adminPasswordProblem("121212121212", "admin")).toBe(
      "password must contain at least 5 different characters",
    );
  });
});

describe("admin CLI", () => {
  let database: OpenDatabase;

  beforeAll(async () => {
    database = await openMigratedTestDatabase();
  });
  afterAll(async () => {
    await database.close();
  });
  beforeEach(async () => {
    await database.db.delete(users);
  });

  describe("initAdmin", () => {
    it("creates the admin after a confirmed password", async () => {
      const { io, labels } = scriptedIo(GOOD, GOOD);
      const result = await initAdmin(database.db, { now: NOW }, io);

      expect(result.status).toBe("created");
      expect(result.user.username).toBe("admin");
      expect(result.user.role).toBe("admin");
      expect(labels).toEqual([
        'New password for "admin": ',
        "Repeat password: ",
      ]);
      expect((await authenticate(database.db, "admin", GOOD))?.id).toBe(
        result.user.id,
      );
    });

    it("is idempotent: an existing admin stays unchanged and no password is asked", async () => {
      const first = await initAdmin(
        database.db,
        { now: NOW },
        scriptedIo(GOOD, GOOD).io,
      );
      const [before] = await database.db.select().from(users);

      const { io, labels } = scriptedIo();
      const second = await initAdmin(
        database.db,
        { username: "other-admin", now: NOW },
        io,
      );

      expect(second).toEqual({ status: "exists", user: first.user });
      expect(labels).toEqual([]);
      expect(await database.db.select().from(users)).toEqual([before]);
    });

    it("retries weak and mismatched passwords, then gives up without writing", async () => {
      const { io, reports } = scriptedIo("short", GOOD, "typo", "aaaaaaaaaaaa");
      await expect(initAdmin(database.db, { now: NOW }, io)).rejects.toThrow(
        AdminCliError,
      );
      expect(reports).toEqual([
        "password must be at least 12 characters",
        "passwords do not match",
        "password must contain at least 5 different characters",
      ]);
      expect(await database.db.select().from(users)).toEqual([]);
    });

    it("never promotes an existing non-admin account", async () => {
      await createUser(
        database.db,
        { username: "admin", password: GOOD, role: "user" },
        NOW,
      );
      await expect(
        initAdmin(database.db, { now: NOW }, scriptedIo(NEW, NEW).io),
      ).rejects.toThrow('username "admin" belongs to a non-admin account');
      const [row] = await database.db.select().from(users);
      expect(row?.role).toBe("user");
    });
  });

  describe("resetAdminPassword", () => {
    it("sets the new password and revokes only that admin's sessions", async () => {
      const admin = await createUser(
        database.db,
        { username: "admin", password: GOOD, role: "admin" },
        NOW,
      );
      const user = await createUser(
        database.db,
        { username: "worker", password: GOOD, role: "user" },
        NOW,
      );
      const adminSessions = [
        await createSession(database.db, admin.id, NOW),
        await createSession(database.db, admin.id, NOW),
      ];
      const userSession = await createSession(database.db, user.id, NOW);

      const reset = await resetAdminPassword(
        database.db,
        {},
        scriptedIo(NEW, NEW).io,
      );

      expect(reset.id).toBe(admin.id);
      for (const session of adminSessions) {
        expect(await verifySession(database.db, session.token, NOW)).toBeNull();
      }
      expect(
        (await verifySession(database.db, userSession.token, NOW))?.user.id,
      ).toBe(user.id);
      expect(
        await database.db
          .select()
          .from(sessions)
          .where(eq(sessions.userId, admin.id)),
      ).toEqual([]);
      expect(await authenticate(database.db, "admin", GOOD)).toBeNull();
      expect((await authenticate(database.db, "admin", NEW))?.id).toBe(
        admin.id,
      );
    });

    it("refuses unknown and non-admin usernames before prompting", async () => {
      await createUser(
        database.db,
        { username: "worker", password: GOOD, role: "user" },
        NOW,
      );
      const { io, labels } = scriptedIo();
      await expect(
        resetAdminPassword(database.db, { username: "Worker" }, io),
      ).rejects.toThrow('no admin named "worker"');
      await expect(resetAdminPassword(database.db, {}, io)).rejects.toThrow(
        "no admin exists yet; run admin:init first",
      );
      expect(labels).toEqual([]);
    });

    it("keeps the old password and sessions when no acceptable password is given", async () => {
      const admin = await createUser(
        database.db,
        { username: "admin", password: GOOD, role: "admin" },
        NOW,
      );
      const session = await createSession(database.db, admin.id, NOW);
      await expect(
        resetAdminPassword(
          database.db,
          {},
          scriptedIo("x", "y", "admin-password-1").io,
        ),
      ).rejects.toThrow(AdminCliError);
      expect(
        (await verifySession(database.db, session.token, NOW))?.user.id,
      ).toBe(admin.id);
      expect((await authenticate(database.db, "admin", GOOD))?.id).toBe(
        admin.id,
      );
    });
  });
});
