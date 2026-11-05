import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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
    }) as HTMLInputElement;
    expect(catalogBox.disabled).toBe(true);
    expect(
      screen.getByText("Nur Admins dürfen den Werkskatalog befüllen"),
    ).toBeTruthy();

    const start = screen.getByRole("button", {
      name: "1 übernehmen",
    }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /für alle lesbar/ }));
    expect(start.disabled).toBe(false);
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
});
