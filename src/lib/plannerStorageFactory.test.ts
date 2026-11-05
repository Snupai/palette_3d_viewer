import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PLANNER_DATABASE_NAME,
  PLANNER_DATABASE_VERSION,
  PROJECTS_STORE_NAME,
} from "~/lib/plannerDatabase";
import {
  IndexedDbPlannerRecordStorage,
  type PlannerRecordStorage,
} from "~/lib/plannerRecordStorage";
import { createPlannerRecordStorage } from "~/lib/plannerStorageFactory";
import { createProjectRepository } from "~/lib/projectRepository";
import {
  ServerPlannerRecordStorage,
  ServerStorageError,
} from "~/lib/serverPlannerRecordStorage";
import type * as StorageModeModule from "~/lib/storageMode";
import {
  DEFAULT_STORAGE_MODE,
  resolveServerStorageConfig,
  StorageConfigError,
  type StorageMode,
} from "~/lib/storageMode";

const configured = vi.hoisted(() => ({
  mode: "local" as "local" | "server",
}));

vi.mock("~/lib/storageMode", async (importOriginal) => {
  const actual = await importOriginal<typeof StorageModeModule>();
  return {
    ...actual,
    get configuredStorageMode(): StorageMode {
      return configured.mode;
    },
  };
});

/**
 * IDBFactory stand-in that records every open and fails it, so a test can see
 * whether a storage reached IndexedDB without needing a real database.
 */
function recordingIndexedDb() {
  const opens: [string, number | undefined][] = [];
  const factory = {
    open(name: string, version?: number) {
      opens.push([name, version]);
      throw new Error("IndexedDB is unavailable in this test.");
    },
  } as unknown as IDBFactory;
  return { factory, opens };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (cause) {
    return cause;
  }
  throw new Error("Expected the promise to reject.");
}

afterEach(() => {
  configured.mode = "local";
  vi.unstubAllGlobals();
});

describe("createPlannerRecordStorage", () => {
  it("defaults the storage mode to local", () => {
    expect(DEFAULT_STORAGE_MODE).toBe("local");
  });

  it("returns the IndexedDB storage for local mode, bound to the given factory", async () => {
    const indexedDb = recordingIndexedDb();
    const storage = createPlannerRecordStorage({
      mode: "local",
      indexedDb: indexedDb.factory,
    });

    expect(storage).toBeInstanceOf(IndexedDbPlannerRecordStorage);
    await rejection(storage.list(PROJECTS_STORE_NAME));
    expect(indexedDb.opens).toEqual([
      [PLANNER_DATABASE_NAME, PLANNER_DATABASE_VERSION],
    ]);
  });

  it("returns the server storage for server mode and never opens IndexedDB", async () => {
    const indexedDb = recordingIndexedDb();
    const requests: string[] = [];
    const storage = createPlannerRecordStorage({
      mode: "server",
      indexedDb: indexedDb.factory,
      fetch: async (input, init) => {
        requests.push(
          `${init?.method} ${typeof input === "string" ? input : "non-string"}`,
        );
        throw new TypeError("fetch failed");
      },
    });

    expect(storage).toBeInstanceOf(ServerPlannerRecordStorage);
    const operations: [keyof PlannerRecordStorage, Promise<unknown>][] = [
      ["list", storage.list(PROJECTS_STORE_NAME)],
      ["get", storage.get(PROJECTS_STORE_NAME, "project-1")],
      ["getVersioned", storage.getVersioned(PROJECTS_STORE_NAME, "project-1")],
      ["put", storage.put(PROJECTS_STORE_NAME, { id: "project-1" })],
      ["delete", storage.delete(PROJECTS_STORE_NAME, "project-1")],
    ];
    for (const [operation, promise] of operations) {
      const cause = await rejection(promise);
      expect(cause).toBeInstanceOf(ServerStorageError);
      expect(cause).toMatchObject({
        kind: "network",
        operation,
        storeName: PROJECTS_STORE_NAME,
        status: null,
      });
    }
    expect(requests).toEqual([
      "GET /api/records/projects",
      "GET /api/records/projects/project-1",
      "GET /api/records/projects/project-1",
      "GET /api/records/projects/project-1",
      "GET /api/records/projects/project-1",
    ]);
    expect(indexedDb.opens).toEqual([]);
  });
});

describe("createProjectRepository storage selection", () => {
  it("uses IndexedDB when the configured mode is local", async () => {
    const indexedDb = recordingIndexedDb();
    vi.stubGlobal("indexedDB", indexedDb.factory);

    const cause = await rejection(createProjectRepository().listProjects());

    expect(cause).not.toBeInstanceOf(ServerStorageError);
    expect(indexedDb.opens).toEqual([
      [PLANNER_DATABASE_NAME, PLANNER_DATABASE_VERSION],
    ]);
  });

  it("fails in server mode instead of falling back to IndexedDB", async () => {
    configured.mode = "server";
    const indexedDb = recordingIndexedDb();
    vi.stubGlobal("indexedDB", indexedDb.factory);
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("fetch failed")));
    const repository = createProjectRepository();

    const listed = await rejection(repository.listProjects());

    expect(listed).toBeInstanceOf(ServerStorageError);
    expect(listed).toMatchObject({ kind: "network", operation: "list" });
    expect(indexedDb.opens).toEqual([]);
  });
});

describe("resolveServerStorageConfig", () => {
  const composeUrl = "postgresql://palette:palette@127.0.0.1:5432/palette";

  it("returns null in local mode even when a database URL is set", () => {
    expect(
      resolveServerStorageConfig({ mode: "local", databaseUrl: composeUrl }),
    ).toBeNull();
  });

  it.each([
    [`  ${composeUrl} `, composeUrl],
    [
      "postgres://palette:palette@db:5432/palette",
      "postgres://palette:palette@db:5432/palette",
    ],
  ])("returns the trimmed database URL in server mode (%j)", (input, url) => {
    expect(
      resolveServerStorageConfig({ mode: "server", databaseUrl: input }),
    ).toEqual({ mode: "server", databaseUrl: url });
  });

  it.each([undefined, "", "   "])(
    "rejects server mode without a database URL (%j)",
    (databaseUrl) => {
      expect(() =>
        resolveServerStorageConfig({ mode: "server", databaseUrl }),
      ).toThrow(
        new StorageConfigError(
          "NEXT_PUBLIC_PALETTE_STORAGE_MODE=server requires DATABASE_URL (a postgres:// or postgresql:// connection URL).",
        ),
      );
    },
  );

  it.each([
    "/var/lib/palette/palette.db",
    "mysql://palette:secret@127.0.0.1:3306/palette",
    "postgresql://",
  ])(
    "rejects a non-PostgreSQL database URL without echoing it (%j)",
    (databaseUrl) => {
      expect(() =>
        resolveServerStorageConfig({ mode: "server", databaseUrl }),
      ).toThrow(
        new StorageConfigError(
          "DATABASE_URL must be a postgres:// or postgresql:// URL.",
        ),
      );
    },
  );
});
