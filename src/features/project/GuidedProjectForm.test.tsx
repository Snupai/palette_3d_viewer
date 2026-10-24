import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectDialog } from "~/features/project/ProjectDialog";
import {
  buildProjectFromForm,
  projectToFormValues,
} from "~/features/project/projectForm";

afterEach(cleanup);

function renderInline(
  overrides: Partial<Parameters<typeof ProjectDialog>[0]> = {},
) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <ProjectDialog
      inline
      open
      project={null}
      onClose={onClose}
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onSave, onClose, ...view };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("GuidedProjectForm (inline ProjectDialog)", () => {
  it("expands automatic storage for overhang but validates an explicit smaller limit", async () => {
    const { onSave } = renderInline();
    type("Artikelnummer", "OVERHANG");
    type("Länge", "400");
    type("Breite", "300");
    type("Höhe", "200");
    type("Überstand Länge", "40");
    expect(screen.getByLabelText<HTMLInputElement>("Lagerlänge").value).toBe(
      "1240",
    );
    type("Lagerlänge", "1200");
    fireEvent.click(screen.getByRole("button", { name: "Nur speichern" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        "Muss die zulässige Ladelänge (Palette plus Überstand) aufnehmen.",
      ),
    ).toBeTruthy();
    type("Lagerlänge", "1240");
    fireEvent.click(screen.getByRole("button", { name: "Nur speichern" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      project: { pallet: { storageEnvelopeMm: { length: 1240 } } },
    });
  });

  it("preserves automatic storage axes when reopening a saved guided plan", () => {
    const project = buildProjectFromForm(
      {
        ...projectToFormValues(null),
        productNumber: "AUTO",
        packageLengthMm: "400",
        packageWidthMm: "300",
        packageHeightMm: "200",
      },
      null,
    );
    renderInline({ project });
    type("Überstand Länge", "40");
    expect(screen.getByLabelText<HTMLInputElement>("Lagerlänge").value).toBe(
      "1240",
    );
    type("Lagerbreite", "850");
    type("Überstand Breite", "20");
    expect(screen.getByLabelText<HTMLInputElement>("Lagerbreite").value).toBe(
      "850",
    );
  });

  it("starts blank, keeps the same input node while typing, and shows errors only after edit and blur", () => {
    renderInline();
    // The article step comes first; package dimensions are the second step.
    expect(document.activeElement).toBe(screen.getByLabelText("Artikelnummer"));
    const length = screen.getByLabelText<HTMLInputElement>("Länge");
    expect(length.value).toBe("");

    type("Länge", "0");
    expect(screen.queryByText("Muss größer als 0 sein.")).toBeNull();
    fireEvent.blur(length);
    expect(screen.getByText("Muss größer als 0 sein.")).toBeTruthy();
    expect(length.getAttribute("aria-invalid")).toBe("true");

    type("Länge", "400");
    expect(screen.getByLabelText("Länge")).toBe(length);
    expect(screen.queryByText("Muss größer als 0 sein.")).toBeNull();

    // Untouched required fields stay quiet until submit.
    fireEvent.blur(screen.getByLabelText("Breite"));
    expect(screen.queryByText("Bitte eine Zahl eingeben.")).toBeNull();
  });

  it("opens the section of the first error and focuses its field on submit", async () => {
    const { onSave } = renderInline();
    type("Artikelnummer", "A-1");
    type("Länge", "400");
    type("Breite", "300");
    type("Höhe", "190");
    fireEvent.click(screen.getByRole("button", { name: /^Grenzen/ }));
    type("Leergewicht Palette", "30");
    type("Max. Bruttogewicht", "10");
    fireEvent.click(screen.getByRole("button", { name: /^Paket/ }));
    type("Genaue Anzahl", "6");

    fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    const gross = screen.getByLabelText("Max. Bruttogewicht");
    await waitFor(() => expect(document.activeElement).toBe(gross));
    expect(
      screen.getByText("Muss mindestens so groß wie das Leergewicht sein."),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /^Grenzen/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("requires the exact count only for generation and submits it as the intent", async () => {
    const { onSave, onClose } = renderInline();
    type("Artikelnummer", "A-1");
    type("Länge", "400");
    type("Breite", "300");
    type("Höhe", "190");
    fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));
    const count = screen.getByLabelText("Genaue Anzahl");
    await waitFor(() => expect(document.activeElement).toBe(count));
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "8 aus dem einfachen Raster" }),
    );
    expect(screen.getByLabelText<HTMLInputElement>("Genaue Anzahl").value).toBe(
      "8",
    );
    fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      project: {
        package: {
          dimensionsMm: { length: 400, width: 300, height: 190 },
          weightKg: null,
          labelSidesAtPickup: ["bottom"],
        },
        pallet: {
          storageEnvelopeMm: { length: 1200, width: 800, height: 1800 },
        },
      },
      generationIntent: { exactPackageCount: 8 },
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves without generation via Nur speichern and closes on Escape", async () => {
    const { onSave, onClose } = renderInline();
    type("Artikelnummer", "A-1");
    type("Länge", "157");
    type("Breite", "106");
    type("Höhe", "150");
    fireEvent.click(screen.getByRole("button", { name: /^Einlauf, Etikett/ }));
    fireEvent.click(screen.getByLabelText("Quer"));
    fireEvent.click(screen.getByRole("button", { name: "Etikett oben" }));
    fireEvent.click(screen.getByRole("button", { name: "Nur speichern" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      project: {
        package: {
          inletOrientation: "crosswise",
          // The top edge at a crosswise infeed is the package's right side.
          labelSidesAtPickup: ["right"],
        },
      },
      generationIntent: null,
    });

    onClose.mockClear();
    fireEvent.keyDown(screen.getByLabelText("Länge"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("edits an existing project in the requested section and says whether patterns survive", async () => {
    const project = buildProjectFromForm(
      {
        ...projectToFormValues(null),
        packageLengthMm: "400",
        packageWidthMm: "300",
        packageHeightMm: "190",
      },
      null,
      { now: () => 1, createId: (kind) => `${kind}-edit` },
    );
    const { onSave } = renderInline({ project, initialSection: "meta" });
    expect(screen.queryByLabelText("Genaue Anzahl")).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText("Artikelnummer"));

    type("Artikelnummer", "A-41820");
    expect(
      screen.getByText(
        "Diese Änderungen betreffen die Muster nicht; sie bleiben erhalten.",
      ),
    ).toBeTruthy();
    type("Länge", "410");
    expect(
      screen.getByText(
        "Geänderte Maße oder Einlaufangaben: erzeugte Muster werden verworfen. Gespeicherte Lösungen bleiben zur Prüfung erhalten und sind bis zum Neuaufbau für Robotik und Export gesperrt.",
      ),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Änderungen speichern" }),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      project: {
        id: project.id,
        productNumber: "A-41820",
        package: { dimensionsMm: { length: 410 } },
      },
      generationIntent: null,
    });
  });

  it("reports dirty inputs against the opened values and resets after save and unmount", async () => {
    const onDirtyChange = vi.fn();
    const calls: string[] = [];
    const onSave = vi.fn(() => {
      calls.push(`save:${String(onDirtyChange.mock.calls.at(-1)?.[0])}`);
    });
    const onClose = vi.fn(() => {
      calls.push(`close:${String(onDirtyChange.mock.calls.at(-1)?.[0])}`);
    });
    const view = renderInline({ onDirtyChange, onSave, onClose });
    expect(onDirtyChange).not.toHaveBeenCalled();

    type("Länge", "400");
    expect(onDirtyChange.mock.calls).toEqual([[true]]);
    type("Länge", "");
    expect(onDirtyChange.mock.calls).toEqual([[true], [false]]);
    type("Genaue Anzahl", "8");
    expect(onDirtyChange.mock.calls.at(-1)).toEqual([true]);

    type("Länge", "400");
    type("Breite", "300");
    type("Höhe", "190");
    type("Artikelnummer", "A-1");
    expect(onDirtyChange).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Muster erzeugen" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // Still dirty while saving; clean before the caller closes the form.
    expect(calls).toEqual(["save:true", "close:false"]);
    expect(onDirtyChange.mock.calls.at(-1)).toEqual([false]);

    view.unmount();
    expect(onDirtyChange).toHaveBeenCalledTimes(4);

    const dirtyOnUnmount = vi.fn();
    const second = renderInline({ onDirtyChange: dirtyOnUnmount });
    type("Höhe", "190");
    second.unmount();
    expect(dirtyOnUnmount.mock.calls).toEqual([[true], [false]]);
  });
});
