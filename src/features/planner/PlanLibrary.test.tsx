import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { PlanLibrary } from "./PlanLibrary";
import type { ComponentProps } from "react";

const server = createProject({ id: "same-id", productNumber: "Serverplan" });
const browser = createProject({ id: "same-id", productNumber: "Browserplan" });
function props(): ComponentProps<typeof PlanLibrary> {
  return {
    projects: [server, browser],
    selectedId: null,
    loading: false,
    search: "",
    projectNumberFilter: "",
    productNumberFilter: "",
    sortBy: "updatedAt",
    sortDirection: "desc",
    projectConflictPolicy: "rename",
    resourceConflictPolicy: "rename",
    onSearchChange: vi.fn(),
    onProjectNumberFilterChange: vi.fn(),
    onProductNumberFilterChange: vi.fn(),
    onSortChange: vi.fn(),
    onProjectConflictPolicyChange: vi.fn(),
    onResourceConflictPolicyChange: vi.fn(),
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onDuplicate: vi.fn(),
    onSaveAs: vi.fn(),
    onDelete: vi.fn(),
    onExportSelected: vi.fn(),
    onDownloadRob: vi.fn(),
    onExportAll: vi.fn(),
    onImport: vi.fn(),
    onImportRob: vi.fn(),
    projectKey: (project) =>
      project === browser ? "browser:same-id" : project.id,
    originFor: (key) =>
      key.startsWith("browser:") ? "browser-local" : "server",
    editDisabledReason: (key) =>
      key.startsWith("browser:") ? null : "Bitte anmelden",
    deleteDisabledReason: (key) =>
      key.startsWith("browser:") ? null : "Bitte anmelden",
    onCopyToBrowser: vi.fn(),
    createHint: "Neue Pläne bleiben in diesem Browser.",
  };
}
afterEach(cleanup);
describe("plan library origins", () => {
  it("separates unpublished plans and routes same-id rows using opaque keys", () => {
    const p = props();
    render(<PlanLibrary {...p} />);
    const local = within(
      screen.getByRole("region", {
        name: "Nur in diesem Browser (nicht veröffentlicht)",
      }),
    );
    expect(local.getByText("Nur in diesem Browser")).toBeTruthy();
    fireEvent.click(local.getByRole("button", { name: "Öffnen" }));
    expect(p.onSelect).toHaveBeenCalledWith("browser:same-id");
    fireEvent.click(local.getByRole("button", { name: "Angaben bearbeiten" }));
    expect(p.onEdit).toHaveBeenCalledWith("browser:same-id");
    const published = within(
      screen.getByRole("region", { name: "Veröffentlichte Pläne" }),
    );
    expect(
      (
        published.getByRole("button", {
          name: "Angaben bearbeiten",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      published.getByRole("button", { name: "In diesem Browser kopieren" }),
    );
    expect(p.onCopyToBrowser).toHaveBeenCalledWith("same-id");
    fireEvent.click(local.getByRole("button", { name: "Löschen" }));
    const confirm = local.getByRole("alert");
    fireEvent.click(within(confirm).getByRole("button", { name: "Löschen" }));
    expect(p.onDelete).toHaveBeenCalledWith("browser:same-id");
  });
  it("enables anonymous creation and both imports with a browser notice", () => {
    const p = props();
    render(<PlanLibrary {...p} />);
    expect(screen.getByText(p.createHint!)).toBeTruthy();
    for (const name of [
      "＋ Neuer Plan",
      ".rob öffnen",
      "Projektpaket importieren",
    ]) {
      expect(
        (screen.getByRole("button", { name }) as HTMLButtonElement).disabled,
      ).toBe(false);
    }
    fireEvent.click(screen.getByRole("button", { name: "＋ Neuer Plan" }));
    expect(p.onCreate).toHaveBeenCalledOnce();
  });
  it("keeps local mode as a single unmarked inventory", () => {
    const p = props();
    render(
      <PlanLibrary
        {...p}
        projects={[server]}
        originFor={undefined}
        projectKey={undefined}
      />,
    );
    expect(screen.queryByText("Nur in diesem Browser")).toBeNull();
    expect(
      screen.getByRole("list", { name: "Gespeicherte Pläne" }),
    ).toBeTruthy();
  });
});
