import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject, updateProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import { PlannerProjectWorkspace } from "~/features/project/PlannerProjectWorkspace";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
  RecordVersionConflictError,
} from "~/lib/projectRepository";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";
import {
  readDraftBackups,
  writeDraftBackup,
  type DraftBackupScope,
  type DraftBackupStorage,
} from "~/features/project/draftBackupModel";

vi.mock("~/components/RobViewer", () => ({
  RobViewer: () => <div data-testid="rob-viewer" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

/** Browser storage for the draft backups (#35); the test runtime has none. */
function stubLocalStorage(): DraftBackupStorage {
  const entries = new Map<string, string>();
  const storage: DraftBackupStorage = {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
  vi.stubGlobal("localStorage", storage);
  return storage;
}

const aliceScope = () => ({
  server: window.location.origin,
  userId: "u-alice",
});

/** A backup an earlier session's draft left behind. */
function seedBackup(
  storage: DraftBackupStorage,
  scope: DraftBackupScope,
  project: Project,
  baseVersion: number | null,
  savedAt: number,
) {
  writeDraftBackup(storage, scope, project, baseVersion, savedAt, {
    token: `earlier-${scope.userId}-${project.id}`,
    rev: 1,
  });
}

function plannerProject() {
  return createProject(
    {
      id: "planner-editor-project",
      projectNumber: "M5-EDITOR",
      package: {
        dimensionsMm: { length: 100, width: 50, height: 40 },
        multiPickAllowed: false,
      },
      pallet: {
        id: "pallet-1",
        name: "Editor pallet",
        kind: "custom",
        dimensionsMm: { length: 400, width: 300, height: 20 },
        storageEnvelopeMm: { length: 400, width: 300, height: 500 },
        allowedOverhangMm: { length: 0, width: 0 },
        tareKg: null,
        maxGrossKg: null,
        subPalletPattern: "none",
      },
      solutions: [
        {
          id: "solution-1",
          name: "Solution 1",
          origin: "manual",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern 1",
              grips: [],
              placements: [
                {
                  id: "placement-1",
                  sequence: 0,
                  positionMm: { x: 600, y: 400 },
                  rotation: 0,
                  gripId: null,
                  labelSide: null,
                },
              ],
            },
          ],
          stack: {
            interlayerThicknessMm: 3,
            layers: [
              {
                id: "layer-1",
                patternId: "pattern-1",
                interlayerBefore: 0,
              },
            ],
            trailingInterlayer: 0,
          },
          robotCycles: [],
        },
      ],
      activeSolutionId: "solution-1",
    },
    { now: () => 1, createId: (kind) => `${kind}-unused` },
  );
}

async function repositoryWithProject() {
  const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
    now: () => 10,
    createId: (kind) => `${kind}-repository`,
  });
  const project = plannerProject();
  await repository.saveProject(project);
  return { project, repository };
}

const referenceRob = [
  "1200 800 144",
  "200 300 150 1",
  "1",
  "1",
  "0 0",
  "1 0",
  "1",
  "100 50 0 600 400 0 1 0 0",
].join("\n");

async function openSavedPlan() {
  fireEvent.click(
    screen.getByRole("button", { name: /^Vorhandene Pläne ansehen/ }),
  );
  fireEvent.click(
    await screen.findByRole(
      "button",
      { name: "M5-EDITOR öffnen" },
      { timeout: 5_000 },
    ),
  );
}
/** Opens the saved plan in the pattern editor and leaves one unsaved edit. */
/** Server mode needs a session that may save (#34): the plan's creator. */
const signedInFetch: typeof fetch = async (input) => {
  if (input !== "/api/auth/me") throw new Error("unexpected request");
  return new Response(
    JSON.stringify({
      user: { id: "u-alice", username: "alice", role: "user" },
    }),
    { status: 200 },
  );
};

