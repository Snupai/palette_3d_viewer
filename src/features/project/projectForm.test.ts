import { describe, expect, it } from "vitest";
import { createProject } from "~/domain/project/projectFactory";
import { projectToFormValues } from "~/features/project/projectForm";

describe("project form", () => {
  it("leaves package dimensions empty for create mode and preserves edit values", () => {
    const createValues = projectToFormValues(null);
    const project = createProject(
      {
        package: {
          dimensionsMm: { length: 157, width: 106, height: 150 },
        },
      },
      { now: () => 1, createId: (kind) => `${kind}-form` },
    );
    const editValues = projectToFormValues(project);

    expect([
      createValues.packageLengthMm,
      createValues.packageWidthMm,
      createValues.packageHeightMm,
    ]).toEqual(["", "", ""]);
    expect([
      editValues.packageLengthMm,
      editValues.packageWidthMm,
      editValues.packageHeightMm,
    ]).toEqual(["157", "106", "150"]);
  });
});
