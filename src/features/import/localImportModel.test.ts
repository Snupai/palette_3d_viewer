// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getPalletTemplate } from "~/domain/project/palletTemplates";
import { createProject, updateProject } from "~/domain/project/projectFactory";
import {
  createProjectResource,
  type ProjectResource,
} from "~/domain/project/projectResource";
import type { Project } from "~/domain/project/projectSchema";
import type { SessionUser } from "~/features/auth/plannerAccessModel";
import {
  LEGACY_MIGRATIONS_STORE_NAME,
  PALLETS_STORE_NAME,
  PROJECT_RESOURCES_STORE_NAME,
  PROJECTS_STORE_NAME,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";
import type { SavedPallet } from "~/lib/palletTypes";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";
import { parseRobText } from "~/lib/robParser";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";
import {
  canStartImport,
  catalogImportCopyId,
  createLocalImportTarget,
  importableKeys,
  planLocalImport,
  projectImportCopyId,
  readLocalImportInventory,
  resolveCatalogImportConflict,
  resolveProjectImportConflict,
  runLocalImport,
  summarizeImportPlan,
  type LocalImportInventory,
  type LocalImportSource,
  type ProjectImportConflict,
} from "./localImportModel";

const ALICE: SessionUser = { id: "u-alice", username: "alice", role: "user" };
const BOB: SessionUser = { id: "u-bob", username: "bob", role: "user" };
const ADMIN: SessionUser = { id: "u-admin", username: "admin", role: "admin" };

const rawText = readFileSync(
  resolve(
    process.cwd(),
    "src",
    "lib",
    "__fixtures__",
    "anonymized-plan-lf.rob",
  ),
  "utf8",
);

function savedPallet(id: string, createdAt = 55): SavedPallet {
  return {
    schemaVersion: 1,
    id,
    name: `${id}.rob`,
    createdAt,
    data: parseRobText(rawText),
    rawText,
    originalRawText: rawText,
  };
}

function plan(id: string, projectNumber = "L-1", now = 100): Project {
  return createProject(
    { id, projectNumber, productNumber: "Coffee" },
    { createId: (kind) => `${id}-${kind}`, now: () => now },
  );
}

function euroPallet(): ProjectResource {
  return createProjectResource(
    { kind: "pallet", value: getPalletTemplate("euro") },
    { now: () => 5 },
  );
}

/** A local source that can only be listed, like the real import source. */
function localSource(
  stores: Partial<Record<PlannerStoreName, readonly unknown[]>>,
): LocalImportSource & { calls: PlannerStoreName[] } {
  const calls: PlannerStoreName[] = [];
  return {
    calls,
    async list(store) {
      calls.push(store);
      return structuredClone([...(stores[store] ?? [])]);
    },
  };
}

function inventoryOf(
  projects: Project[],
  catalog: ProjectResource[] = [],
): LocalImportInventory {
  return {
    projects: projects.map((project) => ({
      key: `project:${project.id}`,
      source: "project",
      project,
    })),
    catalog: catalog.map((resource) => ({
      key: `catalog:${resource.id}`,
      resource,
    })),
    unreadable: [],
  };
}

/**
 * The server side: a repository over a memory storage that records the
 * acting user as creator on insert and never changes it on update, like the
 * records API.
 */
function server(initialActor: SessionUser) {
  const storage = new MemoryPlannerRecordStorage();
  const repository = new ProjectRepository(storage);
  const creators = new Map<string, string | null>();
  const state = { actor: initialActor };
  const key = (store: PlannerStoreName, id: string) => `${store}:${id}`;
  const base = createLocalImportTarget(repository, (store, id) =>
    creators.get(key(store, id)),
  );
  const target = {
    ...base,
    async createProject(project: Project) {
      const version = await base.createProject(project);
      creators.set(key(PROJECTS_STORE_NAME, project.id), state.actor.id);
      return version;
    },
    async createCatalog(resource: ProjectResource) {
      const version = await base.createCatalog(resource);
      creators.set(
        key(PROJECT_RESOURCES_STORE_NAME, resource.id),
        state.actor.id,
      );
      return version;
    },
  };
  return {
    storage,
    repository,
    target,
    state,
    creatorOf: (id: string) => creators.get(key(PROJECTS_STORE_NAME, id)),
    async seed(project: Project, by: SessionUser) {
      const previous = state.actor;
      state.actor = by;
      await target.createProject(project);
      state.actor = previous;
    },
    async ids(store: PlannerStoreName = PROJECTS_STORE_NAME) {
      return (await storage.list(store))
        .map((row) => (row as { id: string }).id)
        .sort();
    },
  };
}

describe("readLocalImportInventory", () => {
  it("collects local plans, unmigrated saved pallets and the Werkskatalog by listing only", async () => {
    const newer = plan("newer", "L-2", 300);
    const older = plan("older", "L-1", 200);
    const migrated = savedPallet("migrated-pallet");
    const shadowed = savedPallet("newer");
    const fresh = savedPallet("fresh-pallet", 250);
    const source = localSource({
      [PROJECTS_STORE_NAME]: [older, newer, { id: "broken" }],
      [PALLETS_STORE_NAME]: [migrated, shadowed, fresh],
      [LEGACY_MIGRATIONS_STORE_NAME]: [
        { id: "migrated-pallet", projectId: "migrated-pallet", migratedAt: 1 },
      ],
      [PROJECT_RESOURCES_STORE_NAME]: [euroPallet(), { id: "bad-resource" }],
    });

    const inventory = await readLocalImportInventory(
      source,
      JSON.stringify([savedPallet("fresh-pallet", 250), savedPallet("legacy")]),
    );

    expect(inventory.projects.map(({ key, source }) => [key, source])).toEqual([
      ["project:newer", "project"],
      ["project:fresh-pallet", "legacy-pallet"],
      ["project:older", "project"],
      ["project:legacy", "legacy-pallet"],
    ]);
    expect(inventory.catalog.map(({ key }) => key)).toEqual([
      "catalog:pallet-euro",
    ]);
    expect(inventory.unreadable).toEqual([
      { store: PROJECTS_STORE_NAME, recordId: "broken" },
      { store: PROJECT_RESOURCES_STORE_NAME, recordId: "bad-resource" },
    ]);
    expect([...source.calls].sort()).toEqual(
      [
        LEGACY_MIGRATIONS_STORE_NAME,
        PALLETS_STORE_NAME,
        PROJECT_RESOURCES_STORE_NAME,
        PROJECTS_STORE_NAME,
      ].sort(),
    );
  });

  it("reports an unparsable legacy pallet list instead of guessing", async () => {
    const inventory = await readLocalImportInventory(localSource({}), "{");
    expect(inventory.projects).toEqual([]);
    expect(inventory.unreadable).toEqual([
      { store: PALLETS_STORE_NAME, recordId: null },
    ]);
  });
});

describe("planLocalImport", () => {
  it("classifies new, unchanged, differing and unreadable server entries", async () => {
    const remote = server(ALICE);
    const fresh = plan("fresh");
    const same = plan("same");
    const mineOnServer = plan("mine-on-server");
    const bobsOnServer = plan("bobs-on-server");
    await remote.seed({ ...same, updatedAt: 999 }, BOB);
    await remote.seed(plan("mine-on-server", "L-9"), ALICE);
    await remote.seed(plan("bobs-on-server", "L-9"), BOB);
    await remote.storage.put(PROJECTS_STORE_NAME, {
      id: "broken-on-server",
    });

    const result = await planLocalImport(
      remote.target,
      inventoryOf([
        fresh,
        same,
        mineOnServer,
        bobsOnServer,
        plan("broken-on-server"),
      ]),
      ALICE,
    );

    expect(
      result.projects.map(({ key, status, canReplace }) => [
        key,
        status,
        canReplace,
      ]),
    ).toEqual([
      ["project:fresh", "new", false],
      // Only `updatedAt` differs: the same plan, already imported.
      ["project:same", "unchanged", false],
      ["project:mine-on-server", "differs", true],
      ["project:bobs-on-server", "differs", false],
      ["project:broken-on-server", "server-unreadable", false],
    ]);
    expect(result.projects[2]?.server?.version).toBe(1);
    expect(importableKeys(result)).toEqual([
      "project:fresh",
      "project:mine-on-server",
      "project:bobs-on-server",
    ]);
  });

  it("lets an admin replace any differing plan", async () => {
    const remote = server(ADMIN);
    await remote.seed(plan("bobs", "L-9"), BOB);
    const result = await planLocalImport(
      remote.target,
      inventoryOf([plan("bobs")]),
      ADMIN,
    );
    expect(result.projects[0]).toMatchObject({
      status: "differs",
      canReplace: true,
    });
  });

  it("offers the Werkskatalog to admins only", async () => {
    const remote = server(ALICE);
    const euro = euroPallet();
    const inventory = inventoryOf([], [euro]);

    const forUser = await planLocalImport(remote.target, inventory, ALICE);
    const forAdmin = await planLocalImport(remote.target, inventory, ADMIN);

    expect(forUser.catalog[0]?.status).toBe("admin-only");
    expect(importableKeys(forUser)).toEqual([]);
    expect(forAdmin.catalog[0]?.status).toBe("new");
    expect(importableKeys(forAdmin)).toEqual(["catalog:pallet-euro"]);
  });

  it("needs a selection and the confirmation that imports become public", async () => {
    const remote = server(ALICE);
    const result = await planLocalImport(
      remote.target,
      inventoryOf([plan("fresh")]),
      ALICE,
    );
    const all = new Set(importableKeys(result));
    expect(canStartImport(result, all, false)).toBe(false);
    expect(canStartImport(result, new Set(), true)).toBe(false);
    expect(canStartImport(result, all, true)).toBe(true);
    expect(summarizeImportPlan(result)).toMatchObject({
      new: 1,
      unreadable: 0,
    });
  });
});

describe("runLocalImport", () => {
  it("creates new plans with the signed-in user as creator and is idempotent on retry", async () => {
    const remote = server(ALICE);
    const local = [plan("a"), plan("b")];
    const inventory = inventoryOf(local);
    const original = structuredClone(local);

    const first = await planLocalImport(remote.target, inventory, ALICE);
    const run = await runLocalImport(
      remote.target,
      first,
      new Set(importableKeys(first)),
      ALICE,
    );

    expect(run).toMatchObject({
      created: ["project:a", "project:b"],
      conflicts: [],
      failures: [],
      aborted: null,
    });
    expect(remote.creatorOf("a")).toBe("u-alice");
    expect((await remote.repository.getProject("a")).project).toEqual(local[0]);
    // The local originals are untouched.
    expect(local).toEqual(original);

    const retry = await planLocalImport(remote.target, inventory, ALICE);
    expect(retry.projects.map(({ status }) => status)).toEqual([
      "unchanged",
      "unchanged",
    ]);
    const second = await runLocalImport(
      remote.target,
      retry,
      new Set(retry.projects.map(({ key }) => key)),
      ALICE,
    );
    expect(second.created).toEqual([]);
    expect(await remote.ids()).toEqual(["a", "b"]);
    expect((await remote.repository.getProject("a")).version).toBe(1);
  });

  it("imports only the selected entries", async () => {
    const remote = server(ALICE);
    const result = await planLocalImport(
      remote.target,
      inventoryOf([plan("a"), plan("b")]),
      ALICE,
    );
    const run = await runLocalImport(
      remote.target,
      result,
      new Set(["project:b"]),
      ALICE,
    );
    expect(run.created).toEqual(["project:b"]);
    expect(await remote.ids()).toEqual(["b"]);
  });

  it("finds a plan created before an interrupted answer instead of duplicating it", async () => {
    const remote = server(ALICE);
    const local = plan("a");
    const stale = await planLocalImport(
      remote.target,
      inventoryOf([local]),
      ALICE,
    );
    // The first attempt reached the server but its answer was lost.
    await remote.seed(local, ALICE);

    const run = await runLocalImport(
      remote.target,
      stale,
      new Set(["project:a"]),
      ALICE,
    );

    expect(run).toMatchObject({
      created: [],
      alreadyImported: ["project:a"],
      conflicts: [],
    });
    expect(await remote.ids()).toEqual(["a"]);
  });

  it("turns a plan someone else created meanwhile into a conflict instead of overwriting it", async () => {
    const remote = server(ALICE);
    const local = plan("a");
    const stale = await planLocalImport(
      remote.target,
      inventoryOf([local]),
      ALICE,
    );
    await remote.seed(plan("a", "L-bob"), BOB);

    const run = await runLocalImport(
      remote.target,
      stale,
      new Set(["project:a"]),
      ALICE,
    );

    expect(run.created).toEqual([]);
    expect(run.conflicts).toHaveLength(1);
    expect(run.conflicts[0]).toMatchObject({
      key: "project:a",
      canReplace: false,
      refreshed: true,
      server: { version: 1, createdBy: "u-bob" },
    });
    expect(
      (await remote.repository.getProject("a")).project?.projectNumber,
    ).toBe("L-bob");
  });

  it("hands differing plans to the conflict view without writing", async () => {
    const remote = server(ALICE);
    await remote.seed(plan("a", "L-server"), ALICE);
    const result = await planLocalImport(
      remote.target,
      inventoryOf([plan("a")]),
      ALICE,
    );
    const run = await runLocalImport(
      remote.target,
      result,
      new Set(["project:a"]),
      ALICE,
    );
    expect(
      run.conflicts.map(({ key, canReplace }) => [key, canReplace]),
    ).toEqual([["project:a", true]]);
    expect((await remote.repository.getProject("a")).version).toBe(1);
  });

  it("never imports Werkskatalog entries for a non-admin, even when selected", async () => {
    const remote = server(ALICE);
    const euro = euroPallet();
    const result = await planLocalImport(
      remote.target,
      inventoryOf([], [euro]),
      ALICE,
    );
    const forced = {
      ...result,
      catalog: result.catalog.map((entry) => ({
        ...entry,
        status: "new" as const,
      })),
    };
    const run = await runLocalImport(
      remote.target,
      forced,
      new Set(["catalog:pallet-euro"]),
      ALICE,
    );
    expect(run.created).toEqual([]);
    expect(await remote.ids(PROJECT_RESOURCES_STORE_NAME)).toEqual([]);
  });

  it("imports Werkskatalog entries for an admin, once", async () => {
    const remote = server(ADMIN);
    const inventory = inventoryOf([], [euroPallet()]);
    const result = await planLocalImport(remote.target, inventory, ADMIN);
    const run = await runLocalImport(
      remote.target,
      result,
      new Set(importableKeys(result)),
      ADMIN,
    );
    expect(run.created).toEqual(["catalog:pallet-euro"]);
    const retry = await planLocalImport(remote.target, inventory, ADMIN);
    expect(retry.catalog[0]?.status).toBe("unchanged");
  });

  it("stops the run on a fatal error and keeps what was already created", async () => {
    const remote = server(ALICE);
    const result = await planLocalImport(
      remote.target,
      inventoryOf([plan("a"), plan("b")]),
      ALICE,
    );
    const expired = new ServerStorageError(
      "unauthenticated",
      "put",
      PROJECTS_STORE_NAME,
      401,
    );
    let calls = 0;
    const target = {
      ...remote.target,
      async createProject(project: Project) {
        calls += 1;
        if (calls === 2) throw expired;
        return remote.target.createProject(project);
      },
    };
    const run = await runLocalImport(
      target,
      result,
      new Set(importableKeys(result)),
      ALICE,
      {
        isFatal: (error) =>
          error instanceof ServerStorageError &&
          error.kind === "unauthenticated",
      },
    );
    expect(run.created).toEqual(["project:a"]);
    expect(run.aborted).toBe(expired);
  });

  it("reports a failing entry and continues with the next", async () => {
    const remote = server(ALICE);
    const result = await planLocalImport(
      remote.target,
      inventoryOf([plan("a"), plan("b")]),
      ALICE,
    );
    const broken = new Error("boom");
    const target = {
      ...remote.target,
      async createProject(project: Project) {
        if (project.id === "a") throw broken;
        return remote.target.createProject(project);
      },
    };
    const run = await runLocalImport(
      target,
      result,
      new Set(importableKeys(result)),
      ALICE,
    );
    expect(run.failures).toEqual([{ key: "project:a", error: broken }]);
    expect(run.created).toEqual(["project:b"]);
  });
});

describe("resolveProjectImportConflict", () => {
  async function conflictFor(
    by: SessionUser,
    actor: SessionUser,
  ): Promise<{
    remote: ReturnType<typeof server>;
    conflict: ProjectImportConflict;
    local: Project;
  }> {
    const remote = server(actor);
    await remote.seed(plan("a", "L-server"), by);
    const local = plan("a", "L-local");
    const result = await planLocalImport(
      remote.target,
      inventoryOf([local]),
      actor,
    );
    const run = await runLocalImport(
      remote.target,
      result,
      new Set(["project:a"]),
      actor,
    );
    const conflict = run.conflicts[0];
    if (!conflict) throw new Error("expected a conflict");
    return { remote, conflict, local };
  }

  it("keeps the server state without writing", async () => {
    const { remote, conflict } = await conflictFor(ALICE, ALICE);
    expect(
      await resolveProjectImportConflict(
        remote.target,
        conflict,
        "keep-server",
        {
          user: ALICE,
          now: 900,
        },
      ),
    ).toEqual({ kind: "kept-server" });
    expect((await remote.repository.getProject("a")).version).toBe(1);
  });

  it("imports a copy with a new id once, leaving the original and its creator alone", async () => {
    const { remote, conflict, local } = await conflictFor(BOB, ALICE);

    const first = await resolveProjectImportConflict(
      remote.target,
      conflict,
      "save-copy",
      { user: ALICE, now: 900, copyProjectNumber: "L-local Kopie" },
    );
    const copyId = projectImportCopyId(local);
    expect(first).toMatchObject({
      kind: "copied",
      project: {
        id: copyId,
        projectNumber: "L-local Kopie",
        createdAt: 900,
        updatedAt: 900,
      },
    });
    expect(copyId).not.toBe("a");
    expect(remote.creatorOf(copyId)).toBe("u-alice");
    expect(remote.creatorOf("a")).toBe("u-bob");

    const again = await resolveProjectImportConflict(
      remote.target,
      conflict,
      "save-copy",
      { user: ALICE, now: 950 },
    );
    expect(again).toEqual({ kind: "copy-exists", id: copyId });
    expect(await remote.ids()).toEqual(["a", copyId].sort());

    // The next import attempt knows this local state is already imported.
    const retry = await planLocalImport(
      remote.target,
      inventoryOf([local]),
      ALICE,
    );
    expect(retry.projects[0]?.status).toBe("copied");
    expect(importableKeys(retry)).toEqual([]);
  });

  it("scopes browser sync copies to each publisher while retries find their own copy", async () => {
    const { remote, conflict, local } = await conflictFor(BOB, ALICE);
    const resolveFor = (user: SessionUser) =>
      resolveProjectImportConflict(remote.target, conflict, "save-copy", {
        user,
        copyUserId: user.id,
        now: 900,
      });
    expect((await resolveFor(ALICE)).kind).toBe("copied");
    remote.state.actor = BOB;
    expect((await resolveFor(BOB)).kind).toBe("copied");
    expect(await resolveFor(ALICE)).toEqual({
      kind: "copy-exists",
      id: projectImportCopyId(local, ALICE.id),
    });
    expect(remote.creatorOf(projectImportCopyId(local, ALICE.id))).toBe(
      ALICE.id,
    );
    expect(remote.creatorOf(projectImportCopyId(local, BOB.id))).toBe(BOB.id);
    expect(await remote.ids()).toEqual(
      [
        "a",
        projectImportCopyId(local, ALICE.id),
        projectImportCopyId(local, BOB.id),
      ].sort(),
    );
  });

  it("refuses to replace a plan the user may not change", async () => {
    const { remote, conflict } = await conflictFor(BOB, ALICE);
    expect(conflict.canReplace).toBe(false);
    expect(
      await resolveProjectImportConflict(remote.target, conflict, "keep-mine", {
        user: ALICE,
        now: 900,
      }),
    ).toEqual({ kind: "forbidden" });
    expect(
      (await remote.repository.getProject("a")).project?.projectNumber,
    ).toBe("L-server");
  });

  it("replaces the creator's own plan at the compared version without changing the creator", async () => {
    const { remote, conflict, local } = await conflictFor(ALICE, ALICE);
    const outcome = await resolveProjectImportConflict(
      remote.target,
      conflict,
      "keep-mine",
      { user: ALICE, now: 900 },
    );
    expect(outcome).toEqual({ kind: "replaced", version: 2 });
    expect((await remote.repository.getProject("a")).project).toEqual(local);
    expect(remote.creatorOf("a")).toBe("u-alice");
  });

  it("lets an admin replace someone else's plan; the creator stays", async () => {
    const { remote, conflict } = await conflictFor(BOB, ADMIN);
    expect(conflict.canReplace).toBe(true);
    const outcome = await resolveProjectImportConflict(
      remote.target,
      conflict,
      "keep-mine",
      { user: ADMIN, now: 900 },
    );
    expect(outcome).toEqual({ kind: "replaced", version: 2 });
    expect(remote.creatorOf("a")).toBe("u-bob");
  });

  it("refreshes instead of replacing when the server changed after the comparison", async () => {
    const { remote, conflict } = await conflictFor(ALICE, ALICE);
    const moved = updateProject(
      plan("a", "L-server"),
      { projectNumber: "L-newer" },
      { now: () => 700 },
    );
    await remote.repository.saveProjectVersioned(moved, { expectedVersion: 1 });

    const outcome = await resolveProjectImportConflict(
      remote.target,
      conflict,
      "keep-mine",
      { user: ALICE, now: 900 },
    );

    expect(outcome.kind).toBe("refreshed");
    if (outcome.kind !== "refreshed") return;
    expect(outcome.conflict).toMatchObject({
      refreshed: true,
      canReplace: true,
      server: { version: 2, project: { projectNumber: "L-newer" } },
    });
    expect(
      (await remote.repository.getProject("a")).project?.projectNumber,
    ).toBe("L-newer");
  });

  it("creates the plan again when it was deleted on the server meanwhile", async () => {
    const { remote, conflict } = await conflictFor(ALICE, ALICE);
    await remote.storage.delete(PROJECTS_STORE_NAME, "a");
    const outcome = await resolveProjectImportConflict(
      remote.target,
      { ...conflict, server: null },
      "keep-mine",
      { user: ALICE, now: 900 },
    );
    expect(outcome).toEqual({ kind: "created", version: 2 });
  });
});

describe("resolveCatalogImportConflict", () => {
  async function catalogConflict() {
    const remote = server(ADMIN);
    const serverEuro = euroPallet();
    await remote.target.createCatalog(serverEuro);
    const local = { ...serverEuro, name: "Euro lokal" };
    const localValid = {
      ...local,
      value: { ...local.value, name: "Euro lokal" },
    } as ProjectResource;
    const result = await planLocalImport(
      remote.target,
      inventoryOf([], [localValid]),
      ADMIN,
    );
    const run = await runLocalImport(
      remote.target,
      result,
      new Set(importableKeys(result)),
      ADMIN,
    );
    const conflict = run.catalogConflicts[0];
    if (!conflict) throw new Error("expected a catalog conflict");
    return { remote, conflict, local: localValid };
  }

  it("replaces at the compared version or imports a renamed copy once", async () => {
    const { remote, conflict, local } = await catalogConflict();
    const copy = await resolveCatalogImportConflict(
      remote.target,
      conflict,
      "save-copy",
      { user: ADMIN, now: 900, copyName: "Euro lokal (Kopie)" },
    );
    const copyId = catalogImportCopyId(local);
    expect(copy).toMatchObject({
      kind: "copied",
      resource: { id: copyId, name: "Euro lokal (Kopie)" },
    });
    expect(
      await resolveCatalogImportConflict(remote.target, conflict, "save-copy", {
        user: ADMIN,
        now: 950,
        copyName: "Euro lokal (Kopie)",
      }),
    ).toEqual({ kind: "copy-exists", id: copyId });

    expect(
      await resolveCatalogImportConflict(remote.target, conflict, "keep-mine", {
        user: ADMIN,
        now: 900,
        copyName: "",
      }),
    ).toEqual({ kind: "replaced", version: 2 });
    expect(
      (await remote.repository.getResource("pallet-euro")).resource?.name,
    ).toBe("Euro lokal");
  });

  it("refuses every choice for a non-admin", async () => {
    const { remote, conflict } = await catalogConflict();
    expect(
      await resolveCatalogImportConflict(remote.target, conflict, "keep-mine", {
        user: ALICE,
        now: 900,
        copyName: "x",
      }),
    ).toEqual({ kind: "forbidden" });
    expect((await remote.repository.getResource("pallet-euro")).version).toBe(
      1,
    );
  });
});
