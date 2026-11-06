import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import type { PlannerSession } from "~/features/auth/plannerAccessModel";
import { BrowserLocalPlannerStorage } from "~/lib/browserPlanStorage";
import { PROJECTS_STORE_NAME } from "~/lib/plannerDatabase";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";
import {
  BrowserSyncController,
  type BrowserSyncControllerProps,
} from "./BrowserSyncController";

const ALICE: PlannerSession = {
  status: "signed-in",
  user: { id: "alice", username: "alice", role: "user" },
};
const local = (id: string, name: string) =>
  createProject({ id, productNumber: name }, { now: () => 100 });
afterEach(cleanup);
async function setup(projects = [local("new", "Neuer Browserplan")]) {
  sessionStorage.clear();
  const source = new BrowserLocalPlannerStorage(new IDBFactory());
  for (const project of projects)
    await source.put(PROJECTS_STORE_NAME, project);
  const storage = new MemoryPlannerRecordStorage();
  const repository = new ProjectRepository(storage);
  const props: BrowserSyncControllerProps = {
    source,
    server: "https://planner.test",
    session: ALICE,
    repository,
    creatorOf: (_store, id) => (id === "conflict-2" ? "bob" : "alice"),
    onImported: vi.fn(),
    onSessionLost: vi.fn(),
    openLocalSource: async () => ({ list: async () => [] }),
    readLegacyJson: () => null,
    now: () => 200,
  };
  return { source, storage, props };
}
async function start(count: number) {
  const button = screen.getByRole("button", {
    name: `${count} synchronisieren`,
  });
  expect(button).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("checkbox", { name: /für alle lesbar/ }));
  expect(button).toHaveProperty("disabled", false);
  fireEvent.click(button);
}

