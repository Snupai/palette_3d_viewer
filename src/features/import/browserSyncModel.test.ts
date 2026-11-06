// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { getPalletTemplate } from "~/domain/project/palletTemplates";
import { createProjectResource } from "~/domain/project/projectResource";
import { createProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import { translateDe } from "~/i18n";
import { createBrowserLocalPlannerStorage } from "~/lib/plannerStorageFactory";
import {
  PROJECTS_STORE_NAME,
  PROJECT_RESOURCES_STORE_NAME,
} from "~/lib/plannerDatabase";
import { MemoryPlannerRecordStorage } from "~/lib/plannerRecordStorage";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";
import type { LocalImportTarget } from "./localImportModel";
import {
  browserSyncAbortReason,
  browserSyncContentHash,
  browserSyncErrorMessage,
  canStartBrowserSync,
  planBrowserSync,
  resolveBrowserSyncConflict,
  runBrowserSync,
  type BrowserSyncContext,
  type BrowserSyncOptions,
} from "./browserSyncModel";

const alice: BrowserSyncContext = {
  server: "https://planner.example",
  user: { id: "alice", username: "alice", role: "user" },
};
const bob: BrowserSyncContext = {
  ...alice,
  user: { id: "bob", username: "bob", role: "user" },
};
const options: BrowserSyncOptions = {
  publicConfirmed: true,
  isSessionLive: () => true,
  now: 900,
};
const base = createProject(
  { id: "p", projectNumber: "Base" },
  { now: () => 100, createId: (kind) => kind },
);
const changed = { ...base, projectNumber: "Local", updatedAt: 200 };
const serverChanged = { ...base, projectNumber: "Server", updatedAt: 300 };
const selected = new Set(["project:p"]);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing expected entry");
  return value;
}
async function setup(local: Project = base) {
  const source = createBrowserLocalPlannerStorage({
    indexedDb: new IDBFactory(),
    now: () => 10,
  });
  await source.put(PROJECTS_STORE_NAME, local);
  const storage = new MemoryPlannerRecordStorage();
  const actor = { id: alice.user.id };
  const creators = new Map<string, string>();
  const catalogCreate = vi.fn(async () => {
    throw new Error("Must never publish the catalog");
  });
  const catalogReplace = vi.fn(async () => {
    throw new Error("Must never publish the catalog");
  });
  const target: LocalImportTarget = {
    async readProject(id) {
      const row = await storage.getVersioned(PROJECTS_STORE_NAME, id);
      return row
        ? {
            kind: "found",
            state: {
              project: row.record as Project,
              version: row.version,
              createdBy: creators.get(id),
            },
          }
        : { kind: "missing" };
    },
    async createProject(project) {
      const version = await storage.put(PROJECTS_STORE_NAME, project, {
        expectedVersion: null,
      });
      creators.set(project.id, actor.id);
      return version;
    },
    replaceProject: (project, version) =>
      storage.put(PROJECTS_STORE_NAME, project, { expectedVersion: version }),
    readCatalog: vi.fn(async () => ({ kind: "missing" as const })),
    createCatalog: catalogCreate,
    replaceCatalog: catalogReplace,
  };
  const link = {
    server: alice.server,
    userId: alice.user.id,
    serverId: "p",
    syncedVersion: 1,
    syncedContentHash: browserSyncContentHash(base),
    syncedAt: 50,
  };
  const plan = () => planBrowserSync(source, target, alice);
  const entry = async () => required((await plan()).projects[0]);
  const run = async (opts: Partial<BrowserSyncOptions> = {}) =>
    runBrowserSync(source, target, await plan(), selected, alice, {
      ...options,
      ...opts,
    });
  return {
    source,
    storage,
    target,
    actor,
    creators,
    link,
    plan,
    entry,
    run,
    catalogCreate,
    catalogReplace,
  };
}

