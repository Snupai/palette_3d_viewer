// @vitest-environment node
import { IDBFactory, IDBVersionChangeEvent } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { PREVIOUS_PROJECT_SCHEMA_VERSION } from "~/domain/project/projectSchema";
import { readLocalImportInventory } from "~/features/import/localImportModel";
import type { BrowserPlanSyncLink } from "~/lib/browserPlanStorage";
import {
  BROWSER_PLANNER_DATABASE_NAME,
  PROJECTS_STORE_NAME,
  PROJECT_QUARANTINE_STORE_NAME,
  openPlannerDatabase,
} from "~/lib/plannerDatabase";
import { IndexedDbPlannerRecordStorage } from "~/lib/plannerRecordStorage";
import { createBrowserLocalPlannerStorage } from "~/lib/plannerStorageFactory";
import { ProjectRepository } from "~/lib/projectRepository";

const link: BrowserPlanSyncLink = {
  server: "https://planner.example",
  userId: "user-1",
  serverId: "server-plan",
  syncedVersion: 3,
  syncedContentHash: "accepted-content",
  syncedAt: 50,
};

function setup() {
  const indexedDb = new IDBFactory();
  return {
    indexedDb,
    storage: createBrowserLocalPlannerStorage({ indexedDb, now: () => 10 }),
  };
}

const plan = createProject({ id: "plan" }, { now: () => 5 });

