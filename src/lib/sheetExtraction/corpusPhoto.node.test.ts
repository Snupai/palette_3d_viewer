// @vitest-environment node

import {
  lstat,
  mkdtemp,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readCheckedRegularFile,
  readCorpusPhoto,
} from "~/lib/sheetExtraction/corpusPhoto.node";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sheet-corpus-photo-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("sheet corpus photo reading", () => {
  it("reads exactly the checked file", async () => {
    const root = await temporaryDirectory();
    await writeFile(join(root, "a.jpg"), "photo");

    const bytes = await readCorpusPhoto(root, "a.jpg");

    expect(bytes.toString("utf8")).toBe("photo");
  });

  it("rejects a file replaced or relinked between check and read", async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const path = join(root, "a.jpg");
    await writeFile(path, "photo");
    await writeFile(join(outside, "secret.txt"), "secret");
    const checked = await lstat(path);

    // Swap in another regular file under the checked name.
    await writeFile(join(root, "b.jpg"), "other");
    await rename(join(root, "b.jpg"), path);
    await expect(readCheckedRegularFile(path, checked, 100)).rejects.toThrow(
      "Photo changed while it was being read.",
    );

    // Swap in a link to a file outside the corpus.
    await rm(path);
    await symlink(join(outside, "secret.txt"), path);
    await expect(
      readCheckedRegularFile(path, checked, 100),
    ).rejects.toMatchObject({ code: "ELOOP" });
  });
});
