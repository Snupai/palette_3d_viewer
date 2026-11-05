import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Drawer } from "~/components/ui/Drawer";
import { createProject, updateProject } from "~/domain/project/projectFactory";
import { ProjectConflictView } from "./ProjectConflictView";
import { createProjectConflict } from "./projectConflictModel";

afterEach(cleanup);

function conflict() {
  const server = createProject(
    { id: "plan", projectNumber: "THEIRS" },
    { createId: (kind) => `plan-${kind}`, now: () => 1 },
  );
  const mine = updateProject(
    server,
    { projectNumber: "MINE" },
    {
      now: () => 2,
    },
  );
  return createProjectConflict(mine, { project: server, version: 2 });
}

/** The conflict view opened over a production tool, as in the editor. */
function renderOverDrawer(busy = false) {
  const closeDrawer = vi.fn();
  const later = vi.fn();
  render(
    <>
      <Drawer open title="Muster-Editor" onClose={closeDrawer}>
        <button type="button">Im Editor</button>
      </Drawer>
      <ProjectConflictView
        conflict={conflict()}
        busy={busy}
        error={null}
        onChoose={vi.fn()}
        onLater={later}
      />
    </>,
  );
  return { closeDrawer, later };
}

describe("ProjectConflictView over an open Drawer", () => {
  it("closes only the conflict view on Escape, never the tool behind it", () => {
    const { closeDrawer, later } = renderOverDrawer();

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    expect(later).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();
  });

  it("keeps Tab focus inside the conflict view", () => {
    renderOverDrawer();
    const first = screen.getByRole("button", {
      name: "Meinen Entwurf speichern",
    });
    const last = screen.getByRole("button", { name: "Später entscheiden" });

    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("keeps Tab inside while saving disables every action", () => {
    renderOverDrawer(true);
    const dialog = screen.getByRole("dialog", {
      name: "Plan wurde inzwischen geändert",
    });
    const tool = screen.getByRole("button", { name: "Im Editor" });

    tool.focus();
    fireEvent.keyDown(tool, { key: "Tab" });
    expect(document.activeElement).toBe(dialog);
  });
});
