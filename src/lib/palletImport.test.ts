import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatImportDiagnostics, parsePalletFiles } from "~/lib/palletImport";

const validRob = readFileSync(
  resolve(
    process.cwd(),
    "src",
    "lib",
    "__fixtures__",
    "anonymized-plan-lf.rob",
  ),
  "utf8",
);

describe("pallet file imports", () => {
  it("retains valid files when another file has parser errors", async () => {
    const invalidRob = validRob.replace(
      "120 60 0 700 400 0 1 0 1",
      "120 60 0 invalid 400 0 1 0 1",
    );
    const result = await parsePalletFiles([
      { name: "valid.rob", text: async () => validRob },
      { name: "invalid.rob", text: async () => invalidRob },
      { name: "second-valid.rob", text: async () => validRob },
    ]);

    expect(result.parsed.map(({ name }) => name)).toEqual([
      "valid.rob",
      "second-valid.rob",
    ]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.fileName).toBe("invalid.rob");
    expect(result.diagnostics[0]?.line).toBe(13);
    expect(result.diagnostics[0]?.reason).toMatch(/field "x".*integer/i);
  });

  it("distinguishes file-read failures from parser failures", async () => {
    const result = await parsePalletFiles([
      {
        name: "unreadable.rob",
        text: async () => Promise.reject(new Error("permission denied")),
      },
    ]);

    expect(result.parsed).toEqual([]);
    expect(result.diagnostics[0]).toEqual({
      fileName: "unreadable.rob",
      line: null,
      reason: "Unable to read file: permission denied",
    });
  });

  it("formats diagnostics under their filenames", () => {
    const message = formatImportDiagnostics([
      { fileName: "broken.rob", line: 8, reason: "field x must be an integer" },
      { fileName: "unreadable.rob", line: null, reason: "Unable to read file" },
    ]);

    expect(message).toBe(
      [
        "Some files could not be imported:",
        "• broken.rob",
        "  Line 8: field x must be an integer",
        "• unreadable.rob",
        "  Unable to read file",
      ].join("\n"),
    );
  });
});
