// @vitest-environment node

import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverRobCorpus,
  resolveRobCorpusRoot,
} from "~/lib/parity/discovery.node";
import { loadRobFileSafely } from "~/lib/parity/loader.node";
import type { RobCorpusLoadError } from "~/lib/parity/loader.node";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
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

describe("external .rob corpus discovery fencing", () => {
  it("requires an explicit absolute root or ROB_CORPUS_DIR", async () => {
    await expect(resolveRobCorpusRoot(undefined, {})).rejects.toThrow(
      "ROB_CORPUS_DIR is not set",
    );
    await expect(resolveRobCorpusRoot("relative/corpus", {})).rejects.toThrow(
      "absolute path",
    );
  });

  it("discovers regular .rob files case-insensitively and rejects oversized entries", async () => {
    const root = await temporaryDirectory("rob-corpus-discovery-");
    const nested = join(root, "nested");
    await mkdir(nested);
    await writeFile(join(root, "first.rob"), "1234", "utf8");
    await writeFile(join(nested, "second.ROB"), "12345", "utf8");
    await writeFile(join(root, "ignored.txt"), "123", "utf8");

    const discovery = await discoverRobCorpus({ root, maxFileBytes: 4 });

    expect(discovery.files.map(({ basename }) => basename)).toEqual([
      "first.rob",
    ]);
    expect(discovery.issues).toContainEqual({
      basename: "second.ROB",
      code: "file-too-large",
      status: "SKIPPED",
      summary: "The .rob file exceeds the configured byte limit.",
    });
    expect(JSON.stringify(discovery.issues)).not.toContain(root);
  });

  it("rejects a direct out-of-root load even when given a forged descriptor", async () => {
    const rootPath = await temporaryDirectory("rob-corpus-root-");
    const outside = await temporaryDirectory("rob-corpus-outside-");
    const outsideFile = join(outside, "outside.rob");
    await writeFile(outsideFile, "123", "utf8");
    const root = await resolveRobCorpusRoot(rootPath, {});

    await expect(
      loadRobFileSafely(
        root,
        { absolutePath: outsideFile, basename: "outside.rob", byteLength: 3 },
        10,
      ),
    ).rejects.toMatchObject({
      code: "out-of-root",
      entryBasename: "outside.rob",
    } satisfies Partial<RobCorpusLoadError>);
  });

  it("does not follow symlinked directories", async ({ skip }) => {
    const root = await temporaryDirectory("rob-corpus-symlink-root-");
    const outside = await temporaryDirectory("rob-corpus-symlink-target-");
    await writeFile(join(outside, "hidden.rob"), "123", "utf8");
    const linkPath = join(root, "linked-directory");
    try {
      await symlink(
        outside,
        linkPath,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (cause) {
      if (
        cause instanceof Error &&
        "code" in cause &&
        (cause.code === "EPERM" || cause.code === "EACCES")
      ) {
        skip();
        return;
      }
      throw cause;
    }

    const discovery = await discoverRobCorpus({ root, maxFileBytes: 10 });

    expect(discovery.files).toEqual([]);
    expect(discovery.issues).toContainEqual({
      basename: "linked-directory",
      code: "symlink-rejected",
      status: "SKIPPED",
      summary: "Symlinked corpus entries are never followed.",
    });
    expect(discovery.files).not.toContainEqual(
      expect.objectContaining({
        absolutePath: resolve(linkPath, "hidden.rob"),
      }),
    );
  });
});