describe("browser-local planner storage", () => {
  it("isolates records, connections and legacy import inventory by database name", async () => {
    const { indexedDb, storage } = setup();
    const local = new IndexedDbPlannerRecordStorage(indexedDb);
    await storage.put(PROJECTS_STORE_NAME, plan);
    expect(await local.list(PROJECTS_STORE_NAME)).toEqual([]);
    expect((await readLocalImportInventory(local)).projects).toEqual([]);
    await local.put(PROJECTS_STORE_NAME, { ...plan, projectNumber: "legacy" });
    expect(await storage.get(PROJECTS_STORE_NAME, plan.id)).toEqual(plan);
    const browserDb = await openPlannerDatabase(
      indexedDb,
      BROWSER_PLANNER_DATABASE_NAME,
    );
    const localDb = await openPlannerDatabase(indexedDb);
    expect(browserDb).not.toBe(localDb);
    expect(
      await openPlannerDatabase(indexedDb, BROWSER_PLANNER_DATABASE_NAME),
    ).toBe(browserDb);
    // Invalidating one cached connection must not invalidate another name.
    browserDb.dispatchEvent(
      new IDBVersionChangeEvent("versionchange", {
        oldVersion: 5,
        newVersion: 6,
      }),
    );
    expect(await openPlannerDatabase(indexedDb)).toBe(localDb);
    expect(
      await openPlannerDatabase(indexedDb, BROWSER_PLANNER_DATABASE_NAME),
    ).not.toBe(browserDb);
  });

  it("creates metadata with the plan, keeps creation time and links on edits and reload", async () => {
    const { indexedDb, storage } = setup();
    await storage.put(PROJECTS_STORE_NAME, plan);
    await storage.setSyncLink(plan.id, link);
    const reloaded = createBrowserLocalPlannerStorage({
      indexedDb,
      now: () => 99,
    });
    await reloaded.put(PROJECTS_STORE_NAME, {
      ...plan,
      projectNumber: "edited",
    });
    expect(await reloaded.listMetadata()).toEqual([
      { id: plan.id, origin: "browser-local", createdAt: 10, links: [link] },
    ]);
    expect(
      await new IndexedDbPlannerRecordStorage(indexedDb).list(
        PROJECTS_STORE_NAME,
      ),
    ).toEqual([]);
  });

  it("updates links per server and account without losing concurrent writes", async () => {
    const { storage } = setup();
    await storage.put(PROJECTS_STORE_NAME, plan);
    const otherUser = { ...link, userId: "user-2" };
    const otherServer = { ...link, server: "https://other.example" };
    await Promise.all([
      storage.setSyncLink(plan.id, link),
      storage.setSyncLink(plan.id, otherUser),
      storage.setSyncLink(plan.id, otherServer),
    ]);
    const updated = { ...link, syncedVersion: 4 };
    await storage.setSyncLink(plan.id, updated);
    expect((await storage.getMetadata(plan.id))?.links).toEqual([
      otherUser,
      otherServer,
      updated,
    ]);
  });

  it("rolls back plan, version and metadata together on write failure", async () => {
    const indexedDb = new IDBFactory();
    const storage = createBrowserLocalPlannerStorage({
      indexedDb,
      now: () => {
        throw new Error("clock failed");
      },
    });
    await expect(storage.put(PROJECTS_STORE_NAME, plan)).rejects.toThrow(
      "clock failed",
    );
    expect(
      await storage.getVersioned(PROJECTS_STORE_NAME, plan.id),
    ).toBeUndefined();
    expect(await storage.listMetadata()).toEqual([]);
    const working = createBrowserLocalPlannerStorage({
      indexedDb,
      now: () => 10,
    });
    expect(await working.put(PROJECTS_STORE_NAME, plan)).toBe(1);
  });

  it("removes only the accepted payload and retains links and the version tombstone", async () => {
    const { storage } = setup();
    await storage.put(PROJECTS_STORE_NAME, plan);
    expect(await storage.confirmSync(plan.id, link, 1)).toBe("removed");
    expect(
      await storage.getVersioned(PROJECTS_STORE_NAME, plan.id),
    ).toBeUndefined();
    expect(await storage.listMetadata()).toEqual([
      { id: plan.id, origin: "browser-local", createdAt: 10, links: [link] },
    ]);
    await storage.setSyncLink(plan.id, { ...link, syncedVersion: 4 });
    expect((await storage.getMetadata(plan.id))?.links).toEqual([
      { ...link, syncedVersion: 4 },
    ]);
    expect(await storage.put(PROJECTS_STORE_NAME, plan)).toBe(2);
  });

  it("records sync links but protects newer edits and intentional deletions", async () => {
    const { storage } = setup();
    await storage.put(PROJECTS_STORE_NAME, plan);
    const edited = { ...plan, projectNumber: "newer" };
    await storage.put(PROJECTS_STORE_NAME, edited);
    expect(await storage.confirmSync(plan.id, link, 1)).toBe("retained");
    expect(await storage.getVersioned(PROJECTS_STORE_NAME, plan.id)).toEqual({
      record: edited,
      version: 2,
    });
    expect((await storage.getMetadata(plan.id))?.links).toEqual([link]);
    await storage.delete(PROJECTS_STORE_NAME, plan.id);
    expect(await storage.confirmSync(plan.id, link, 2)).toBe("retained");
    expect(await storage.listMetadata()).toEqual([]);
    await expect(storage.setSyncLink(plan.id, link)).rejects.toThrow(
      "does not exist",
    );
  });

  it("allows explicit removal of link-only metadata", async () => {
    const { storage } = setup();
    await storage.put(PROJECTS_STORE_NAME, plan);
    await storage.confirmSync(plan.id, link, 1);
    await storage.deleteMetadata(plan.id);
    expect(await storage.getMetadata(plan.id)).toBeUndefined();
  });

  it("performs local repository maintenance and never reports a server creator", async () => {
    const { storage } = setup();
    const repository = new ProjectRepository(storage);
    await storage.put(PROJECTS_STORE_NAME, {
      ...plan,
      schemaVersion: PREVIOUS_PROJECT_SCHEMA_VERSION,
    });
    const migrated = await repository.getProject(plan.id);
    expect(migrated.version).toBe(2);
    expect(await storage.get(PROJECTS_STORE_NAME, plan.id)).toEqual(
      migrated.project,
    );
    await storage.put(PROJECTS_STORE_NAME, {
      id: "future",
      schemaVersion: 999,
    });
    expect((await repository.getProject("future")).project).toBeNull();
    expect(
      (await storage.list(PROJECT_QUARANTINE_STORE_NAME)).map(
        (row) => (row as { id: string }).id,
      ),
    ).toEqual(["projects:future"]);
    expect(repository.projectCreatedBy(plan.id)).toBeUndefined();
    expect(await repository.deleteProject(plan.id)).toBe(true);
    expect(await storage.getMetadata(plan.id)).toBeUndefined();
  });
});
