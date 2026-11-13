// @vitest-environment node
import { asc, eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { OpenDatabase } from "../db/database";
import { plannerRecords, sessions, users } from "../db/schema";
import { openMigratedTestDatabase } from "../db/testing";
import { deleteUser } from "./deleteUser";
import {
  ActorNotAdminError,
  authenticate,
  countActiveSessions,
  createSession,
  createUser,
  deleteExpiredSessions,
  loginWithPassword,
  revokeAllSessionsForUser,
  revokeSession,
  setUserPassword,
  UsernameTakenError,
  verifySession,
} from "./accounts";
import type * as PasswordModule from "./password";
import { hashPassword } from "./password";
import { hashSessionToken, SESSION_TTL_MS } from "./sessionToken";

/**
 * One-shot hooks that run inside `authenticate`'s await points, so a test can
 * land a concurrent password reset exactly between verify and the rehash
 * write (or the final re-check). They wrap the real implementations.
 */
const interleave = vi.hoisted(() => ({
  afterVerify: undefined as (() => Promise<void>) | undefined,
  beforeHash: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("./password", async (importOriginal) => {
  const actual = await importOriginal<typeof PasswordModule>();
  return {
    ...actual,
    verifyPassword: async (storedHash: string, password: string) => {
      const result = await actual.verifyPassword(storedHash, password);
      const hook = interleave.afterVerify;
      interleave.afterVerify = undefined;
      if (hook) await hook();
      return result;
    },
    hashPassword: async (password: string) => {
      const hook = interleave.beforeHash;
      interleave.beforeHash = undefined;
      if (hook) await hook();
      return actual.hashPassword(password);
    },
  };
});

const NOW = new Date("2027-01-15T06:00:00.000Z");
const PASSWORD = "correct horse battery";
const NEW_PASSWORD = "a brand new passphrase";

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

/** One migrated PGlite per file; tables are emptied between tests. */
let database: OpenDatabase;
/** Hashed once: argon2 is deliberately slow and most tests don't need fresh hashes. */
let passwordHash: string;

beforeAll(async () => {
  [database, passwordHash] = await Promise.all([
    openMigratedTestDatabase(),
    hashPassword(PASSWORD),
  ]);
});

beforeEach(async () => {
  await database.db.execute(
    sql`TRUNCATE ${sessions}, ${plannerRecords}, ${users}`,
  );
});

afterEach(() => {
  interleave.afterVerify = undefined;
  interleave.beforeHash = undefined;
});

afterAll(async () => {
  await database.close();
});

function admin() {
  return createUser(
    database.db,
    { username: "Admin", password: PASSWORD, role: "admin" },
    NOW,
  );
}

/** Inserts a user directly with the shared hash, bypassing `createUser`. */
async function seedUser(username: string, role: "admin" | "user" = "admin") {
  const user = { id: `id-${username}`, username, role, createdAt: NOW };
  await database.db.insert(users).values({ ...user, passwordHash });
  return user;
}

async function storedHash(userId: string) {
  const [row] = await database.db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId));
  return row?.passwordHash;
}

/** Replaces the user's hash with one made with weaker argon2id parameters. */
async function storeWeakHash(userId: string) {
  const { hash } = await import("@node-rs/argon2");
  const weak = await hash(PASSWORD, {
    algorithm: 2,
    memoryCost: 8192,
    timeCost: 1,
    parallelism: 1,
  });
  await database.db
    .update(users)
    .set({ passwordHash: weak })
    .where(eq(users.id, userId));
}

/** Postgres error behind Drizzle's `DrizzleQueryError` wrapper. */
async function pgErrorOf(pending: Promise<unknown>) {
  const error = await pending.then(
    () => undefined,
    (e: unknown) => e,
  );
  const cause = (error as { cause?: { code?: string; constraint?: string } })
    ?.cause;
  return { code: cause?.code, constraint: cause?.constraint };
}

describe("users migration", () => {
  it("creates users and sessions with the issue #28 columns", async () => {
    const columns = async (table: string) => {
      const result = (await database.db.execute(
        sql`SELECT column_name AS name, data_type AS type
            FROM information_schema.columns
            WHERE table_name = ${table} ORDER BY ordinal_position`,
      )) as { rows: { name: string; type: string }[] };
      return result.rows;
    };
    expect(await columns("users")).toEqual([
      { name: "id", type: "text" },
      { name: "username", type: "text" },
      { name: "password_hash", type: "text" },
      { name: "role", type: "text" },
      { name: "created_at", type: "timestamp with time zone" },
    ]);
    expect(await columns("sessions")).toEqual([
      { name: "token_hash", type: "text" },
      { name: "user_id", type: "text" },
      { name: "expires_at", type: "timestamp with time zone" },
      { name: "created_at", type: "timestamp with time zone" },
    ]);
  });

  it("rejects roles other than admin and user", async () => {
    expect(
      await pgErrorOf(
        database.db.execute(
          sql`INSERT INTO users (id, username, password_hash, role) VALUES ('u', 'xyz', 'h', 'root')`,
        ),
      ),
    ).toEqual({ code: "23514", constraint: "users_role_valid" });
  });

  it("links planner_records.created_by to users and nulls it when the user is deleted", async () => {
    const user = await seedUser("admin");
    await database.db.insert(plannerRecords).values([
      { store: "projects", id: "p1", json: {}, createdBy: user.id },
      { store: "projects", id: "p2", json: {}, createdBy: null },
    ]);
    expect(
      await pgErrorOf(
        database.db.insert(plannerRecords).values({
          store: "projects",
          id: "p3",
          json: {},
          createdBy: "ghost",
        }),
      ),
    ).toEqual({
      code: "23503",
      constraint: "planner_records_created_by_users_id_fk",
    });

    await database.db.delete(users).where(eq(users.id, user.id));
    expect(
      await database.db
        .select({ id: plannerRecords.id, createdBy: plannerRecords.createdBy })
        .from(plannerRecords)
        .orderBy(asc(plannerRecords.id)),
    ).toEqual([
      { id: "p1", createdBy: null },
      { id: "p2", createdBy: null },
    ]);
  });
});

describe("createUser / authenticate", () => {
  it("stores a normalized username and an argon2id hash, never the password", async () => {
    const user = await admin();
    expect(user).toEqual({
      id: user.id,
      username: "admin",
      role: "admin",
      createdAt: NOW,
    });
    const stored = await storedHash(user.id);
    expect(stored?.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(stored?.includes(PASSWORD)).toBe(false);
  });

  it("rejects a duplicate username regardless of case", async () => {
    await admin();
    await expect(
      createUser(
        database.db,
        { username: "ADMIN", password: PASSWORD, role: "user" },
        NOW,
      ),
    ).rejects.toBeInstanceOf(UsernameTakenError);
    expect(await database.db.select({ id: users.id }).from(users)).toHaveLength(
      1,
    );
  });

  it("aborts admin create and reset when the acting admin is deleted mid-request", async () => {
    const actor = await seedUser("actor");
    const other = await seedUser("other");
    const target = await seedUser("target", "user");
    const deleteActor = async () => {
      expect(await deleteUser(database.db, other.id, actor.id)).toBe("deleted");
    };

    interleave.beforeHash = deleteActor;
    await expect(
      createUser(
        database.db,
        { username: "Backdoor", password: PASSWORD, role: "admin" },
        NOW,
        { actorId: actor.id },
      ),
    ).rejects.toBeInstanceOf(ActorNotAdminError);
    await expect(
      setUserPassword(database.db, target.id, NEW_PASSWORD, {
        actorId: actor.id,
      }),
    ).rejects.toBeInstanceOf(ActorNotAdminError);

    expect(
      (
        await database.db
          .select({ username: users.username })
          .from(users)
          .orderBy(asc(users.username))
      ).map((row) => row.username),
    ).toEqual(["other", "target"]);
    expect(await storedHash(target.id)).toBe(passwordHash);
  });

  it("authenticates the right password case-insensitively by username", async () => {
    const user = await admin();
    expect(await authenticate(database.db, " ADMIN ", PASSWORD)).toEqual(user);
  });

  it("returns null for a wrong password", async () => {
    await admin();
    expect(
      await authenticate(database.db, "admin", "correct horse batterY"),
    ).toBeNull();
  });

  it("returns null for an unknown or invalid username", async () => {
    await admin();
    expect(await authenticate(database.db, "nobody", PASSWORD)).toBeNull();
    expect(await authenticate(database.db, "x", PASSWORD)).toBeNull();
  });

  it("upgrades a hash made with weaker parameters on successful login", async () => {
    const user = await admin();
    await storeWeakHash(user.id);

    expect(await authenticate(database.db, "admin", PASSWORD)).toEqual(user);
    expect(
      (await storedHash(user.id))?.startsWith(
        "$argon2id$v=19$m=19456,t=2,p=1$",
      ),
    ).toBe(true);
  });
});

describe("authenticate racing a password reset (ADR 0005)", () => {
  it("does not let the rehash overwrite a reset that landed between verify and rehash", async () => {
    const user = await admin();
    await storeWeakHash(user.id);
    let resetHash: string | undefined;
    interleave.beforeHash = async () => {
      expect(await setUserPassword(database.db, user.id, NEW_PASSWORD)).toBe(
        true,
      );
      resetHash = await storedHash(user.id);
    };

    expect(await authenticate(database.db, "admin", PASSWORD)).toBeNull();
    expect(resetHash?.startsWith("$argon2id$v=19$m=19456,t=2,p=1$")).toBe(true);
    expect(await storedHash(user.id)).toBe(resetHash);
    expect(await authenticate(database.db, "admin", PASSWORD)).toBeNull();
    expect(await authenticate(database.db, "admin", NEW_PASSWORD)).toEqual(
      user,
    );
  });

  it("refuses a login whose verified hash was replaced by a reset without rehash", async () => {
    const user = await admin();
    interleave.afterVerify = async () => {
      expect(await setUserPassword(database.db, user.id, NEW_PASSWORD)).toBe(
        true,
      );
    };

    expect(await authenticate(database.db, "admin", PASSWORD)).toBeNull();
    expect(await authenticate(database.db, "admin", PASSWORD)).toBeNull();
    expect(await authenticate(database.db, "admin", NEW_PASSWORD)).toEqual(
      user,
    );
  });
});

describe("loginWithPassword (ADR 0005)", () => {
  it("creates a session and revokes the previous token in one step", async () => {
    const user = await admin();
    const previous = await createSession(database.db, user.id, NOW);

    const result = await loginWithPassword(
      database.db,
      "admin",
      PASSWORD,
      NOW,
      previous.token,
    );

    expect(result?.user).toEqual(user);
    expect(await verifySession(database.db, previous.token, NOW)).toBeNull();
    expect(
      (await verifySession(database.db, result!.session.token, NOW))?.user,
    ).toEqual(user);
    expect(await countActiveSessions(database.db, user.id, NOW)).toBe(1);
  });

  it("creates no session when a reset lands between verify and session insert", async () => {
    const user = await admin();
    interleave.afterVerify = async () => {
      expect(await setUserPassword(database.db, user.id, NEW_PASSWORD)).toBe(
        true,
      );
    };

    expect(
      await loginWithPassword(database.db, "admin", PASSWORD, NOW),
    ).toBeNull();
    expect(await countActiveSessions(database.db, user.id, NOW)).toBe(0);
  });

  it("returns null for a wrong password without touching sessions", async () => {
    const user = await admin();
    const previous = await createSession(database.db, user.id, NOW);
    expect(
      await loginWithPassword(
        database.db,
        "admin",
        "nope",
        NOW,
        previous.token,
      ),
    ).toBeNull();
    expect(
      await verifySession(database.db, previous.token, NOW),
    ).not.toBeNull();
  });
});

describe("sessions", () => {
  it("creates a session storing only the token hash", async () => {
    const user = await seedUser("admin");
    const { token, expiresAt } = await createSession(database.db, user.id, NOW);

    expect(expiresAt).toEqual(at(SESSION_TTL_MS));
    expect(await database.db.select().from(sessions)).toEqual([
      {
        tokenHash: hashSessionToken(token),
        userId: user.id,
        expiresAt: at(SESSION_TTL_MS),
        createdAt: NOW,
      },
    ]);
    expect(await verifySession(database.db, token, at(1))).toEqual({
      user,
      expiresAt: at(SESSION_TTL_MS),
    });
  });

  it("rejects unknown and malformed tokens", async () => {
    const user = await seedUser("admin");
    await createSession(database.db, user.id, NOW);
    expect(await verifySession(database.db, "a".repeat(43), NOW)).toBeNull();
    expect(await verifySession(database.db, "garbage", NOW)).toBeNull();
  });

  it("treats a session as expired exactly at expires_at and deletes it", async () => {
    const user = await seedUser("admin");
    const { token } = await createSession(database.db, user.id, NOW, 1000);

    expect((await verifySession(database.db, token, at(999)))?.user.id).toBe(
      user.id,
    );
    expect(await verifySession(database.db, token, at(1000))).toBeNull();
    expect(await database.db.select().from(sessions)).toEqual([]);
  });

  it("revokes a single session and leaves the others", async () => {
    const user = await seedUser("admin");
    const first = await createSession(database.db, user.id, NOW);
    const second = await createSession(database.db, user.id, NOW);

    expect(await revokeSession(database.db, first.token)).toBe(true);
    expect(await revokeSession(database.db, first.token)).toBe(false);
    expect(await verifySession(database.db, first.token, NOW)).toBeNull();
    expect((await verifySession(database.db, second.token, NOW))?.user.id).toBe(
      user.id,
    );
  });

  it("revokes all sessions of one user without touching other users", async () => {
    const owner = await seedUser("admin");
    const other = await seedUser("werker", "user");
    const ownerTokens: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ownerTokens.push((await createSession(database.db, owner.id, NOW)).token);
    }
    const otherToken = (await createSession(database.db, other.id, NOW)).token;

    expect(await revokeAllSessionsForUser(database.db, owner.id)).toBe(3);
    for (const token of ownerTokens) {
      expect(await verifySession(database.db, token, NOW)).toBeNull();
    }
    expect(await countActiveSessions(database.db, owner.id, NOW)).toBe(0);
    expect((await verifySession(database.db, otherToken, NOW))?.user.id).toBe(
      other.id,
    );
    expect(await countActiveSessions(database.db, other.id, NOW)).toBe(1);
  });

  it("revokes all sessions when the password is reset (ADR 0005)", async () => {
    const user = await seedUser("admin");
    const { token } = await createSession(database.db, user.id, NOW);

    expect(await setUserPassword(database.db, user.id, NEW_PASSWORD)).toBe(
      true,
    );
    expect(await verifySession(database.db, token, NOW)).toBeNull();
    expect(await authenticate(database.db, "admin", PASSWORD)).toBeNull();
    expect((await authenticate(database.db, "admin", NEW_PASSWORD))?.id).toBe(
      user.id,
    );
    expect(await setUserPassword(database.db, "missing", NEW_PASSWORD)).toBe(
      false,
    );
  });

  it("cleans up expired sessions and cascades on user deletion", async () => {
    const user = await seedUser("admin");
    await createSession(database.db, user.id, NOW, 1000);
    await createSession(database.db, user.id, NOW, 5000);

    expect(await deleteExpiredSessions(database.db, at(1000))).toBe(1);
    expect(await countActiveSessions(database.db, user.id, at(1000))).toBe(1);

    await database.db.delete(users).where(eq(users.id, user.id));
    expect(await database.db.select().from(sessions)).toEqual([]);
  });
});
