import { lstat, open, realpath } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { pathIsWithinRoot } from "~/lib/parity/discovery.node";
import type {
  DiscoveredRobFile,
  LoadedRobFile,
  ResolvedCorpusRoot,
} from "~/lib/parity/types";

export type RobCorpusLoadErrorCode =
  | "out-of-root"
  | "symlink"
  | "not-regular-file"
  | "file-too-large"
  | "not-rob-file"
  | "file-changed"
  | "unreadable";

export class RobCorpusLoadError extends Error {
  constructor(
    readonly code: RobCorpusLoadErrorCode,
    readonly entryBasename: string,
    message: string,
  ) {
    super(message);
    this.name = "RobCorpusLoadError";
  }
}

function rejected(
  code: RobCorpusLoadErrorCode,
  entryBasename: string,
  message: string,
): never {
  throw new RobCorpusLoadError(code, entryBasename, message);
}

export async function loadRobFileSafely(
  root: ResolvedCorpusRoot,
  file: DiscoveredRobFile,
  maxFileBytes: number,
): Promise<LoadedRobFile> {
  const entryBasename = basename(file.absolutePath);
  if (!isAbsolute(file.absolutePath)) {
    rejected(
      "out-of-root",
      entryBasename,
      "The .rob file path must be absolute and within the corpus root.",
    );
  }
  if (!pathIsWithinRoot(root.absolutePath, file.absolutePath)) {
    rejected(
      "out-of-root",
      entryBasename,
      "The .rob file path is outside the configured corpus root.",
    );
  }
  if (!/\.rob$/i.test(entryBasename)) {
    rejected(
      "not-rob-file",
      entryBasename,
      "Only case-insensitive .rob file extensions are accepted.",
    );
  }

  let before;
  try {
    before = await lstat(file.absolutePath);
  } catch {
    rejected(
      "unreadable",
      entryBasename,
      "The .rob file could not be inspected.",
    );
  }
  if (before.isSymbolicLink()) {
    rejected("symlink", entryBasename, "Symlinked .rob files are rejected.");
  }
  if (!before.isFile()) {
    rejected(
      "not-regular-file",
      entryBasename,
      "The corpus entry is not a regular file.",
    );
  }
  if (before.size > maxFileBytes) {
    rejected(
      "file-too-large",
      entryBasename,
      "The .rob file exceeds the configured byte limit.",
    );
  }

  let resolvedPath;
  try {
    resolvedPath = await realpath(file.absolutePath);
  } catch {
    rejected(
      "unreadable",
      entryBasename,
      "The .rob file could not be resolved.",
    );
  }
  if (!pathIsWithinRoot(root.realPath, resolvedPath)) {
    rejected(
      "out-of-root",
      entryBasename,
      "The .rob file resolves outside the configured corpus root.",
    );
  }

  let handle;
  try {
    handle = await open(file.absolutePath, "r");
  } catch {
    rejected("unreadable", entryBasename, "The .rob file could not be opened.");
  }

  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      rejected(
        "not-regular-file",
        entryBasename,
        "The opened corpus entry is not a regular file.",
      );
    }
    if (
      (before.dev !== 0 || before.ino !== 0) &&
      (opened.dev !== before.dev || opened.ino !== before.ino)
    ) {
      rejected(
        "file-changed",
        entryBasename,
        "The .rob file changed while it was being opened.",
      );
    }
    if (opened.size > maxFileBytes) {
      rejected(
        "file-too-large",
        entryBasename,
        "The opened .rob file exceeds the configured byte limit.",
      );
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength > maxFileBytes) {
      rejected(
        "file-too-large",
        entryBasename,
        "The loaded .rob file exceeds the configured byte limit.",
      );
    }
    return { basename: entryBasename, bytes };
  } finally {
    await handle.close();
  }
}

export function decodeRobBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RobCorpusLoadError(
      "unreadable",
      "unknown.rob",
      "The .rob file is not valid UTF-8 text.",
    );
  }
}
