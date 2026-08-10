import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { PlannerProjectWorkspace } from "~/features/project/PlannerProjectWorkspace";
import { CURRENT_PALLET_SCHEMA_VERSION } from "~/lib/palletPersistence";
import { parseRobText } from "~/lib/robParser";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";

const storageMocks = vi.hoisted(() => ({
  getAllPallets: vi.fn(),
  putPallets: vi.fn(),
  deletePalletById: vi.fn(),
  clearPallets: vi.fn(),
}));

vi.mock("~/lib/storage", () => storageMocks);
vi.mock("~/components/RobViewer", () => ({
  RobViewer: () => <div data-testid="rob-viewer" />,
}));

const legacyRob = [
  "1200 800 144",
  "200 300 150 1",
  "1",
  "1",
  "0 0",
  "1 0",
  "1",
  "100 50 0 600 400 0 1 0 0",
].join("\n");

function plannerProject() {
  return createProject(
    {
      id: "planner-legacy-project",
      projectNumber: "M5-LEGACY",
      package: {
        dimensionsMm: { length: 200, width: 300, height: 150 },
        multiPickAllowed: false,
      },
      pallet: {
        id: "pallet-1",
        name: "Legacy pallet",
        kind: "custom",
        dimensionsMm: { length: 1200, width: 800, height: 144 },
        storageEnvelopeMm: null,
        allowedOverhangMm: { length: 0, width: 0 },
        tareKg: null,
        maxGrossKg: null,
        subPalletPattern: "none",
      },
      solutions: [],
      activeSolutionId: null,
    },
    { now: () => 1, createId: (kind) => `${kind}-unused` },
  );
}

async function repositoryWithProject() {
  const repository = new ProjectRepository(new MemoryPlannerRecordStorage(), {
    now: () => 10,
    createId: (kind) => `${kind}-repository`,
  });
  await repository.saveProject(plannerProject());
  return repository;
}

beforeEach(() => {
  storageMocks.getAllPallets.mockResolvedValue({
    pallets: [
      {
        schemaVersion: CURRENT_PALLET_SCHEMA_VERSION,
        id: "legacy-plan",
        name: "reference.rob",
        createdAt: 1,
        data: parseRobText(legacyRob),
        rawText: legacyRob,
        originalRawText: legacyRob,
      },
    ],
    repaired: [],
    issues: [],
  });
  storageMocks.putPallets.mockResolvedValue(undefined);
  storageMocks.deletePalletById.mockResolvedValue(undefined);
  storageMocks.clearPallets.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlannerProjectWorkspace legacy integration", () => {
  it("guards the drawer after rotating the editable .rob plan", async () => {
    const repository = await repositoryWithProject();
    const onUnsavedChange = vi.fn();

    render(
      <PlannerProjectWorkspace
        repository={repository}
        onUnsavedChange={onUnsavedChange}
      />,
    );

    expect(
      await screen.findByRole("heading", { name: "M5-LEGACY" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /06 Validate/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /Legacy \.rob workspace/i }),
    );

    const drawer = await screen.findByRole("dialog", {
      name: "Legacy .rob workspace",
    });
    expect(await within(drawer).findByTestId("rob-viewer")).toBeTruthy();
    const rotate = await within(drawer).findByRole("button", {
      name: "Modify plan (rotate 180°)",
    });
    await waitFor(() => expect(rotate.getAttribute("disabled")).toBeNull());

    fireEvent.click(rotate);

    await waitFor(() => expect(onUnsavedChange).toHaveBeenLastCalledWith(true));
    expect(within(drawer).getByLabelText("Unsaved changes")).toBeTruthy();

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(within(drawer).getByRole("button", { name: "Close" }));

    expect(confirm).toHaveBeenCalledWith(
      "Close this production tool and discard unsaved changes in Legacy .rob workspace?",
    );
    expect(
      screen.getByRole("dialog", { name: "Legacy .rob workspace" }),
    ).toBeTruthy();
  });
});
