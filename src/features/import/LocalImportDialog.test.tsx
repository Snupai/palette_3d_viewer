import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPalletTemplate } from "~/domain/project/palletTemplates";
import { createProject } from "~/domain/project/projectFactory";
import { createProjectResource } from "~/domain/project/projectResource";
import type { PlannerSession } from "~/features/auth/plannerAccessModel";
import {
  PROJECT_RESOURCES_STORE_NAME,
  PROJECTS_STORE_NAME,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";
import {
  MemoryPlannerRecordStorage,
  ProjectRepository,
} from "~/lib/projectRepository";
import { LocalImportController } from "./LocalImportDialog";
import type { LocalImportSource } from "./localImportModel";

afterEach(cleanup);

const ALICE: PlannerSession = {
  status: "signed-in",
  user: { id: "u-alice", username: "alice", role: "user" },
};

function localSource(
  stores: Partial<Record<PlannerStoreName, unknown[]>>,
): () => Promise<LocalImportSource> {
  return async () => ({
    list: async (store) => structuredClone(stores[store] ?? []),
  });
}

function setup() {
  sessionStorage.clear();
  const local = createProject(
    { id: "local-plan", projectNumber: "L-7", productNumber: "Tee" },
    { createId: (kind) => `local-${kind}`, now: () => 100 },
  );
  const euro = createProjectResource(
    { kind: "pallet", value: getPalletTemplate("euro") },
    { now: () => 5 },
  );
  const storage = new MemoryPlannerRecordStorage();
  const repository = new ProjectRepository(storage);
  const onImported = vi.fn();
  render(
    <LocalImportController
      session={ALICE}
      repository={repository}
      creatorOf={() => undefined}
      onImported={onImported}
      onSessionLost={vi.fn()}
      openLocalSource={localSource({
        [PROJECTS_STORE_NAME]: [local],
        [PROJECT_RESOURCES_STORE_NAME]: [euro],
      })}
      readLegacyJson={() => null}
    />,
  );
  return { storage, onImported };
}

describe("LocalImportController", () => {
  it("opens the overview after sign-in and imports only after the public-readability confirmation", async () => {
    const { storage, onImported } = setup();

    const dialog = await screen.findByRole("dialog", {
      name: "Lokale Pläne auf den Server übernehmen",
    });
    expect(dialog).toBeTruthy();
    // The Werkskatalog entry is shown but not selectable for a non-admin.
    const catalogBox = screen.getByRole("checkbox", {
      name: "EURO pallet übernehmen",
    });
    expect(catalogBox).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Nur Admins dürfen den Werkskatalog befüllen."),
    ).toBeTruthy();

    const start = screen.getByRole("button", {
      name: "1 übernehmen",
    });
    expect(start).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: /für alle lesbar/ }));
    expect(start).toHaveProperty("disabled", false);
    fireEvent.click(start);

    expect(await screen.findByText("1 Eintrag wurde übernommen.")).toBeTruthy();
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(
      (await storage.list(PROJECTS_STORE_NAME)).map(
        (row) => (row as { id: string }).id,
      ),
    ).toEqual(["local-plan"]);
    expect(await storage.list(PROJECT_RESOURCES_STORE_NAME)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Erneut vergleichen" }));
    await waitFor(() =>
      expect(screen.getByText("Bereits übernommen")).toBeTruthy(),
    );
    expect(
      screen.getByText(
        "Alle lokalen Pläne sind bereits auf dem Server. Es gibt nichts zu übernehmen.",
      ),
    ).toBeTruthy();
  });

  it("claims Escape and Tab before a Drawer's document listener when it opens over a tool", async () => {
    setup();
    const drawerKeys = vi.fn();
    document.addEventListener("keydown", drawerKeys);
    try {
      const dialog = await screen.findByRole("dialog", {
        name: "Lokale Pläne auf den Server übernehmen",
      });
      // The header's close button is the first control; Shift+Tab from it
      // wraps to the last control inside the overview.
      const close = screen.getByRole("button", { name: "Schließen" });
      close.focus();
      fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement).not.toBe(close);

      fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
      expect(drawerKeys).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      document.removeEventListener("keydown", drawerKeys);
    }
  });
});