describe("browser sync three-way classification", () => {
  it.each([
    ["new", base, null, false],
    ["unchanged", base, base, false],
    ["unchanged", base, base, true],
    ["local-changed", changed, base, true],
    ["server-changed", base, serverChanged, true],
    ["conflict", changed, serverChanged, true],
    ["conflict", changed, base, false],
    ["server-deleted", base, null, true],
  ] as const)("classifies %s", async (status, local, server, linked) => {
    const f = await setup(local);
    if (server) {
      await f.target.createProject(base);
      if (server !== base) await f.target.replaceProject(server, 1);
    }
    if (linked) await f.source.setSyncLink("p", f.link);
    const result = await f.entry();
    expect(result.status).toBe(status);
    expect(result.pending).toBe(
      ["conflict", "server-deleted"].includes(status),
    );
    expect(result.selectable).toBe(true);
  });

  it("treats equal content with a foreign creator as an ownership decision", async () => {
    const f = await setup();
    f.actor.id = bob.user.id;
    await f.target.createProject(base);
    expect(await f.entry()).toMatchObject({
      status: "other-owner",
      canReplace: false,
      pending: true,
    });
    const run = await f.run();
    expect(run.outcomes.map(({ kind }) => kind)).toEqual(["conflict"]);
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(base);
  });

  it("uses only the matching server and user link", async () => {
    const f = await setup();
    await f.source.setSyncLink("p", {
      ...f.link,
      server: "https://other.example",
    });
    await f.source.setSyncLink("p", { ...f.link, userId: bob.user.id });
    expect(await f.entry()).toMatchObject({ status: "new", link: null });
  });

  it("blocks unreadable server records without treating them as deleted", async () => {
    const f = await setup();
    f.target.readProject = async () => ({ kind: "unreadable" });
    expect(await f.entry()).toMatchObject({
      status: "server-unreadable",
      selectable: false,
    });
    expect((await f.run()).outcomes).toEqual([
      { key: "project:p", kind: "kept-local" },
    ]);
  });
});

