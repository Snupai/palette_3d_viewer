import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathIsWithinRoot } from "~/lib/parity/discovery.node";

/** Same bound as the upload route; anything larger is not a sheet photo. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/** Device and inode of a file as seen when it was checked. */
export type FileIdentity = { dev: number; ino: number };

/**
 * Reads `path` through one handle and only if it is still the regular file
 * identified by `expected`: the final component is opened without following
 * links, the handle is fstat-ed, and exactly the fstat size is read. A file
 * swapped, linked, or grown between check and read is rejected.
 */
export async function readCheckedRegularFile(
  path: string,
  expected: FileIdentity,
  maxBytes: number,
): Promise<Buffer> {
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new Error("Photo is not a regular file.");
    }
    if (
      (expected.dev !== 0 || expected.ino !== 0) &&
      (opened.dev !== expected.dev || opened.ino !== expected.ino)
    ) {
      throw new Error("Photo changed while it was being read.");
    }
    if (opened.size > maxBytes) {
      throw new Error("Photo is larger than the byte limit.");
    }
    // One spare byte detects a file that grew after fstat.
    const buffer = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length !== opened.size) {
      throw new Error("Photo changed while it was being read.");
    }
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

/**
 * Reads one labelled photo. `labels.json` keys are untrusted: only plain
 * regular files directly inside the canonical corpus root are accepted, so a
 * key or link cannot send other files to the model.
 */
export async function readCorpusPhoto(
  root: string,
  file: string,
): Promise<Buffer> {
  if (file !== basename(file) || file === "." || file === "..") {
    throw new Error("Label key must be a plain file name inside the corpus.");
  }
  const path = join(root, file);
  const stat = await lstat(path);
  if (!stat.isFile()) {
    throw new Error("Label key must name a regular file, not a link.");
  }
  if (stat.size > MAX_PHOTO_BYTES) {
    throw new Error("Photo is larger than 20 MB.");
  }
  if (!pathIsWithinRoot(root, await realpath(path))) {
    throw new Error("Photo resolves outside the corpus.");
  }
  return readCheckedRegularFile(path, stat, MAX_PHOTO_BYTES);
}
