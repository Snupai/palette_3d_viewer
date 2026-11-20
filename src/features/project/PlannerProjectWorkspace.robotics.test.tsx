import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { translateDe } from "~/i18n";
import { libraryRobDownload } from "~/features/project/projectRobDownload";
import { CURRENT_PALLET_SCHEMA_VERSION } from "~/lib/palletPersistence";
import { savedPalletToProject } from "~/lib/projectAdapters";
import { parseRobText } from "~/lib/robParser";
import { PlannerProjectWorkspace } from "~/features/project/PlannerProjectWorkspace";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";

vi.mock("~/components/RobViewer", () => ({
  RobViewer: () => <div data-testid="rob-viewer" />,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function plannerProject(id: string, projectNumber: string, now: number) {
  return createProject(
    {
      id,
      projectNumber,
      productNumber: `${projectNumber}-BOX`,
      package: {
        dimensionsMm: { length: 400, width: 300, height: 200 },
        multiPickAllowed: true,
      },
      pallet: "euro",
      solutions: [
        {
          id: `solution-${id}`,
          name: "Calculated solution",
          origin: "calculated",
          patterns: [
            {
              id: `pattern-${id}`,
              name: "Pattern 1",
              grips: [],
              placements: [
                {
                  id: `placement-${id}`,
                  sequence: 0,
                  positionMm: { x: 300, y: 200 },
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
                id: `layer-${id}`,
                patternId: `pattern-${id}`,
                interlayerBefore: 0,
              },
            ],
            trailingInterlayer: 0,
          },
          robotCycles: [],
        },
      ],
      activeSolutionId: `solution-${id}`,
    },
    { now: () => now, createId: (kind) => `${kind}-${id}` },
  );
}

function plannerProjectWithStack() {
  return createProject(
    {
      id: "robot-project-profile",
      projectNumber: "M5-ROBOT-PROFILE",
      package: {
        dimensionsMm: { length: 400, width: 300, height: 200 },
        multiPickAllowed: false,
      },
      pallet: "euro",
      solutions: [
        {
          id: "solution-1",
          name: "Calculated solution",
          origin: "calculated",
          patterns: [
            {
              id: "pattern-1",
              name: "Pattern 1",
              grips: [],
              placements: [
                {
                  id: "placement-1",
                  sequence: 0,
                  positionMm: { x: 300, y: 200 },
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
    {
      now: () => 1,
      createId: (kind) => `${kind}-profile`,
    },
  );
}

async function repositoryWithProjects() {
  let now = 10;
  const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
    now: () => now++,
    createId: (kind) => `${kind}-repository`,
  });
  const second = plannerProject("robot-project-b", "M5-ROBOT-B", 2);
  const first = plannerProject("robot-project-a", "M5-ROBOT-A", 1);
  await repository.saveProject(second);
  await repository.saveProject(first);
  return { repository };
}

async function openSavedPlan(name: string) {
  fireEvent.click(
    screen.getByRole("button", { name: /^Vorhandene Pläne ansehen/ }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: `${name} öffnen` }),
  );
}
function openRobotics() {
  const summary = screen.getByText("Bearbeiten & prüfen");
  if (!summary.closest("details")!.open) fireEvent.click(summary);
  fireEvent.click(screen.getByRole("button", { name: "Robotik & Greifer" }));
}
describe("PlannerProjectWorkspace robotics integration", () => {
  it("keeps session settings for the same project and resets them after switching projects", async () => {
    const { repository } = await repositoryWithProjects();

    render(<PlannerProjectWorkspace repository={repository} />);
    await openSavedPlan("M5-ROBOT-B-BOX");

    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-ROBOT-B-BOX" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Roboterbereitschaft").closest("summary")?.textContent,
    ).toContain("OBSERVED");
    expect(
      screen.getByText("Roboterbereitschaft").closest("summary")?.textContent,
    ).toContain("mitgelieferte Standard-Ausrüstungsprofil");
    openRobotics();
    expect(await screen.findByTestId("robotics-workspace")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("X (mm)"), {
      target: { value: "321" },
    });
    expect(screen.getByLabelText<HTMLInputElement>("X (mm)").value).toBe("321");

    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Robotik & Greifer" }),
      ).getByRole("button", { name: "Schließen" }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("robotics-workspace")).toBeNull();
    });

    openRobotics();
    expect(await screen.findByTestId("robotics-workspace")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("X (mm)").value).toBe("321");

    fireEvent.click(
      within(
        screen.getByRole("dialog", { name: "Robotik & Greifer" }),
      ).getByRole("button", { name: "Schließen" }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("robotics-workspace")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "Pläne" }));
    expect(
      await screen.findByRole("region", { name: "Planbibliothek" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "M5-ROBOT-A-BOX öffnen" }),
    );

    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-ROBOT-A-BOX" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    openRobotics();
    expect(await screen.findByTestId("robotics-workspace")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("X (mm)").value).toBe("");
  });

  it("keeps built-in default equipment out of a robot-readiness pass", async () => {
    let now = 10;
    const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
      now: () => now++,
      createId: (kind) => `${kind}-repository`,
    });
    await repository.saveProject(plannerProjectWithStack());

    render(<PlannerProjectWorkspace repository={repository} />);
    await openSavedPlan("M5-ROBOT-PROFILE");

    expect(
      await screen.findByRole(
        "heading",
        { name: "M5-ROBOT-PROFILE" },
        { timeout: 5_000 },
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Plan im Überblick" }),
    ).toBeTruthy();
    openRobotics();
    expect(await screen.findByTestId("robotics-workspace")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("X (mm)"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Y (mm)"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Z (mm)"), {
      target: { value: "300" },
    });

    await waitFor(() => {
      const row = screen.getByText("Roboterbereitschaft").closest("summary");
      expect(row?.textContent).toContain("OBSERVED");
      expect(row?.textContent).toContain(
        "mitgelieferte Standard-Ausrüstungsprofil",
      );
      expect(row?.textContent).not.toContain("PASS");
    });
  });
});

describe("PlannerProjectWorkspace Fertigstand", () => {
  /** An imported `.rob` with CRLF line endings, kept verbatim. */
  const crlfRob = [
    "1200 800 144",
    "200 300 150",
    "1",
    "1",
    "0 0",
    "1 0",
    "2",
    "100 50 0 150 200 0 1 0 0",
    "100 50 0 450 200 0 1 0 0",
  ].join("\r\n");

  it("marks the saved plan finished with the downloaded .rob text, then withdraws it", async () => {
    const storage = Object.assign(new MemoryPlannerRecordStorage(), {
      createdBy: () => "u-alice",
    });
    const repository = new ProjectRepository(storage);
    const project = savedPalletToProject({
      schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
      id: "rob-final",
      name: "line-7.rob",
      createdAt: 1,
      data: parseRobText(crlfRob),
      rawText: crlfRob,
      originalRawText: crlfRob,
    });
    await repository.saveProjectVersioned(project, { expectedVersion: null });
    const final = {
      id: "f-1",
      recordId: "rob-final",
      recordVersion: 1,
      name: "line-7",
      fileName: "line-7.rob",
      sha256: "a".repeat(64),
      markedAt: "2026-11-19T08:30:00.000Z",
    };
    const posted: unknown[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      if (input === "/api/auth/me")
        return Response.json({
          user: { id: "u-alice", username: "alice", role: "user" },
        });
      if (input === "/api/finals?recordId=rob-final")
        return Response.json({ finals: [] });
      if (input === "/api/finals" && init?.method === "POST") {
        posted.push(JSON.parse(init.body as string));
        return Response.json({ final, replacedId: null }, { status: 201 });
      }
      if (input === "/api/finals/f-1" && init?.method === "DELETE")
        return new Response(null, { status: 204 });
      throw new Error("unexpected request");
    });
    const download = libraryRobDownload(
      (await repository.getProject("rob-final")).project!,
      translateDe,
    );
    expect(download).toEqual({
      ok: true,
      fileName: "line-7.rob",
      text: crlfRob,
    });

    render(
      <PlannerProjectWorkspace
        repository={repository}
        browserRepository={
          new ProjectRepository(new MemoryPlannerRecordStorage())
        }
        storageMode="server"
        fetchImpl={fetchImpl}
      />,
    );
    // The only stored plan is already open behind the welcome screen.
    fireEvent.click(
      await screen.findByRole("button", { name: "Zum geöffneten Plan zurück" }),
    );
    const mark = await screen.findByRole(
      "button",
      { name: "Als fertig markieren" },
      { timeout: 5_000 },
    );
    await waitFor(() => expect(mark).toHaveProperty("disabled", false));
    fireEvent.click(mark);

    await screen.findByText(
      "„line-7“ ist als fertig markiert. Die HMIs übernehmen ihn beim nächsten Abgleich in ihre Planliste.",
    );
    expect(posted).toEqual([
      {
        recordId: "rob-final",
        recordVersion: 1,
        name: "line-7",
        fileName: "line-7.rob",
        robText: crlfRob,
      },
    ]);
    expect(
      screen.queryByRole("button", { name: "Als fertig markieren" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Nicht mehr fertig" }));
    await screen.findByText(
      "„line-7“ ist nicht mehr fertig und verschwindet aus den Planlisten der HMIs.",
    );
    expect(
      screen.getByRole("button", { name: "Als fertig markieren" }),
    ).toBeTruthy();
  });
});