describe("browser sync consent, retention and retries", () => {
  it("requires selection and publication consent, and leaves declined plans and links untouched", async () => {
    const f = await setup();
    const plan = await f.plan();
    expect(canStartBrowserSync(plan, selected, false)).toBe(false);
    expect(canStartBrowserSync(plan, new Set(), true)).toBe(false);
    expect(canStartBrowserSync(plan, selected, true)).toBe(true);
    expect((await f.run({ publicConfirmed: false })).outcomes).toEqual([
      { key: "project:p", kind: "kept-local" },
    ]);
    expect(await f.storage.list(PROJECTS_STORE_NAME)).toEqual([]);
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(base);
    expect((await f.source.getMetadata("p"))?.links).toEqual([]);
  });

  it("publishes insert-only, keeps the accepted link and removes only the confirmed local payload", async () => {
    const f = await setup();
    const progress = vi.fn();
    expect(await f.run({ onProgress: progress })).toEqual({
      outcomes: [{ key: "project:p", kind: "synced", localRetained: false }],
      conflicts: [],
      aborted: null,
    });
    expect(progress.mock.calls).toEqual([
      [{ key: "project:p", kind: "synced", localRetained: false }],
    ]);
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toBeUndefined();
    expect((await f.source.getMetadata("p"))?.links).toEqual([
      { ...f.link, syncedAt: 900 },
    ]);
    expect((await f.plan()).projects).toEqual([]);
    expect(await f.target.readProject("p")).toMatchObject({
      kind: "found",
      state: { project: base, version: 1, createdBy: "alice" },
    });
  });

  it.each(["unchanged", "local-changed", "server-changed"] as const)(
    "retains accepted %s state",
    async (status) => {
      const f = await setup(status === "local-changed" ? changed : base);
      await f.target.createProject(base);
      await f.source.setSyncLink("p", f.link);
      if (status === "server-changed")
        await f.target.replaceProject(serverChanged, 1);
      expect((await f.run()).outcomes[0]).toEqual({
        key: "project:p",
        kind: "synced",
        localRetained: false,
      });
      const expected =
        status === "local-changed"
          ? changed
          : status === "server-changed"
            ? serverChanged
            : base;
      expect(await f.target.readProject("p")).toMatchObject({
        state: { project: expected, version: status === "unchanged" ? 1 : 2 },
      });
      expect((await f.source.getMetadata("p"))?.links[0]).toMatchObject({
        syncedContentHash: browserSyncContentHash(expected),
        syncedVersion: status === "unchanged" ? 1 : 2,
      });
    },
  );

  it("retains a newer local edit against the confirmed publication base", async () => {
    const f = await setup();
    const create = f.target.createProject.bind(f.target);
    f.target.createProject = async (project) => {
      const version = await create(project);
      await f.source.put(PROJECTS_STORE_NAME, changed);
      return version;
    };
    expect((await f.run()).outcomes[0]).toMatchObject({
      kind: "synced",
      localRetained: true,
    });
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(changed);
    expect((await f.entry()).status).toBe("local-changed");
  });

  it("does not pair an old payload with a newer sync link published by another tab", async () => {
    const f = await setup(changed);
    await f.target.createProject(base);
    await f.source.setSyncLink("p", f.link);
    const readMetadata = f.source.getMetadata.bind(f.source);
    let published = false;
    f.source.getMetadata = async (id) => {
      if (!published) {
        published = true;
        await f.source.put(PROJECTS_STORE_NAME, serverChanged);
        const version = await f.target.replaceProject(serverChanged, 1);
        await f.source.confirmSync(
          id,
          {
            ...f.link,
            syncedVersion: version,
            syncedContentHash: browserSyncContentHash(serverChanged),
          },
          2,
        );
      }
      return readMetadata(id);
    };
    await f.run();
    expect(await f.target.readProject("p")).toMatchObject({
      state: { project: serverChanged, version: 2 },
    });
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toBeUndefined();
    expect((await f.source.getMetadata("p"))?.links[0]?.syncedVersion).toBe(2);
  });

  it("recovers a lost create response without duplicates or cleanup on failure", async () => {
    const f = await setup();
    const create = f.target.createProject.bind(f.target);
    f.target.createProject = async (project) => {
      await create(project);
      throw network();
    };
    expect((await f.run()).aborted).toBe("network");
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(base);
    expect((await f.source.getMetadata("p"))?.links).toEqual([]);
    f.target.createProject = create;
    expect((await f.run()).outcomes[0]?.kind).toBe("synced");
    expect(
      (await f.storage.getVersioned(PROJECTS_STORE_NAME, "p"))?.version,
    ).toBe(1);
  });

  it("recovers failed local cleanup by comparing the accepted server state", async () => {
    const f = await setup();
    const confirm = f.source.confirmSync.bind(f.source);
    f.source.confirmSync = async () => {
      throw new Error("Local transaction failed");
    };
    expect((await f.run()).outcomes[0]?.kind).toBe("failed");
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(base);
    f.source.confirmSync = confirm;
    expect((await f.run()).outcomes[0]?.kind).toBe("synced");
    expect(
      (await f.storage.getVersioned(PROJECTS_STORE_NAME, "p"))?.version,
    ).toBe(1);
  });

  it("refreshes a 409 without overwriting a concurrent server change", async () => {
    const f = await setup(changed);
    await f.target.createProject(base);
    await f.source.setSyncLink("p", f.link);
    const plan = await f.plan();
    await f.target.replaceProject(serverChanged, 1);
    const run = await runBrowserSync(
      f.source,
      f.target,
      plan,
      selected,
      alice,
      options,
    );
    expect(run.outcomes[0]).toMatchObject({
      kind: "refreshed",
      entry: { status: "conflict", server: { version: 2 } },
    });
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(changed);
  });

  it("rechecks server-only adoption before cleanup", async () => {
    const f = await setup();
    await f.target.createProject(base);
    await f.source.setSyncLink("p", f.link);
    await f.target.replaceProject(serverChanged, 1);
    const plan = await f.plan();
    await f.target.replaceProject(
      { ...serverChanged, projectNumber: "Newer" },
      2,
    );
    expect(
      (await runBrowserSync(f.source, f.target, plan, selected, alice, options))
        .outcomes[0],
    ).toMatchObject({ kind: "refreshed", entry: { server: { version: 3 } } });
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(base);
  });
});