describe("BrowserSyncController", () => {
  it("keeps an unreadable inventory retry in the header without an automatic empty popup", async () => {
    const { source, props } = await setup();
    vi.spyOn(source, "list").mockRejectedValue(
      new Error("Browser-Speicher gesperrt"),
    );
    render(<BrowserSyncController {...props} />);
    const retry = await screen.findByRole("button", {
      name: "Browserpläne synchronisieren (0)",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(retry);
    await screen.findByRole("dialog", { name: "Browserpläne synchronisieren" });
    expect(screen.getByRole("alert").textContent).toBe(
      "Browser-Speicher gesperrt",
    );
    expect(
      screen.queryByText("Keine Browserpläne müssen synchronisiert werden."),
    ).toBeNull();
  });

  it("requires consent, resolves conflicts one at a time including a new 409, then summarizes exact outcomes", async () => {
    const { source, storage, props } = await setup([
      local("new", "Neuer Browserplan"),
      local("conflict-1", "Mein erster Plan"),
      local("conflict-2", "Mein zweiter Plan"),
    ]);
    await storage.put(
      PROJECTS_STORE_NAME,
      local("conflict-1", "Erster Serverplan"),
    );
    await storage.put(
      PROJECTS_STORE_NAME,
      local("conflict-2", "Zweiter Serverplan"),
    );
    const writes = vi.spyOn(storage, "put");
    render(<BrowserSyncController {...props} />);
    await screen.findByRole("dialog", { name: "Browserpläne synchronisieren" });
    expect(writes).not.toHaveBeenCalled();
    expect(screen.getByText("Neu")).toBeTruthy();
    expect(screen.getByText("Beidseitig geändert")).toBeTruthy();
    expect(screen.getByText("Anderer Ersteller")).toBeTruthy();
    await start(3);
    let comparison = await screen.findByRole("dialog", {
      name: "Plan existiert bereits auf dem Server",
    });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(within(comparison).getByText("Mein erster Plan")).toBeTruthy();
    // Someone saves while the user compares: the atomic replace must refresh.
    await storage.put(
      PROJECTS_STORE_NAME,
      local("conflict-1", "Noch neuerer Serverplan"),
    );
    fireEvent.click(
      within(comparison).getByRole("button", {
        name: /Lokalen Stand übernehmen/,
      }),
    );
    await screen.findByText("Noch neuerer Serverplan");
    fireEvent.click(
      screen.getByRole("button", { name: /Serverstand behalten/ }),
    );
    await screen.findByText("Mein zweiter Plan");
    comparison = screen.getByRole("dialog", {
      name: "Plan existiert bereits auf dem Server",
    });
    expect(
      within(comparison).getByRole("button", {
        name: /Lokalen Stand übernehmen/,
      }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(
      within(comparison).getByRole("button", { name: /Als Kopie übernehmen/ }),
    );
    await screen.findByText(
      "3 synchronisiert · 0 lokal behalten · 0 fehlgeschlagen",
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(await source.list(PROJECTS_STORE_NAME)).toEqual([]);
    const published = await props.repository.listProjects();
    expect(
      published.projects.map((project) => project.productNumber).sort(),
    ).toEqual([
      "Mein zweiter Plan",
      "Neuer Browserplan",
      "Noch neuerer Serverplan",
      "Zweiter Serverplan",
    ]);
    expect(props.onImported).toHaveBeenCalledTimes(3);
  });

  it("keeps unchecked plans local and orders the legacy popup after sync dismissal", async () => {
    const { source, props } = await setup([
      local("one", "Ausgewählt"),
      local("two", "Nur lokal"),
    ]);
    props.openLocalSource = async () => ({
      list: async (store) =>
        store === PROJECTS_STORE_NAME ? [local("legacy", "Alter Plan")] : [],
    });
    const view = render(<BrowserSyncController {...props} />);
    await screen.findByRole("dialog", { name: "Browserpläne synchronisieren" });
    expect(
      screen.queryByRole("button", { name: /Lokale Pläne übernehmen/ }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Nur lokal synchronisieren" }),
    );
    await start(1);
    await screen.findByText(
      "1 synchronisiert · 1 lokal behalten · 0 fehlgeschlagen",
    );
    fireEvent.click(screen.getByRole("button", { name: "Später" }));
    await screen.findByRole("dialog", {
      name: "Lokale Pläne auf den Server übernehmen",
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Browserpläne synchronisieren/ }),
      ).toHaveProperty("disabled", true),
    );
    fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
    expect(
      (await source.list(PROJECTS_STORE_NAME)).map(
        (row) => (row as { id: string }).id,
      ),
    ).toEqual(["two"]);
    view.unmount();
    render(<BrowserSyncController {...props} />);
    const manual = await screen.findByRole("button", {
      name: "Browserpläne synchronisieren (1)",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(manual);
    await screen.findByRole("dialog", { name: "Browserpläne synchronisieren" });
  });

  it("retains partial results across session loss and resumes without duplicating a published plan", async () => {
    const { source, storage, props } = await setup([
      local("one", "Erster Plan"),
      local("two", "Zweiter Plan"),
    ]);
    const put = storage.put.bind(storage);
    let calls = 0;
    vi.spyOn(storage, "put").mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2)
        throw new ServerStorageError(
          "unauthenticated",
          "put",
          PROJECTS_STORE_NAME,
          401,
        );
      return put(...args);
    });
    const view = render(<BrowserSyncController {...props} />);
    await screen.findByRole("dialog", { name: "Browserpläne synchronisieren" });
    await start(2);
    await waitFor(() => expect(props.onSessionLost).toHaveBeenCalledTimes(1));
    await screen.findByText(
      "1 synchronisiert · 0 lokal behalten · 1 fehlgeschlagen",
    );
    view.rerender(
      <BrowserSyncController {...props} session={{ status: "anonymous" }} />,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Melden Sie sich erneut an",
    );
    view.rerender(<BrowserSyncController {...props} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "1 synchronisieren" }),
      ).toHaveProperty("disabled", true),
    );
    expect(
      screen.getByText(
        "1 synchronisiert · 0 lokal behalten · 1 fehlgeschlagen",
      ),
    ).toBeTruthy();
    await start(1);
    await screen.findByText(
      "2 synchronisiert · 0 lokal behalten · 0 fehlgeschlagen",
    );
    expect(
      (await storage.list(PROJECTS_STORE_NAME))
        .map((row) => (row as { id: string }).id)
        .sort(),
    ).toEqual(["one", "two"]);
    expect(await source.list(PROJECTS_STORE_NAME)).toEqual([]);
    expect(calls).toBe(3);
  });
});
