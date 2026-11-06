import { IDBFactory } from "fake-indexeddb";
import {
  createBrowserLocalPlannerStorage,
  createPlannerRecordStorage,
} from "~/lib/plannerStorageFactory";
import { describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import {
  createProjectPackage,
  exportProjectPackageJson,
} from "~/lib/projectPackage";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
  RecordVersionConflictError,
} from "~/lib/projectRepository";
import {
  isBrowserQuotaError,
  newWorkspacePlanOrigin,
  requestPersistentBrowserStorage,
  WorkspaceRepositoryModel,
} from "./workspaceRepositoryModel";

function setup(mode: "server" | "local" = "server") {
  const server = new ProjectRepository(new MemoryPlannerRecordStorage());
  const browser = new ProjectRepository(new MemoryPlannerRecordStorage());
  return {
    server,
    browser,
    model: new WorkspaceRepositoryModel(
      mode,
      server,
      mode === "server" ? browser : null,
    ),
  };
}
const plan = (id = "shared-id") =>
  createProject({ id, projectNumber: "LOCAL" });

describe("workspace repository routing", () => {
  it("creates anonymously in the browser and keeps server/session-loss targets explicit", () => {
    expect(newWorkspacePlanOrigin("server", { status: "anonymous" })).toBe(
      "browser-local",
    );
    expect(newWorkspacePlanOrigin("local", { status: "local" })).toBe("server");
    expect(
      newWorkspacePlanOrigin("server", {
        status: "signed-in",
        user: { id: "u", username: "u", role: "user" },
      }),
    ).toBe("server");
  });

  it("saves a browser plan without touching the server repository", async () => {
    const { model, server, browser } = setup();
    const request = vi.spyOn(server, "saveProjectVersioned");
    const saved = await model.save(plan(), "browser-local");
    expect(saved.version).toBe(1);
    expect(
      (await browser.getProject(saved.project.id)).project?.projectNumber,
    ).toBe("LOCAL");
    expect(request).not.toHaveBeenCalled();
  });

  it("persists an anonymous create across repositories without any records API request", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const factory = new IDBFactory();
    const server = new ProjectRepository(
      createPlannerRecordStorage({ mode: "server", fetch }),
    );
    const browser = new ProjectRepository(
      createBrowserLocalPlannerStorage({ indexedDb: factory }),
    );
    const model = new WorkspaceRepositoryModel("server", server, browser);
    await model.save(
      plan(),
      newWorkspacePlanOrigin("server", { status: "anonymous" }),
    );
    const reloaded = new ProjectRepository(
      createBrowserLocalPlannerStorage({ indexedDb: factory }),
    );
    expect(
      (await reloaded.getProject("shared-id")).project?.projectNumber,
    ).toBe("LOCAL");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a stale local delete after another tab saved", async () => {
    const { model, browser } = setup();
    await browser.saveProject(plan());
    await model.load("browser-local:shared-id");
    await browser.saveProject({ ...plan(), projectNumber: "OTHER TAB" });
    await expect(
      model.remove("browser-local:shared-id"),
    ).rejects.toBeInstanceOf(RecordVersionConflictError);
    expect((await browser.getProject("shared-id")).project?.projectNumber).toBe(
      "OTHER TAB",
    );
  });

  it("preserves distinct selection keys for the same id and reloads each origin", async () => {
    const { model, server, browser } = setup();
    await server.saveProject({ ...plan(), projectNumber: "SERVER" });
    await browser.saveProject(plan());
    const listed = await model.list();
    expect(listed.projects.map(model.keyFor).sort()).toEqual([
      "browser-local:shared-id",
      "server:shared-id",
    ]);
    expect((await model.load("server:shared-id")).project?.projectNumber).toBe(
      "SERVER",
    );
    expect(
      (await model.load("browser-local:shared-id")).project?.projectNumber,
    ).toBe("LOCAL");
    expect((await model.load("shared-id")).project?.projectNumber).toBe(
      "SERVER",
    );
  });

  it("uses the loaded local version even when the server has a different version", async () => {
    const { model, server, browser } = setup();
    await browser.saveProject(plan());
    await server.saveProject(plan());
    await server.saveProject(plan());
    const loaded = await model.load("browser-local:shared-id");
    const write = vi.spyOn(browser, "saveProjectVersioned");
    await model.save(loaded.project!, "browser-local", { expectedVersion: 2 });
    expect(write).toHaveBeenLastCalledWith(loaded.project, {
      expectedVersion: 1,
    });
  });

  it("rejects a stale save from another tab and retains the other tab's content", async () => {
    const { model, server, browser } = setup();
    await browser.saveProject(plan());
    const tab2 = new WorkspaceRepositoryModel("server", server, browser);
    const first = (await model.load("browser-local:shared-id")).project!;
    const second = (await tab2.load("browser-local:shared-id")).project!;
    await tab2.save({ ...second, projectNumber: "SECOND" }, "browser-local");
    await expect(
      model.save({ ...first, projectNumber: "FIRST" }, "browser-local"),
    ).rejects.toBeInstanceOf(RecordVersionConflictError);
    expect((await browser.getProject(first.id)).project?.projectNumber).toBe(
      "SECOND",
    );
  });

  it("does not refresh the loaded version just by listing the library", async () => {
    const { model, browser } = setup();
    await browser.saveProject(plan());
    const loaded = (await model.load("browser-local:shared-id")).project!;
    await browser.saveProject({ ...loaded, projectNumber: "OTHER TAB" });
    await model.list();
    await expect(model.save(loaded, "browser-local")).rejects.toBeInstanceOf(
      RecordVersionConflictError,
    );
  });

  it("copies a server plan into the browser under a fresh id on every copy", async () => {
    const { model, server, browser } = setup();
    await server.saveProject(plan());
    const one = await model.copy(plan(), "browser-local");
    const two = await model.copy(plan(), "browser-local");
    expect(new Set([plan().id, one.project.id, two.project.id]).size).toBe(3);
    expect((await browser.listProjects()).projects).toHaveLength(2);
    expect((await server.listProjects()).projects).toHaveLength(1);
    expect(model.keyFor(one.project)).toBe(`browser-local:${one.project.id}`);
  });

  it("deletes only the selected origin when both have the same id", async () => {
    const { model, browser, server } = setup();
    await browser.saveProject(plan());
    await server.saveProject(plan());
    expect(await model.remove("browser-local:shared-id")).toBe(true);
    expect(await browser.hasProject("shared-id")).toBe(false);
    expect(await server.hasProject("shared-id")).toBe(true);
  });

  it("imports packages anonymously into the browser with conditional writes", async () => {
    const { model, browser, server } = setup();
    const write = vi.spyOn(browser, "saveProjectVersioned");
    const result = await model.importPackage(
      exportProjectPackageJson({ projects: [plan()] }),
      "browser-local",
    );
    expect(result.projects.map(model.keyFor)).toEqual([
      "browser-local:shared-id",
    ]);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ id: "shared-id" }),
      { expectedVersion: null },
    );
    expect(await server.hasProject("shared-id")).toBe(false);
  });

  it("uses the local package conflict version and blocks a racing overwrite", async () => {
    const { model, browser } = setup();
    await browser.saveProject(plan());
    const get = browser.getProject.bind(browser);
    vi.spyOn(browser, "getProject").mockImplementation(async (id) => {
      const read = await get(id);
      await browser.saveProject({ ...plan(), projectNumber: "OTHER TAB" });
      return read;
    });
    await expect(
      model.importPackage(
        exportProjectPackageJson({ projects: [plan()] }),
        "browser-local",
        { projectConflictPolicy: "overwrite" },
      ),
    ).rejects.toBeInstanceOf(RecordVersionConflictError);
    expect((await get("shared-id")).project?.projectNumber).toBe("OTHER TAB");
  });

  it("keeps the local library usable when the server is unavailable", async () => {
    const { model, server, browser } = setup();
    await browser.saveProject(plan());
    vi.spyOn(server, "listProjects").mockRejectedValue(new Error("offline"));
    const result = await model.list();
    expect(result.projects.map(model.keyFor)).toEqual([
      "browser-local:shared-id",
    ]);
    expect(result.errors).toHaveLength(1);
  });

  it("leaves local mode keys and unconditional saves unchanged", async () => {
    const { model, server } = setup("local");
    const save = vi.spyOn(server, "saveProjectVersioned");
    const saved = await model.save(plan(), "server");
    expect(model.keyFor(saved.project)).toBe("shared-id");
    expect(save).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(
      createProjectPackage({ projects: [saved.project] }).projects,
    ).toHaveLength(1);
  });
});

describe("browser storage feedback", () => {
  it("recognizes quota errors even when a storage operation wraps them", () => {
    expect(
      isBrowserQuotaError(
        new Error("save", {
          cause: new DOMException("full", "QuotaExceededError"),
        }),
      ),
    ).toBe(true);
    expect(isBrowserQuotaError(new Error("offline"))).toBe(false);
  });
  it("requests persistent storage without blocking saves when the browser denies it", async () => {
    const persist = vi.fn().mockRejectedValue(new Error("denied"));
    await requestPersistentBrowserStorage({ persist });
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