function network() {
  return new ServerStorageError("network", "put", PROJECTS_STORE_NAME, null);
}
async function conflictFixture() {
  const f = await setup(changed);
  await f.target.createProject(serverChanged);
  return f;
}
describe("browser sync conflict decisions", () => {
  it("keeps server, links it, and does not offer the rejected draft next login", async () => {
    const f = await conflictFixture();
    const result = await resolveBrowserSyncConflict(
      f.source,
      f.target,
      await f.entry(),
      "keep-server",
      alice,
      options,
    );
    expect(result).toEqual({
      key: "project:p",
      kind: "synced",
      localRetained: false,
    });
    expect((await f.source.getMetadata("p"))?.links[0]?.syncedContentHash).toBe(
      browserSyncContentHash(serverChanged),
    );
    expect((await f.plan()).projects).toEqual([]);
    expect(await f.target.readProject("p")).toMatchObject({
      state: { project: serverChanged, version: 1 },
    });
  });

  it("persists postponed conflicts in the durable source across replanning", async () => {
    const f = await conflictFixture();
    const run = await f.run();
    expect(run.conflicts.map(({ status }) => status)).toEqual(["conflict"]);
    // A new planner/session does not rely on an in-memory conflict queue.
    expect(
      (await planBrowserSync(f.source, f.target, alice)).projects[0]?.status,
    ).toBe("conflict");
    expect((await f.source.getMetadata("p"))?.links).toEqual([]);
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(changed);
  });

  it("replaces only at the compared version and refreshes on a second 409", async () => {
    const f = await conflictFixture();
    const entry = await f.entry();
    await f.target.replaceProject(
      { ...serverChanged, projectNumber: "Newer" },
      1,
    );
    const first = await resolveBrowserSyncConflict(
      f.source,
      f.target,
      entry,
      "keep-mine",
      alice,
      options,
    );
    expect(first).toMatchObject({
      kind: "refreshed",
      entry: { server: { version: 2 } },
    });
    expect(
      await resolveBrowserSyncConflict(
        f.source,
        f.target,
        required(first.entry),
        "keep-mine",
        alice,
        options,
      ),
    ).toMatchObject({ kind: "synced" });
    expect(await f.target.readProject("p")).toMatchObject({
      state: { project: changed, version: 3 },
    });
  });

  it("asks about deleted linked servers and publishes only as a new copy", async () => {
    const f = await setup(changed);
    await f.source.setSyncLink("p", f.link);
    const run = await f.run();
    expect(run.conflicts[0]?.status).toBe("server-deleted");
    expect(await f.storage.list(PROJECTS_STORE_NAME)).toEqual([]);
    const entry = required(run.conflicts[0]);
    expect(
      await resolveBrowserSyncConflict(
        f.source,
        f.target,
        entry,
        "keep-mine",
        alice,
        options,
      ),
    ).toEqual({ key: "project:p", kind: "kept-local" });
    expect(
      (
        await resolveBrowserSyncConflict(
          f.source,
          f.target,
          entry,
          "save-copy",
          alice,
          options,
        )
      ).kind,
    ).toBe("synced");
    const link = required((await f.source.getMetadata("p"))?.links[0]);
    expect(link.serverId).not.toBe("p");
    expect(await f.target.readProject("p")).toEqual({ kind: "missing" });
  });

  it("gives a deleted published copy a new identity and recovers its lost response", async () => {
    const f = await conflictFixture();
    await resolveBrowserSyncConflict(
      f.source,
      f.target,
      await f.entry(),
      "save-copy",
      alice,
      options,
    );
    const deletedId = required(
      (await f.source.getMetadata("p"))?.links[0],
    ).serverId;
    await f.source.put(PROJECTS_STORE_NAME, changed);
    await f.storage.delete(PROJECTS_STORE_NAME, deletedId);
    const entry = await f.entry();
    expect(entry.status).toBe("server-deleted");
    const create = f.target.createProject.bind(f.target);
    f.target.createProject = async (project) => {
      await create(project);
      throw network();
    };
    expect(
      (
        await resolveBrowserSyncConflict(
          f.source,
          f.target,
          entry,
          "save-copy",
          alice,
          options,
        )
      ).kind,
    ).toBe("failed");
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(changed);
    f.target.createProject = create;
    expect((await f.entry()).status).toBe("unchanged");
    expect((await f.run()).outcomes[0]?.kind).toBe("synced");
    const newId = required(
      (await f.source.getMetadata("p"))?.links[0],
    ).serverId;
    expect(newId).not.toBe(deletedId);
    expect(await f.target.readProject(deletedId)).toEqual({ kind: "missing" });
    expect((await f.storage.list(PROJECTS_STORE_NAME)).length).toBe(2);
  });

  it("accepts a confirmed deletion without recreating it", async () => {
    const f = await setup();
    await f.source.setSyncLink("p", f.link);
    expect(
      (
        await resolveBrowserSyncConflict(
          f.source,
          f.target,
          await f.entry(),
          "keep-server",
          alice,
          options,
        )
      ).kind,
    ).toBe("synced");
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toBeUndefined();
    expect((await f.source.getMetadata("p"))?.links).toEqual([f.link]);
    expect(await f.target.readProject("p")).toEqual({ kind: "missing" });
  });

  it("refreshes keep-server when the compared version moved", async () => {
    const f = await conflictFixture();
    const entry = await f.entry();
    await f.target.replaceProject(base, 1);
    expect(
      await resolveBrowserSyncConflict(
        f.source,
        f.target,
        entry,
        "keep-server",
        alice,
        options,
      ),
    ).toMatchObject({ kind: "refreshed" });
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(changed);
  });

  it("recovers ambiguous copy success and scopes copies to the publisher and server", async () => {
    const f = await conflictFixture();
    const entry = await f.entry();
    const create = f.target.createProject.bind(f.target);
    f.target.createProject = async (project) => {
      await create(project);
      throw network();
    };
    expect(
      await resolveBrowserSyncConflict(
        f.source,
        f.target,
        entry,
        "save-copy",
        alice,
        options,
      ),
    ).toMatchObject({ kind: "failed", error: { kind: "network" } });
    f.target.createProject = create;
    expect(await f.entry()).toMatchObject({ status: "unchanged" });
    expect((await f.run()).outcomes[0]?.kind).toBe("synced");
    const aliceId = required(
      (await f.source.getMetadata("p"))?.links[0],
    ).serverId;
    // Simulate the next person's independently retained local draft on this browser.
    await f.source.put(PROJECTS_STORE_NAME, changed);
    f.actor.id = bob.user.id;
    const bobEntry = required(
      (await planBrowserSync(f.source, f.target, bob)).projects[0],
    );
    expect(bobEntry.status).toBe("other-owner");
    expect(
      (
        await resolveBrowserSyncConflict(
          f.source,
          f.target,
          bobEntry,
          "save-copy",
          bob,
          options,
        )
      ).kind,
    ).toBe("synced");
    const bobId = required(
      (await f.source.getMetadata("p"))?.links.find(
        ({ userId }) => userId === "bob",
      ),
    ).serverId;
    expect(bobId).not.toBe(aliceId);
    expect(await f.target.readProject(bobId)).toMatchObject({
      state: { createdBy: "bob" },
    });
    await f.source.put(PROJECTS_STORE_NAME, changed);
    const otherServer = { ...alice, server: "https://second.example" };
    f.actor.id = alice.user.id;
    const otherEntry = required(
      (await planBrowserSync(f.source, f.target, otherServer)).projects[0],
    );
    expect(
      (
        await resolveBrowserSyncConflict(
          f.source,
          f.target,
          otherEntry,
          "save-copy",
          otherServer,
          options,
        )
      ).kind,
    ).toBe("synced");
    const otherId = required(
      (await f.source.getMetadata("p"))?.links.find(
        ({ server }) => server === otherServer.server,
      ),
    ).serverId;
    expect(otherId).not.toBe(aliceId);
    expect(otherId).not.toBe(bobId);
    expect((await f.storage.list(PROJECTS_STORE_NAME)).length).toBe(4);
  });

  it("does not let non-owners replace, including a forged canReplace flag", async () => {
    const f = await conflictFixture();
    const foreign = required(
      (await planBrowserSync(f.source, f.target, bob)).projects[0],
    );
    const result = await resolveBrowserSyncConflict(
      f.source,
      f.target,
      { ...foreign, canReplace: true },
      "keep-mine",
      bob,
      options,
    );
    // The server is authoritative for permission; model must also use current user.
    expect(result.kind).toBe("kept-local");
    expect(await f.target.readProject("p")).toMatchObject({
      state: { version: 1 },
    });
  });
});

