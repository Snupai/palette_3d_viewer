import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject, updateProject } from "~/domain/project/projectFactory";
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
  type DraftBackupStorage,
} from "~/features/project/draftBackupModel";

vi.mock("~/components/RobViewer", () => ({
  RobViewer: () => <div data-testid="rob-viewer" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
    await screen.findByRole("button", { name: "M5-EDITOR öffnen" }),
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
      await screen.findByText("Dein Entwurf von M5-EDITOR wurde gespeichert."),
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

  it("offers a backed-up draft after sign-in and restores it through the versioned save", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    const draft = updateProject(project, { productNumber: "RESTORED" });
    writeDraftBackup(storage, aliceScope(), draft, 1, 5);
    // Another user's draft on this server is not offered.
    writeDraftBackup(
      storage,
      { ...aliceScope(), userId: "u-bob" },
      draft,
      1,
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
    const offer = await screen.findByRole("region", {
      name: "Ungespeicherte Entwürfe aus einer früheren Sitzung",
    });
    expect(offer.querySelectorAll("li")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Wiederherstellen" }));

    await waitFor(async () => {
      const saved = await repository.getProject(project.id);
      expect(saved.project?.productNumber).toBe("RESTORED");
      expect(saved.version).toBe(2);
    });
    expect(save).toHaveBeenCalledWith(draft, { expectedVersion: 1 });
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
    writeDraftBackup(
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

  it("asks before signing out with unsaved drafts and then removes this user's backups", async () => {
    const storage = stubLocalStorage();
    const { project, repository } = await repositoryWithProject();
    writeDraftBackup(storage, aliceScope(), project, 1, 5);
    const elsewhere = { server: "https://other.example", userId: "u-alice" };
    writeDraftBackup(storage, elsewhere, project, 1, 5);
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
    await waitFor(() => expect(screen.getByText("Nur lesen")).toBeTruthy());
    expect(readDraftBackups(storage, aliceScope())).toEqual([]);
    expect(readDraftBackups(storage, elsewhere)).toHaveLength(1);
    expect(screen.queryByRole("region", { name: /Ungespeicherte/ })).toBeNull();
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
