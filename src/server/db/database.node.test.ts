// @vitest-environment node
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { assertDatabaseUrl, type OpenDatabase, openDatabase } from "./database";
import { plannerRecords } from "./schema";
import { openMigratedTestDatabase, openTestDatabase } from "./testing";

const opened: OpenDatabase[] = [];

async function track(
  pending: OpenDatabase | Promise<OpenDatabase>,
): Promise<OpenDatabase> {
  const database = await pending;
  opened.push(database);
  return database;
}

/** Rows of a raw query; PGlite wraps them in `{ rows }`. */
async function rows<T>(database: OpenDatabase, query: ReturnType<typeof sql>) {
  const result = (await database.db.execute(query)) as { rows: T[] };
  return result.rows;
}

afterEach(async () => {
  for (const database of opened.splice(0)) await database.close();
});

describe("assertDatabaseUrl", () => {
  it("accepts postgres URLs and rejects anything else", () => {
    expect(
      assertDatabaseUrl(" postgres://palette:palette@127.0.0.1:5432/palette "),
    ).toBe("postgres://palette:palette@127.0.0.1:5432/palette");
    expect(assertDatabaseUrl("postgresql://db/palette")).toBe(
      "postgresql://db/palette",
    );
    for (const url of ["", "/var/lib/palette.db", "mysql://db/palette"]) {
      expect(() => assertDatabaseUrl(url)).toThrow(
        "DATABASE_URL must be a postgres:// or postgresql:// connection URL.",
      );
    }
  });

  it("is applied by openDatabase before any connection is made", () => {
    expect(() => openDatabase("file:palette.db")).toThrow(
      "DATABASE_URL must be a postgres:// or postgresql:// connection URL.",
    );
  });
});

describe("migrations", () => {
  it("create planner_records with the ADR 0004 columns", async () => {
    const database = await track(openMigratedTestDatabase());

    const columns = await rows(
      database,
      sql`SELECT column_name AS name, data_type AS type, is_nullable AS nullable, column_default AS "default"
          FROM information_schema.columns
          WHERE table_name = 'planner_records'
          ORDER BY ordinal_position`,
    );
    expect(columns).toEqual([
      { name: "store", type: "text", nullable: "NO", default: null },
      { name: "id", type: "text", nullable: "NO", default: null },
      { name: "json", type: "jsonb", nullable: "NO", default: null },
      { name: "version", type: "integer", nullable: "NO", default: "1" },
      { name: "created_by", type: "text", nullable: "YES", default: null },
      {
        name: "created_at",
        type: "timestamp with time zone",
        nullable: "NO",
        default: "now()",
      },
      {
        name: "updated_at",
        type: "timestamp with time zone",
        nullable: "NO",
        default: "now()",
      },
    ]);

    const primaryKey = await rows(
      database,
      sql`SELECT a.attname AS column
          FROM pg_index i
          JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, position) ON true
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
          WHERE i.indrelid = 'planner_records'::regclass AND i.indisprimary
          ORDER BY k.position`,
    );
    expect(primaryKey).toEqual([{ column: "store" }, { column: "id" }]);
  });

  it("are idempotent and recorded once", async () => {
    const database = await track(openTestDatabase());
    await database.migrate();
    await database.migrate();

    const applied = await rows(
      database,
      sql`SELECT COUNT(*)::int AS count FROM drizzle.__drizzle_migrations`,
    );
    expect(applied).toEqual([{ count: 1 }]);
  });
});

describe("planner_records", () => {
  // One migrated PGlite for this block (each boot costs ~2 s); emptied
  // between tests so every case starts from the migrated, empty table.
  let shared: OpenDatabase;
  beforeAll(async () => {
    shared = await openMigratedTestDatabase();
  });
  afterEach(async () => {
    await shared.db.execute(sql`TRUNCATE planner_records`);
  });
  afterAll(async () => {
    await shared.close();
  });
  it("round-trips jsonb records and fills version and timestamps", async () => {
    const { db } = shared;
    const json = {
      id: "p-1",
      name: "Halle 3",
      layers: [1, 2],
      nested: { a: null },
    };
    await db.insert(plannerRecords).values({
      store: "projects",
      id: "p-1",
      json,
      createdBy: "user-7",
      createdAt: new Date("2026-11-04T08:00:00.000Z"),
      updatedAt: new Date("2026-11-04T08:00:00.500Z"),
    });

    const stored = await db
      .select()
      .from(plannerRecords)
      .where(eq(plannerRecords.store, "projects"));
    expect(stored).toEqual([
      {
        store: "projects",
        id: "p-1",
        json,
        version: 1,
        createdBy: "user-7",
        createdAt: new Date("2026-11-04T08:00:00.000Z"),
        updatedAt: new Date("2026-11-04T08:00:00.500Z"),
      },
    ]);

    await db
      .insert(plannerRecords)
      .values({ store: "pallets", id: "d", json: {} });
    const [defaults] = await db
      .select({
        version: plannerRecords.version,
        createdBy: plannerRecords.createdBy,
        sameStamp: sql<boolean>`${plannerRecords.createdAt} = ${plannerRecords.updatedAt}`,
      })
      .from(plannerRecords)
      .where(eq(plannerRecords.store, "pallets"));
    expect(defaults).toEqual({ version: 1, createdBy: null, sameStamp: true });
  });

  it("allows the same id in different stores but not twice in one store", async () => {
    const { db } = shared;
    const row = { id: "shared", json: {} };
    await db.insert(plannerRecords).values({ ...row, store: "projects" });
    await db.insert(plannerRecords).values({ ...row, store: "pallets" });

    await expect(
      db.insert(plannerRecords).values({ ...row, store: "projects" }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message:
          'duplicate key value violates unique constraint "planner_records_store_id_pk"',
      }) as unknown,
    });
    const keys = await db
      .select({ store: plannerRecords.store, id: plannerRecords.id })
      .from(plannerRecords)
      .orderBy(asc(plannerRecords.store));
    expect(keys).toEqual([
      { store: "pallets", id: "shared" },
      { store: "projects", id: "shared" },
    ]);
  });

  it("rejects non-object JSON and non-positive versions", async () => {
    const { db } = shared;
    const row = { store: "projects", id: "p" };

    await expect(
      db
        .insert(plannerRecords)
        .values({ ...row, json: [1, 2] as unknown as Record<string, unknown> }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message:
          'new row for relation "planner_records" violates check constraint "planner_records_json_object"',
      }) as unknown,
    });
    await expect(
      db.insert(plannerRecords).values({ ...row, json: {}, version: 0 }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message:
          'new row for relation "planner_records" violates check constraint "planner_records_version_positive"',
      }) as unknown,
    });
  });
});