async function editLabelSideInEditor(
  onUnsavedChange: ReturnType<typeof vi.fn>,
) {
  await openSavedPlan();
  expect(
    await screen.findByRole(
      "heading",
      { name: "M5-EDITOR" },
      { timeout: 5_000 },
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Muster bearbeiten" }));
  expect(await screen.findByTestId("project-editor-workspace")).toBeTruthy();
  const packageRect = document.querySelector<SVGRectElement>(
    '[data-placement-id="placement-1"] rect',
  )!;
  fireEvent.pointerDown(packageRect, {
    pointerId: 1,
    clientX: 100,
    clientY: 200,
  });
  fireEvent.pointerUp(packageRect, {
    pointerId: 1,
    clientX: 100,
    clientY: 200,
  });
  fireEvent.change(screen.getByLabelText("Etikettseite"), {
    target: { value: "left" },
  });
  await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(true));
}

describe("PlannerProjectWorkspace editor integration", () => {
  it("guards browser edits before sign-in and keeps subsequent editor saves local", async () => {
    const { project, repository: browser } = await repositoryWithProject();
    const server = new ProjectRepository(new MemoryPlannerRecordStorage());
    const serverSave = vi.spyOn(server, "saveProjectVersioned");
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      input === "/api/auth/me"
        ? new Response(null, { status: 401 })
        : new Response(
            JSON.stringify({
              user: { id: "u-alice", username: "alice", role: "user" },
            }),
          ),
    );
    const dirty = vi.fn();
    render(
      <PlannerProjectWorkspace
        repository={server}
        browserRepository={browser}
        storageMode="server"
        fetchImpl={fetchImpl}
        onUnsavedChange={dirty}
      />,
    );
    await editLabelSideInEditor(dirty);
    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Kennwort"), {
      target: { value: "secret" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Anmelden" }));
    await screen.findByText(
      "Speichern oder verwerfen Sie zuerst die ungespeicherten Änderungen am Browserplan. Melden Sie sich danach erneut an.",
    );
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(["/api/auth/me"]);
    const save = vi.spyOn(browser, "saveProjectVersioned");
    fireEvent.click(
      screen.getByRole("button", { name: "Im Browser speichern" }),
    );
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
    expect(save.mock.calls[0]?.[1]).toEqual({ expectedVersion: 1 });
    fireEvent.submit(screen.getByRole("form", { name: "Anmelden" }));
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    fireEvent.change(screen.getByLabelText("Etikettseite"), {
      target: { value: "right" },
    });
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
    fireEvent.click(
      screen.getByRole("button", { name: "Im Browser speichern" }),
    );
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
    expect(save.mock.calls[1]?.[1]).toEqual({ expectedVersion: 2 });
    expect(
      (await browser.getProject(project.id)).project?.solutions[0]?.patterns[0]
        ?.placements[0]?.labelSide,
    ).toBe("right");
    expect(serverSave).not.toHaveBeenCalled();
    expect(window.location.pathname).toContain("browser-local");
  });

  it("keeps a browser editor draft when a second tab has saved and reports quota failures visibly", async () => {
    const { project, repository: browser } = await repositoryWithProject();
    const server = new ProjectRepository(new MemoryPlannerRecordStorage());
    const dirty = vi.fn();
    render(
      <PlannerProjectWorkspace
        repository={server}
        browserRepository={browser}
        storageMode="server"
        fetchImpl={async () => new Response(null, { status: 401 })}
        onUnsavedChange={dirty}
      />,
    );
    await editLabelSideInEditor(dirty);
    await browser.saveProject({ ...project, projectNumber: "OTHER TAB" });
    fireEvent.click(
      screen.getByRole("button", { name: "Im Browser speichern" }),
    );
    await screen.findByText(
      /Dieser Browserplan wurde in einem anderen Tab geändert/,
    );
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect((await browser.getProject(project.id)).project?.projectNumber).toBe(
      "OTHER TAB",
    );
    vi.spyOn(browser, "saveProjectVersioned").mockRejectedValueOnce(
      new DOMException("full", "QuotaExceededError"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Im Browser speichern" }),
    );
    await screen.findByText(/Der Browserspeicher ist voll/);
    expect(dirty).toHaveBeenLastCalledWith(true);
  });

  it("guards a dirty editor, propagates its draft, and saves through the repository", async () => {
    const { project, repository } = await repositoryWithProject();
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
      />,
    );
    await openSavedPlan();
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-EDITOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Muster bearbeiten" }));
    expect(await screen.findByTestId("project-editor-workspace")).toBeTruthy();

    const packageRect = document.querySelector<SVGRectElement>(
      '[data-placement-id="placement-1"] rect',
    )!;
    fireEvent.pointerDown(packageRect, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerUp(packageRect, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.change(screen.getByLabelText("Etikettseite"), {
      target: { value: "left" },
    });
    await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(true));

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(confirm).toHaveBeenCalledWith(
      "Planliste öffnen: Ungespeicherte Änderungen verwerfen?",
    );
    expect(screen.getByTestId("project-editor-workspace")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Planbibliothek" })).toBeNull();
    confirm.mockRestore();

    fireEvent.click(screen.getByLabelText("Greifreihenfolge"));
    expect(
      await screen.findByRole("heading", { name: "Griffe in Reihenfolge" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(async () => {
      const saved = await repository.getProject(project.id);
      expect(
        saved.project?.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
      ).toBe("left");
    });
    await waitFor(() =>
      expect(onUnsavedChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("opens the conflict view when someone else saved in between (server mode)", async () => {
    const { project, repository } = await repositoryWithProject();
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    await editLabelSideInEditor(onUnsavedChange);

    // Another session saves the plan at version 1 → 2.
    await repository.saveProjectVersioned(
      updateProject(project, { projectNumber: "THEIRS" }, { now: () => 20 }),
      { expectedVersion: 1 },
    );

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Plan wurde inzwischen geändert",
    });
    expect(
      dialog.querySelector('[data-row="projectNumber"]')?.textContent,
    ).toBe("Linie / Auftrag (abweichend)M5-EDITORTHEIRS");
    expect(
      [...dialog.querySelectorAll("[data-differs]")].map((row) =>
        row.getAttribute("data-row"),
      ),
    ).toEqual(["projectNumber", "patterns"]);
    // Nothing was overwritten, and the draft is still unsaved.
    expect(
      (await repository.getProject(project.id)).project?.projectNumber,
    ).toBe("THEIRS");
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(
      screen.getByRole("button", { name: "Meinen Entwurf speichern" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Plan wurde inzwischen geändert",
        }),
      ).toBeNull(),
    );
    const saved = await repository.getProject(project.id);
    expect(saved.version).toBe(3);
    expect(saved.project?.projectNumber).toBe("M5-EDITOR");
    expect(
      saved.project?.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
    ).toBe("left");
    await waitFor(() =>
      expect(onUnsavedChange).toHaveBeenLastCalledWith(false),
    );
    expect(
      await screen.findByText("Ihr Entwurf von M5-EDITOR wurde gespeichert."),
    ).toBeTruthy();
  });

  it("ignores a conflict for a plan the user has already left (server mode)", async () => {
    const { project, repository } = await repositoryWithProject();
    const onUnsavedChange = vi.fn();
    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    await editLabelSideInEditor(onUnsavedChange);
    await repository.saveProjectVersioned(
      updateProject(project, { projectNumber: "THEIRS" }, { now: () => 20 }),
      { expectedVersion: 1 },
    );
    const persist = repository.saveProjectVersioned.bind(repository);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi
      .spyOn(repository, "saveProjectVersioned")
      .mockImplementationOnce(async (input, options) => {
        await pending;
        return persist(input, options);
      });

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // The user leaves the plan while the stale save is still in flight.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(
      await screen.findByRole("region", { name: "Planbibliothek" }),
    ).toBeTruthy();
    release();

    await expect(save.mock.results[0]?.value).rejects.toBeInstanceOf(
      RecordVersionConflictError,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      screen.queryByRole("dialog", { name: "Plan wurde inzwischen geändert" }),
    ).toBeNull();
    expect(
      (await repository.getProject(project.id)).project?.projectNumber,
    ).toBe("THEIRS");
  });

  it("keeps the editor draft when a save hits an expired session and saves it after signing in again", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    // The first save meets an expired session (401), like the records API.
    let sessionExpired = true;
    const save = repository.saveProjectVersioned.bind(repository);
    vi.spyOn(repository, "saveProjectVersioned").mockImplementation(
      async (input, options) => {
        if (sessionExpired) {
          sessionExpired = false;
          throw new ServerStorageError(
            "unauthenticated",
            "put",
            "projects",
            401,
            "unauthenticated",
          );
        }
        return save(input, options);
      },
    );
    const alice = { id: "u-alice", username: "alice", role: "user" };
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const path = typeof input === "string" ? input : "";
      if (path === "/api/auth/me" || path === "/api/auth/login") {
        return new Response(JSON.stringify({ user: alice }), { status: 200 });
      }
      throw new Error(`unexpected request ${path}`);
    });
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    await editLabelSideInEditor(onUnsavedChange);

    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(
        "Die Sitzung ist abgelaufen. Bitte erneut anmelden; die Änderungen bleiben in diesem Fenster erhalten.",
        { selector: '[role="alert"]' },
      ),
    ).toBeTruthy();
    // Signed out, but the editor and its draft are still there, the save is
    // shown as pending and the draft is backed up for alice (#35).
    expect(screen.getByText("Nur lesen")).toBeTruthy();
    expect(
      screen.getByText("Speichern ausstehend · Sitzung abgelaufen").title,
    ).toBe(
      "Der Entwurf ist nicht gespeichert. Er bleibt in diesem Browser erhalten und ist lokal gesichert.",
    );
    const [backup] = readDraftBackups(storage, aliceScope());
    expect(backup?.projectId).toBe(project.id);
    expect(backup?.baseVersion).toBe(1);
    expect(
      backup?.project.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
    ).toBe("left");
    expect(screen.getByTestId("project-editor-workspace")).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Etikettseite").value).toBe(
      "left",
    );
    expect(onUnsavedChange).toHaveBeenLastCalledWith(true);
    const lockedSave: HTMLButtonElement = screen.getByRole("button", {
      name: "Speichern",
    });
    expect(lockedSave.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "alice" },
    });
    fireEvent.change(screen.getByLabelText("Kennwort"), {
      target: { value: "secret" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Anmelden" }));
    await waitFor(() => {
      const button: HTMLButtonElement = screen.getByRole("button", {
        name: "Speichern",
      });
      expect(button.disabled).toBe(false);
    });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(async () => {
      const saved = await repository.getProject(project.id);
      expect(
        saved.project?.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
      ).toBe("left");
    });
    await waitFor(() =>
      expect(onUnsavedChange).toHaveBeenLastCalledWith(false),
    );
    // Saved: the backup is gone, nothing is pending, nothing to restore.
    expect(readDraftBackups(storage, aliceScope())).toEqual([]);
    expect(screen.queryByText(/Speichern ausstehend/)).toBeNull();
    expect(screen.queryByText(/Ungespeicherte Entwürfe/)).toBeNull();
  });

  it("keeps an open draft in its author's backups when someone else signs in after the session expired", async () => {
    const storage = stubLocalStorage();
    const { repository } = await repositoryWithProject();
    vi.spyOn(repository, "saveProjectVersioned").mockRejectedValue(
      new ServerStorageError("unauthenticated", "put", "projects", 401),
    );
    const bob = { id: "u-bob", username: "bob", role: "user" };
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      input === "/api/auth/login"
        ? new Response(JSON.stringify({ user: bob }), { status: 200 })
        : signedInFetch(input),
    );
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    await editLabelSideInEditor(onUnsavedChange);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByText("Speichern ausstehend · Sitzung abgelaufen");

    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByLabelText("Kennwort"), {
      target: { value: "secret" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Anmelden" }));
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "bob",
      ),
    );

    const bobScope = { ...aliceScope(), userId: "u-bob" };
    expect(readDraftBackups(storage, bobScope)).toEqual([]);
    expect(readDraftBackups(storage, aliceScope())).toHaveLength(1);
  });

  it("restores a server backup without changing the open browser plan with the same id", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    const draft = updateProject(project, { productNumber: "RESTORED" });
    seedBackup(storage, aliceScope(), draft, 1, 5);
    // Another user's draft on this server is not offered.
    seedBackup(storage, { ...aliceScope(), userId: "u-bob" }, draft, 1, 5);
    const save = vi.spyOn(repository, "saveProjectVersioned");
    const browser = new ProjectRepository(new MemoryPlannerRecordStorage());
    await browser.saveProject({ ...project, productNumber: "BROWSER" });
    const localSave = vi.spyOn(browser, "saveProjectVersioned");
    window.history.replaceState(
      null,
      "",
      `/plan/${encodeURIComponent(`browser-local:${project.id}`)}/build`,
    );

    render(
      <PlannerProjectWorkspace
        repository={repository}
        browserRepository={browser}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    const offer = await screen.findByRole("region", {
      name: "Ungespeicherte Entwürfe aus einer früheren Sitzung",
    });
    expect(offer.querySelectorAll("li")).toHaveLength(1);
    await screen.findByRole("heading", { name: "BROWSER" });
    fireEvent.click(screen.getByRole("button", { name: "Wiederherstellen" }));

    await waitFor(async () => {
      const saved = await repository.getProject(project.id);
      expect(saved.project?.productNumber).toBe("RESTORED");
      expect(saved.version).toBe(2);
    });
    expect(save).toHaveBeenCalledWith(draft, { expectedVersion: 1 });
    expect(localSave).not.toHaveBeenCalled();
    expect((await browser.getProject(project.id)).project?.productNumber).toBe(
      "BROWSER",
    );
    expect((await browser.getProject(project.id)).version).toBe(1);
    expect(
      await screen.findByText(
        "Entwurf wiederhergestellt und gespeichert: RESTORED",
      ),
    ).toBeTruthy();
    expect(readDraftBackups(storage, aliceScope())).toEqual([]);
    expect(
      readDraftBackups(storage, { ...aliceScope(), userId: "u-bob" }),
    ).toHaveLength(1);
    expect(screen.queryByRole("region", { name: /Ungespeicherte/ })).toBeNull();
  });

  it("restores a draft of a plan changed meanwhile into the conflict view", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    // Someone else saved version 2 after the draft was backed up at 1.
    await repository.saveProjectVersioned(
      updateProject(project, { productNumber: "SERVER" }),
      { expectedVersion: 1 },
    );
    seedBackup(
      storage,
      aliceScope(),
      updateProject(project, { productNumber: "MINE" }),
      1,
      5,
    );

    render(
      <PlannerProjectWorkspace
        repository={repository}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Wiederherstellen" }),
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(
      (await repository.getProject(project.id)).project?.productNumber,
    ).toBe("SERVER");
    // Not settled yet: the backup stays until the conflict is decided.
    expect(readDraftBackups(storage, aliceScope())).toHaveLength(1);
  });

  it("restores a draft of a never-stored plan only if the plan still does not exist", async () => {
    const storage = stubLocalStorage();
    // The first save reached the server, but its answer was lost: the backup
    // has no base version although the plan exists now.
    const { project, repository } = await repositoryWithProject();
    seedBackup(
      storage,
      aliceScope(),
      updateProject(project, { productNumber: "MINE" }),
      null,
      5,
    );
    const save = vi.spyOn(repository, "saveProjectVersioned");

    render(
      <PlannerProjectWorkspace
        repository={repository}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Wiederherstellen" }),
    );

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(save.mock.calls[0]?.[1]).toEqual({ expectedVersion: null });
    const stored = await repository.getProject(project.id);
    expect([stored.version, stored.project?.productNumber]).toEqual([
      1,
      project.productNumber,
    ]);
    expect(readDraftBackups(storage, aliceScope())).toHaveLength(1);
  });

  it("re-backs up a failed restore with the draft's own base version", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    // Saved elsewhere after the draft was backed up at version 1.
    await repository.saveProjectVersioned(
      updateProject(project, { productNumber: "SERVER" }),
      { expectedVersion: 1 },
    );
    // Another plan is open, so restoring has to load this one first.
    await repository.saveProject(
      createProject(
        { id: "other-plan", projectNumber: "OTHER" },
        { now: () => 1, createId: (kind) => `${kind}-other` },
      ),
    );
    seedBackup(
      storage,
      aliceScope(),
      updateProject(project, { productNumber: "MINE" }),
      1,
      5,
    );
    window.history.replaceState(null, "", "/plan/other-plan");
    // The restore save fails only after the plan's load has finished.
    vi.spyOn(repository, "saveProjectVersioned").mockImplementation(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new ServerStorageError("network", "put", "projects", null);
      },
    );

    render(
      <PlannerProjectWorkspace
        repository={repository}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Wiederherstellen" }),
    );

    expect(
      await screen.findByText(
        "Der Server ist nicht erreichbar. Der Entwurf bleibt in diesem Browser erhalten; bitte später erneut speichern.",
      ),
    ).toBeTruthy();
    const [backup] = readDraftBackups(storage, aliceScope());
    expect([backup?.baseVersion, backup?.project.productNumber]).toEqual([
      1,
      "MINE",
    ]);
  });

  it("asks before signing out with unsaved drafts and then removes this user's backups", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    seedBackup(storage, aliceScope(), project, 1, 5);
    const elsewhere = { server: "https://other.example", userId: "u-alice" };
    seedBackup(storage, elsewhere, project, 1, 5);
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      input === "/api/auth/logout"
        ? new Response(null, { status: 204 })
        : signedInFetch(input),
    );

    render(
      <PlannerProjectWorkspace
        repository={repository}
        storageMode="server"
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findByRole("button", { name: "Wiederherstellen" });

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(fetchImpl).not.toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(readDraftBackups(storage, aliceScope())).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Entwürfe verwerfen und abmelden" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Nicht angemeldet")).toBeTruthy(),
    );
    expect(readDraftBackups(storage, aliceScope())).toEqual([]);
    expect(readDraftBackups(storage, elsewhere)).toHaveLength(1);
    expect(screen.queryByRole("region", { name: /Ungespeicherte/ })).toBeNull();
  });

  it("warns before signing out when only a backup from a failed .rob import is pending", async () => {
    const storage = stubLocalStorage();
    const { repository } = await repositoryWithProject();
    vi.spyOn(repository, "saveProjectVersioned").mockRejectedValue(
      new ServerStorageError("network", "put", "projects", null),
    );
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      input === "/api/auth/logout"
        ? new Response(null, { status: 204 })
        : signedInFetch(input),
    );

    render(
      <PlannerProjectWorkspace
        repository={repository}
        storageMode="server"
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Vorhandene Pläne ansehen/ }),
    );
    await screen.findByRole("region", { name: "Planbibliothek" });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".rob,text/plain"]',
    )!;
    const file = new File([referenceRob], "reference.rob", {
      type: "text/plain",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(referenceRob),
    });
    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText("Speichern ausstehend · Server nicht erreichbar");
    expect(readDraftBackups(storage, aliceScope())).toHaveLength(1);
    // Nothing is open, so the backup is offered for restore right away.
    expect(
      screen.getByRole("region", {
        name: "Ungespeicherte Entwürfe aus einer früheren Sitzung",
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    expect(
      screen.getByRole("button", { name: "Entwürfe verwerfen und abmelden" }),
    ).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(readDraftBackups(storage, aliceScope())).toHaveLength(1);
  });

  // Backup lifecycle hole A (#35 audit).
  it("keeps an earlier session's backup of a plan when a new draft of it is edited and saved (server mode)", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    seedBackup(
      storage,
      aliceScope(),
      updateProject(project, { productNumber: "EARLIER" }),
      1,
      5,
    );
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    await screen.findByRole("region", {
      name: "Ungespeicherte Entwürfe aus einer früheren Sitzung",
    });
    // Instead of restoring, alice opens the plan, edits it and saves.
    await editLabelSideInEditor(onUnsavedChange);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(async () => {
      const saved = await repository.getProject(project.id);
      expect([
        saved.version,
        saved.project?.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
      ]).toEqual([2, "left"]);
    });
    await waitFor(() =>
      expect(onUnsavedChange).toHaveBeenLastCalledWith(false),
    );

    // The earlier draft was neither saved nor discarded: it stays on offer.
    const backups = readDraftBackups(storage, aliceScope());
    expect(
      backups.map(({ token, baseVersion, project: draft }) => [
        token,
        baseVersion,
        draft.productNumber,
      ]),
    ).toEqual([[`earlier-u-alice-${project.id}`, 1, "EARLIER"]]);
    const offer = screen.getByRole("region", {
      name: "Ungespeicherte Entwürfe aus einer früheren Sitzung",
    });
    expect(offer.querySelectorAll("li")).toHaveLength(1);
  });

  // Backup lifecycle hole B (#35 audit).
  it("backs up the conflict view's draft at its own base version when saving it fails (server mode)", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    const onUnsavedChange = vi.fn();
    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    await editLabelSideInEditor(onUnsavedChange);
    // Another session saves the plan at version 1 -> 2.
    await repository.saveProjectVersioned(
      updateProject(project, { projectNumber: "THEIRS" }, { now: () => 20 }),
      { expectedVersion: 1 },
    );
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await screen.findByRole("dialog", {
      name: "Plan wurde inzwischen geändert",
    });

    // Saving "mine" from the conflict view meets an unreachable server.
    vi.spyOn(repository, "saveProjectVersioned").mockRejectedValueOnce(
      new ServerStorageError("network", "put", "projects", null),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Meinen Entwurf speichern" }),
    );

    expect(
      await screen.findByText("Speichern ausstehend · Server nicht erreichbar"),
    ).toBeTruthy();
    const [backup] = readDraftBackups(storage, aliceScope());
    expect([
      backup?.projectId,
      backup?.baseVersion,
      backup?.project.projectNumber,
      backup?.project.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
    ]).toEqual([project.id, 1, "M5-EDITOR", "left"]);
    expect(
      (await repository.getProject(project.id)).project?.projectNumber,
    ).toBe("THEIRS");
  });

  // Backup lifecycle hole C (#35 audit).
  it("keeps a failed .rob import's backup when a conflict on another plan is settled (server mode)", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);

    render(
      <PlannerProjectWorkspace
        repository={repository}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    await openSavedPlan();
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-EDITOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();

    // The import's save fails: its new plan lives only in its backup, and
    // the saved plan stays open.
    vi.spyOn(repository, "saveProjectVersioned").mockRejectedValueOnce(
      new ServerStorageError("network", "put", "projects", null),
    );
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    await screen.findByRole("region", { name: "Planbibliothek" });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".rob,text/plain"]',
    )!;
    const file = new File([referenceRob], "reference.rob", {
      type: "text/plain",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(referenceRob),
    });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("Speichern ausstehend · Server nicht erreichbar");
    const [robBackup] = readDraftBackups(storage, aliceScope());
    expect(robBackup?.projectId.startsWith("rob-")).toBe(true);

    // Someone else saves the open plan; the user's own edit of it conflicts.
    await repository.saveProjectVersioned(
      updateProject(project, { projectNumber: "THEIRS" }, { now: () => 20 }),
      { expectedVersion: 1 },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Planangaben bearbeiten" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Artikel und Linie/ }));
    fireEvent.change(screen.getByLabelText("Artikelnummer"), {
      target: { value: "MINE" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    await screen.findByRole("dialog", {
      name: "Plan wurde inzwischen geändert",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Serverstand übernehmen" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: "Plan wurde inzwischen geändert",
        }),
      ).toBeNull(),
    );

    // Settling the open plan's conflict discards nothing of the import.
    expect(confirm).not.toHaveBeenCalled();
    expect(
      readDraftBackups(storage, aliceScope()).map((backup) => backup.projectId),
    ).toEqual([robBackup?.projectId]);
  });

  // Backup lifecycle hole E (#35 audit).
  it("keeps a restored draft's backup on offer when its conflict is decided later, also after a reload", async () => {
    const storage = stubLocalStorage();
    const { repository } = await repositoryWithProject();
    // The .rob import's save reaches the server, but its answer is lost: the
    // draft is backed up as never stored although the plan exists now.
    const persist = repository.saveProjectVersioned.bind(repository);
    vi.spyOn(repository, "saveProjectVersioned").mockImplementationOnce(
      async (input, options) => {
        await persist(input, options);
        throw new ServerStorageError("network", "put", "projects", null);
      },
    );
    const view = (
      <PlannerProjectWorkspace
        repository={repository}
        storageMode="server"
        fetchImpl={signedInFetch}
      />
    );
    const { unmount } = render(view);
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /^Vorhandene Pläne ansehen/ }),
    );
    await screen.findByRole("region", { name: "Planbibliothek" });
    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".rob,text/plain"]',
    )!;
    const file = new File([referenceRob], "reference.rob", {
      type: "text/plain",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(referenceRob),
    });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("Speichern ausstehend · Server nicht erreichbar");
    const [backup] = readDraftBackups(storage, aliceScope());
    expect(backup?.baseVersion).toBe(null);
    expect((await repository.getProject(backup!.projectId)).version).toBe(1);

    // Restoring it meets the stored plan: the conflict view opens.
    fireEvent.click(screen.getByRole("button", { name: "Wiederherstellen" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Später entscheiden" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Undecided: the backup stays, and is offered again.
    expect(
      readDraftBackups(storage, aliceScope()).map(
        ({ projectId, baseVersion }) => [projectId, baseVersion],
      ),
    ).toEqual([[backup!.projectId, null]]);
    expect(
      screen
        .getByRole("region", {
          name: "Ungespeicherte Entwürfe aus einer früheren Sitzung",
        })
        .querySelectorAll("li"),
    ).toHaveLength(1);

    // Still offered after a reload.
    unmount();
    render(view);
    const offer = await screen.findByRole("region", {
      name: "Ungespeicherte Entwürfe aus einer früheren Sitzung",
    });
    expect(offer.querySelectorAll("li")).toHaveLength(1);
  });

  // Backup lifecycle hole G (#35 audit).
  it("keeps a discarded draft discarded when its save fails afterwards (server mode)", async () => {
    const storage = stubLocalStorage();
    const { repository } = await repositoryWithProject();
    let fail!: () => void;
    const pending = new Promise<void>((resolve) => {
      fail = resolve;
    });
    const save = vi
      .spyOn(repository, "saveProjectVersioned")
      .mockImplementationOnce(async () => {
        await pending;
        throw new ServerStorageError("network", "put", "projects", null);
      });
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    await editLabelSideInEditor(onUnsavedChange);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // The user discards the draft while its save is still in flight.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(
      await screen.findByRole("region", { name: "Planbibliothek" }),
    ).toBeTruthy();
    expect(readDraftBackups(storage, aliceScope())).toEqual([]);

    // Only then does the save fail: the discarded draft stays discarded.
    await act(async () => {
      fail();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(readDraftBackups(storage, aliceScope())).toEqual([]);
    expect(screen.queryByText(/Speichern ausstehend/)).toBeNull();
    expect(screen.queryByRole("region", { name: /Ungespeicherte/ })).toBeNull();
  });

  // Backup lifecycle hole I (#35 audit).
  it("keeps an earlier session's backup of a plan when an editor change to it is undone", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    const draft = updateProject(project, { productNumber: "EARLIER" });
    seedBackup(storage, aliceScope(), draft, 1, 5);
    const [earlier] = readDraftBackups(storage, aliceScope());
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    await screen.findByRole("button", { name: "Wiederherstellen" });
    await editLabelSideInEditor(onUnsavedChange);
    fireEvent.click(screen.getByRole("button", { name: "Rückgängig" }));
    await waitFor(() =>
      expect(onUnsavedChange).toHaveBeenLastCalledWith(false),
    );

    expect(readDraftBackups(storage, aliceScope())).toEqual([earlier]);
    expect(earlier?.project.productNumber).toBe("EARLIER");
    expect(earlier?.baseVersion).toBe(1);
  });

  // Backup lifecycle hole J (#35 audit).
  it("keeps a save that fails after a sign-out and someone else's sign-in out of the new user's backups and session", async () => {
    const storage = stubLocalStorage();
    const { repository } = await repositoryWithProject();
    let failSave!: (cause: unknown) => void;
    vi.spyOn(repository, "saveProjectVersioned").mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          failSave = reject;
        }),
    );
    const bob = { id: "u-bob", username: "bob", role: "user" };
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (input === "/api/auth/logout") {
        return new Response(null, { status: 204 });
      }
      if (input === "/api/auth/login") {
        return new Response(JSON.stringify({ user: bob }), { status: 200 });
      }
      return signedInFetch(input);
    });
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    await editLabelSideInEditor(onUnsavedChange);
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(failSave).toBeTypeOf("function"));

    // Alice signs out while the save is still in flight; bob signs in.
    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Entwürfe verwerfen und abmelden" }),
    );
    await waitFor(() =>
      expect(screen.getByText("Nicht angemeldet")).toBeTruthy(),
    );
    fireEvent.change(screen.getByLabelText("Benutzername"), {
      target: { value: "bob" },
    });
    fireEvent.change(screen.getByLabelText("Kennwort"), {
      target: { value: "secret" },
    });
    fireEvent.submit(screen.getByRole("form", { name: "Anmelden" }));
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "bob",
      ),
    );

    // Alice's old save now fails with a 401 from before the sign-out.
    await act(async () => {
      failSave(
        new ServerStorageError("unauthenticated", "put", "projects", 401),
      );
    });

    const bobScope = { ...aliceScope(), userId: "u-bob" };
    expect(readDraftBackups(storage, bobScope)).toEqual([]);
    expect(screen.queryByText(/Speichern ausstehend/)).toBeNull();
    expect(document.querySelector(".session-menu summary")?.textContent).toBe(
      "bob",
    );
    expect(screen.queryByText("Nur lesen")).toBeNull();
  });

  // Backup lifecycle hole K (#35 audit).
  it("warns before signing out when another tab backed up a draft after this window rendered", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      input === "/api/auth/logout"
        ? new Response(null, { status: 204 })
        : signedInFetch(input),
    );

    render(
      <PlannerProjectWorkspace
        repository={repository}
        storageMode="server"
        fetchImpl={fetchImpl}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    expect(readDraftBackups(storage, aliceScope())).toEqual([]);
    // Another tab of alice's backs up its draft; no storage event reaches us.
    writeDraftBackup(storage, aliceScope(), project, 1, 20, {
      token: "other-tab-draft",
      rev: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "Abmelden" }));

    expect(
      screen.getByRole("button", { name: "Entwürfe verwerfen und abmelden" }),
    ).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalledWith("/api/auth/logout", {
      method: "POST",
    });
    expect(
      readDraftBackups(storage, aliceScope()).map(({ token }) => token),
    ).toEqual(["other-tab-draft"]);
  });

  // Backup lifecycle hole L (#35 audit).
  it("keeps a newer editor draft's backup when a discarded draft's slow save succeeds (server mode)", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    const onUnsavedChange = vi.fn();
    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    await editLabelSideInEditor(onUnsavedChange);
    const persist = repository.saveProjectVersioned.bind(repository);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi
      .spyOn(repository, "saveProjectVersioned")
      .mockImplementationOnce(async (input, options) => {
        await pending;
        return persist(input, options);
      });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));

    // The user discards that draft while its save is in flight, reopens the
    // plan and starts a new editor draft.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "M5-EDITOR öffnen" }),
    );
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-EDITOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Muster bearbeiten" }));
    expect(await screen.findByTestId("project-editor-workspace")).toBeTruthy();
    const packageRect = document.querySelector<SVGRectElement>(
      '[data-placement-id="placement-1"] rect',
    )!;
    fireEvent.pointerDown(packageRect, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.pointerUp(packageRect, {
      pointerId: 1,
      clientX: 100,
      clientY: 200,
    });
    fireEvent.change(screen.getByLabelText("Etikettseite"), {
      target: { value: "right" },
    });
    await waitFor(() =>
      expect(
        readDraftBackups(storage, aliceScope()).map(
          (backup) =>
            backup.project.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
        ),
      ).toEqual(["right"]),
    );

    // The discarded draft's save succeeds only now.
    await act(async () => {
      release();
      await save.mock.results[0]?.value;
    });
    await waitFor(async () =>
      expect((await repository.getProject(project.id)).version).toBe(2),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    const backups = readDraftBackups(storage, aliceScope());
    expect(
      backups.map(
        (backup) =>
          backup.project.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
      ),
    ).toEqual(["right"]);
    expect(screen.getByLabelText<HTMLSelectElement>("Etikettseite").value).toBe(
      "right",
    );
  });

  // Edits made while a save of the same draft is in flight (#35 review).
  const labelSides = (storage: DraftBackupStorage) =>
    readDraftBackups(storage, aliceScope()).map((backup) => [
      backup.project.solutions[0]?.patterns[0]?.placements[0]?.labelSide,
      backup.baseVersion,
    ]);
  async function editDuringSlowSave(outcome: "fail" | "succeed") {
    const storage = stubLocalStorage();
    const { repository } = await repositoryWithProject();
    const onUnsavedChange = vi.fn();
    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
        storageMode="server"
        fetchImpl={signedInFetch}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".session-menu summary")?.textContent).toBe(
        "alice",
      ),
    );
    await editLabelSideInEditor(onUnsavedChange);
    const persist = repository.saveProjectVersioned.bind(repository);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = vi
      .spyOn(repository, "saveProjectVersioned")
      .mockImplementationOnce(async (input, options) => {
        await pending;
        if (outcome === "fail") {
          throw new ServerStorageError("network", "put", "projects", null);
        }
        return persist(input, options);
      });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    // A newer edit of the same draft while the request runs.
    fireEvent.change(screen.getByLabelText("Etikettseite"), {
      target: { value: "right" },
    });
    await waitFor(() => expect(labelSides(storage)).toEqual([["right", 1]]));
    await act(async () => {
      release();
      await (save.mock.results[0]?.value as Promise<unknown>).catch(
        () => undefined,
      );
    });
    return storage;
  }

  it("keeps the newer edits' backup when an older save of the same draft fails", async () => {
    const storage = await editDuringSlowSave("fail");
    await screen.findByText("Speichern ausstehend · Server nicht erreichbar");
    expect(labelSides(storage)).toEqual([["right", 1]]);
  });

  it("disables the finished plan's editing actions without a session (server mode)", async () => {
    const { repository } = await repositoryWithProject();
    const anonymousFetch: typeof fetch = async (input) => {
      if (input !== "/api/auth/me") throw new Error("unexpected request");
      return new Response(null, { status: 401 });
    };

    render(
      <PlannerProjectWorkspace
        repository={repository}
        storageMode="server"
        fetchImpl={anonymousFetch}
      />,
    );
    await openSavedPlan();
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-EDITOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    const hint =
      "Ohne Anmeldung sind alle Pläne lesbar und exportierbar. Zum Bearbeiten bitte anmelden.";
    for (const name of [
      "Muster bearbeiten",
      "Weitere Muster erzeugen",
      "Planangaben bearbeiten",
    ]) {
      const button = await screen.findByRole("button", { name });
      await waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
      expect(button.getAttribute("title")).toBe(hint);
    }
    // Reading stays available.
    expect(
      screen
        .getByRole("button", { name: "Palettierblatt ansehen" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("marks browser plans, keeps their editor unlocked, and offers copying a server plan", async () => {
    const { repository } = await repositoryWithProject();
    const browserRepository = new ProjectRepository(
      new MemoryPlannerRecordStorage(),
    );
    await browserRepository.saveProject({
      ...plannerProject(),
      projectNumber: "BROWSER-PLAN",
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 401 }),
    );
    render(
      <PlannerProjectWorkspace
        repository={repository}
        browserRepository={browserRepository}
        storageMode="server"
        fetchImpl={fetchImpl}
      />,
    );
    await screen.findByText("Nicht angemeldet");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: /^Neuen Plan erstellen/,
      }).disabled,
    ).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: /^Vorhandene Pläne ansehen/ }),
    );
    const browserSection = await screen.findByRole("region", {
      name: "Nur in diesem Browser (nicht veröffentlicht)",
    });
    expect(
      within(browserSection).getByRole("heading", { name: "BROWSER-PLAN" }),
    ).toBeTruthy();
    const serverSection = screen.getByRole("region", {
      name: "Veröffentlichte Pläne",
    });
    fireEvent.click(
      within(serverSection).getByRole("button", {
        name: "In diesem Browser kopieren",
      }),
    );
    await waitFor(async () =>
      expect((await browserRepository.listProjects()).projects).toHaveLength(2),
    );
    expect((await repository.listProjects()).projects).toHaveLength(1);
    fireEvent.click(
      await screen.findByRole("button", { name: "BROWSER-PLAN öffnen" }),
    );
    await screen.findByRole("heading", { name: "BROWSER-PLAN" });
    expect(
      document.querySelector(".fable-header .browser-plan-badge")?.textContent,
    ).toBe("Nur in diesem Browser");
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Muster bearbeiten",
      }).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Muster bearbeiten" }));
    expect(
      await screen.findByRole("button", { name: "Im Browser speichern" }),
    ).toBeTruthy();
  });

  it("opens a .rob file as the current plan instead of attaching a reference", async () => {
    const { project, repository } = await repositoryWithProject();

    render(<PlannerProjectWorkspace repository={repository} />);
    await openSavedPlan();
    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-EDITOR" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(
      await screen.findByRole("region", { name: "Planbibliothek" }),
    ).toBeTruthy();

    const input = document.querySelector<HTMLInputElement>(
      'input[type="file"][accept=".rob,text/plain"]',
    )!;
    const file = new File([referenceRob], "reference.rob", {
      type: "text/plain",
    });
    Object.defineProperty(file, "text", {
      value: () => Promise.resolve(referenceRob),
    });
    fireEvent.change(input, { target: { files: [file] } });

    expect(
      await screen.findByRole(
        "heading",
        { name: "reference" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(await screen.findAllByText("Importierter Plan")).toHaveLength(1);
    expect(
      screen.getByRole("heading", { name: "Plan im Überblick" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "Planning workflow" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate/i })).toBeNull();
    expect(screen.queryByText("Footprint recreation")).toBeNull();

    await waitFor(async () => {
      const listed = (await repository.listProjects()).projects;
      const imported = listed.find(
        (entry) =>
          entry.source.kind === "rob-import" &&
          entry.source.fileName === "reference.rob",
      );
      expect(imported?.package.dimensionsMm).toEqual({
        length: 200,
        width: 300,
        height: 150,
      });
      expect(imported?.package.inletOrientation).toBe("crosswise");
      expect(imported?.pallet?.dimensionsMm).toEqual({
        length: 1200,
        width: 800,
        height: 144,
      });
    });

    const original = await repository.getProject(project.id);
    expect(original.project?.package.dimensionsMm).toEqual({
      length: 100,
      width: 50,
      height: 40,
    });
  });
});
