import { lstat, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import type {
  CorpusDiscoveryIssue,
  DiscoveredRobFile,
  ResolvedCorpusRoot,
} from "~/lib/parity/types";

export const DEFAULT_ROB_CORPUS_MAX_FILE_BYTES = 8 * 1024 * 1024;

export class RobCorpusConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RobCorpusConfigurationError";
  }
}

export function pathIsWithinRoot(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return (
    relation === "" ||
    (!relation.startsWith(`..${sep}`) &&
      relation !== ".." &&
      !isAbsolute(relation))
  );
}

export type RobCorpusEnvironment = Readonly<Record<string, string | undefined>>;

export async function resolveRobCorpusRoot(
  explicitRoot?: string,
  env: RobCorpusEnvironment = process.env,
): Promise<ResolvedCorpusRoot> {
  const suppliedRoot = explicitRoot ?? env.ROB_CORPUS_DIR;
  if (!suppliedRoot?.trim()) {
    throw new RobCorpusConfigurationError(
      "ROB_CORPUS_DIR is not set and no explicit corpus root was supplied.",
    );
  }
  if (!isAbsolute(suppliedRoot)) {
    throw new RobCorpusConfigurationError(
      "The .rob corpus root must be an absolute path.",
    );
  }

  const absolutePath = resolve(suppliedRoot);
  let rootStat;
  try {
    rootStat = await lstat(absolutePath);
  } catch {
    throw new RobCorpusConfigurationError(
      "The configured .rob corpus root is unavailable.",
    );
  }
  if (rootStat.isSymbolicLink()) {
    throw new RobCorpusConfigurationError(
      "The configured .rob corpus root must not be a symlink.",
    );
  }
  if (!rootStat.isDirectory()) {
    throw new RobCorpusConfigurationError(
      "The configured .rob corpus root must be a directory.",
    );
  }

  return { absolutePath, realPath: await realpath(absolutePath) };
}

export type DiscoverRobCorpusOptions = {
  root?: string;
  env?: RobCorpusEnvironment;
  maxFileBytes?: number;
};

export type RobCorpusDiscovery = {
  root: ResolvedCorpusRoot;
  files: DiscoveredRobFile[];
  issues: CorpusDiscoveryIssue[];
};

function issue(
  entryBasename: string,
  code: CorpusDiscoveryIssue["code"],
  summary: string,
): CorpusDiscoveryIssue {
  return { basename: entryBasename, code, status: "SKIPPED", summary };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBasenames(left: string, right: string): number {
  return (
    compareStrings(left.toLowerCase(), right.toLowerCase()) ||
    compareStrings(left, right)
  );
}

export async function discoverRobCorpus(
  options: DiscoverRobCorpusOptions = {},
): Promise<RobCorpusDiscovery> {
  const maxFileBytes =
    options.maxFileBytes ?? DEFAULT_ROB_CORPUS_MAX_FILE_BYTES;
  if (!Number.isInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new RobCorpusConfigurationError(
      "The maximum .rob file size must be a positive integer.",
    );
  }

  const root = await resolveRobCorpusRoot(options.root, options.env);
  const files: DiscoveredRobFile[] = [];
  const issues: CorpusDiscoveryIssue[] = [];

  const visit = async (directory: string): Promise<void> => {
    let directoryRealPath: string;
    try {
      directoryRealPath = await realpath(directory);
    } catch {
      issues.push(
        issue(
          basename(directory),
          "entry-unreadable",
          "A corpus directory could not be resolved and was skipped.",
        ),
      );
      return;
    }
    if (!pathIsWithinRoot(root.realPath, directoryRealPath)) {
      issues.push(
        issue(
          basename(directory),
          "out-of-root-rejected",
          "A directory resolved outside the configured corpus root and was rejected.",
        ),
      );
      return;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      issues.push(
        issue(
          basename(directory),
          "entry-unreadable",
          "A corpus directory could not be read and was skipped.",
        ),
      );
      return;
    }

    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      let entryStat;
      try {
        entryStat = await lstat(absolutePath);
      } catch {
        issues.push(
          issue(
            entry.name,
            "entry-unreadable",
            "A corpus entry could not be inspected and was skipped.",
          ),
        );
        continue;
      }

      if (entryStat.isSymbolicLink()) {
        issues.push(
          issue(
            entry.name,
            "symlink-rejected",
            "Symlinked corpus entries are never followed.",
          ),
        );
        continue;
      }
      if (entryStat.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!/\.rob$/i.test(entry.name)) continue;
      if (!entryStat.isFile()) {
        issues.push(
          issue(
            entry.name,
            "not-regular-file",
            "Only regular .rob files are accepted.",
          ),
        );
        continue;
      }
      if (entryStat.size > maxFileBytes) {
        issues.push(
          issue(
            entry.name,
            "file-too-large",
            "The .rob file exceeds the configured byte limit.",
          ),
        );
        continue;
      }

      let fileRealPath: string;
      try {
        fileRealPath = await realpath(absolutePath);
      } catch {
        issues.push(
          issue(
            entry.name,
            "entry-unreadable",
            "A .rob file could not be resolved and was skipped.",
          ),
        );
        continue;
      }
      if (!pathIsWithinRoot(root.realPath, fileRealPath)) {
        issues.push(
          issue(
            entry.name,
            "out-of-root-rejected",
            "A .rob file resolved outside the configured corpus root and was rejected.",
          ),
        );
        continue;
      }
      files.push({
        absolutePath,
        basename: entry.name,
        byteLength: entryStat.size,
      });
    }
  };

  await visit(root.absolutePath);
  files.sort(
    (left, right) =>
      compareBasenames(left.basename, right.basename) ||
      compareStrings(left.absolutePath, right.absolutePath),
  );
  issues.sort(
    (left, right) =>
      compareBasenames(left.basename, right.basename) ||
      compareStrings(left.code, right.code),
  );
  return { root, files, issues };
}