describe("browser sync failures", () => {
  it.each([
    network(),
    new ServerStorageError("unauthenticated", "put", PROJECTS_STORE_NAME, 401),
  ])(
    "stops at the first fatal error, preserving prior success",
    async (error) => {
      const f = await setup();
      await f.source.put(PROJECTS_STORE_NAME, { ...base, id: "q" });
      await f.source.put(PROJECTS_STORE_NAME, { ...base, id: "r" });
      const create = f.target.createProject.bind(f.target);
      const calls: string[] = [];
      f.target.createProject = async (project) => {
        calls.push(project.id);
        if (project.id === "q") throw error;
        return create(project);
      };
      const run = await runBrowserSync(
        f.source,
        f.target,
        await f.plan(),
        new Set(["project:p", "project:q", "project:r"]),
        alice,
        options,
      );
      expect(run.aborted).toBe(browserSyncAbortReason(error));
      expect(calls).toEqual(["p", "q"]);
      expect(run.outcomes.map(({ kind }) => kind)).toEqual([
        "synced",
        "failed",
      ]);
      expect(
        (await f.source.list(PROJECTS_STORE_NAME)).map(
          (row) => (row as Project).id,
        ),
      ).toEqual(["q", "r"]);
    },
  );

  it("checks the live session before every plan and conflict decision", async () => {
    const f = await setup();
    expect((await f.run({ isSessionLive: () => false })).aborted).toBe(
      "unauthenticated",
    );
    const outcome = await resolveBrowserSyncConflict(
      f.source,
      f.target,
      await f.entry(),
      "save-copy",
      alice,
      { ...options, isSessionLive: () => false },
    );
    expect(browserSyncAbortReason(outcome.error)).toBe("unauthenticated");
    expect(await f.storage.list(PROJECTS_STORE_NAME)).toEqual([]);
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(base);
  });

  it("keeps oversized plans, reports 4 MiB specifically, and continues other entries", async () => {
    const f = await setup();
    await f.source.put(PROJECTS_STORE_NAME, { ...base, id: "q" });
    const create = f.target.createProject.bind(f.target);
    const error = new ServerStorageError(
      "server",
      "put",
      PROJECTS_STORE_NAME,
      413,
      "record_too_large",
    );
    f.target.createProject = async (project) => {
      if (project.id === "p") throw error;
      return create(project);
    };
    const run = await runBrowserSync(
      f.source,
      f.target,
      await f.plan(),
      new Set(["project:p", "project:q"]),
      alice,
      options,
    );
    expect(run.aborted).toBeNull();
    expect(run.outcomes.map(({ kind }) => kind)).toEqual(["failed", "synced"]);
    expect(browserSyncErrorMessage(error, translateDe)).toBe(
      "Der Plan ist zu groß. Der Server erlaubt höchstens 4 MiB pro Plan.",
    );
    expect(await f.source.get(PROJECTS_STORE_NAME, "p")).toEqual(base);
    expect((await f.source.getMetadata("p"))?.links).toEqual([]);
  });

  it.each(["user", "admin"] as const)(
    "ignores stray browser catalog rows for %s without changing them",
    async (role) => {
      const f = await setup();
      const resource = createProjectResource(
        { kind: "pallet", value: getPalletTemplate("euro") },
        { now: () => 5 },
      );
      await f.source.put(PROJECT_RESOURCES_STORE_NAME, resource);
      const context = { ...alice, user: { ...alice.user, role } };
      const plan = await planBrowserSync(f.source, f.target, context);
      expect(plan).toEqual({
        projects: [
          expect.objectContaining({ key: "project:p", status: "new" }),
        ],
        unreadable: [],
      });
      await runBrowserSync(
        f.source,
        f.target,
        plan,
        selected,
        context,
        options,
      );
      expect(await f.storage.get(PROJECTS_STORE_NAME, "p")).toEqual(base);
      expect(f.catalogCreate).not.toHaveBeenCalled();
      expect(f.catalogReplace).not.toHaveBeenCalled();
      expect(await f.source.list(PROJECT_RESOURCES_STORE_NAME)).toEqual([
        resource,
      ]);
    },
  );
});
