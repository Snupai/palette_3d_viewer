// @vitest-environment node
// scripts/pg-backup.sh (issue #38) against fake pg_dump/pg_restore binaries:
// atomic write, retention pruning, failure handling, health and the restore
// guard. The real tools run in the compose `backup` service (README).
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "../../../scripts/pg-backup.sh");
const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;
const DAY_S = 24 * 60 * 60;

// POSIX paths for the shell (Git Bash on Windows accepts C:/…).
const posix = (p: string) => p.split(path.sep).join("/");

// Each case spawns several shells (slow on Windows under a full parallel run).
describe.skipIf(!hasSh)("pg-backup.sh", { timeout: 30_000 }, () => {
  let root: string;
  let backups: string;
  let restoreLog: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "pg-backup-"));
    backups = path.join(root, "backups");
    restoreLog = path.join(root, "restore.log");
    spawnSync("sh", ["-c", `mkdir -p "${posix(backups)}"`]);
    // pg_dump: writes the archive given by --file=…; FAKE_DUMP_FAIL makes it fail.
    writeFake(
      "pg_dump",
      `for a; do case $a in --file=*) f=\${a#--file=} ;; esac; done
[ -z "\${FAKE_DUMP_FAIL:-}" ] || { printf 'half' >"$f"; exit 1; }
printf '%s' "\${FAKE_DUMP_CONTENT:-PGDMP fake}" >"$f"`,
    );
    // pg_restore: --list accepts files starting with PGDMP; otherwise it
    // writes the dump as SQL to --file=… (FAKE_SQL_FAIL makes that fail).
    writeFake(
      "pg_restore",
      `if [ "$1" = --list ]; then head -c 5 "$2" | grep -q PGDMP; exit; fi
[ -z "\${FAKE_SQL_FAIL:-}" ] || exit 1
for a; do case $a in --file=*) f=\${a#--file=} ;; esac; done
printf 'RESTORE SQL' >"$f"`,
    );
    // psql: logs its arguments, with the -f file replaced by its content.
    writeFake(
      "psql",
      `for a; do [ -f "$a" ] && cat "$a" || printf '%s' "$a"; echo; done >"${posix(restoreLog)}"`,
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function writeFake(name: string, body: string) {
    const file = path.join(root, name);
    writeFileSync(file, `#!/bin/sh\n${body}\n`);
    chmodSync(file, 0o755);
  }

  function run(args: string[], env: Record<string, string> = {}) {
    const result = spawnSync("sh", [posix(SCRIPT), ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PALETTE_BACKUP_DIR: posix(backups),
        PG_DUMP: posix(path.join(root, "pg_dump")),
        PG_RESTORE: posix(path.join(root, "pg_restore")),
        PSQL: posix(path.join(root, "psql")),
        ...env,
      },
    });
    return {
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }

  function seed(name: string, ageSeconds: number, content = "PGDMP old") {
    const file = path.join(backups, name);
    writeFileSync(file, content);
    const when = Date.now() / 1000 - ageSeconds;
    utimesSync(file, when, when);
  }

  const listing = () => readdirSync(backups).sort();

  it("writes one complete timestamped dump and prunes dumps past retention", () => {
    seed("palette-20260101T000000Z.dump", 8 * DAY_S);
    seed("palette-20260103T000000Z.dump", 6 * DAY_S);
    seed("notes.dump", 30 * DAY_S);
    seed(".palette-partial.AbC123", 2 * DAY_S);

    const result = run(["once"]);

    expect(result.status).toBe(0);
    const files = listing();
    expect(files).toHaveLength(3);
    expect(files.slice(0, 2)).toEqual([
      "notes.dump",
      "palette-20260103T000000Z.dump",
    ]);
    expect(files[2]).toMatch(/^palette-\d{8}T\d{6}Z\.dump$/);
    expect(readFileSync(path.join(backups, files[2]!), "utf8")).toBe(
      "PGDMP fake",
    );
    expect(result.stderr).toContain("pruned palette-20260101T000000Z.dump");
  });

  it("keeps two dumps started in the same second apart", () => {
    // A scheduled dump and `db:backup` overlapping: both must publish their
    // own complete file, and no temporary file may be shared or left behind.
    writeFake(
      "pg_dump",
      `for a; do case $a in --file=*) f=\${a#--file=} ;; esac; done
printf 'PGDMP ' >"$f"; sleep 1; printf '%s' "$$" >>"$f"`,
    );
    const env = {
      ...process.env,
      PALETTE_BACKUP_DIR: posix(backups),
      PG_DUMP: posix(path.join(root, "pg_dump")),
      PG_RESTORE: posix(path.join(root, "pg_restore")),
      PSQL: posix(path.join(root, "psql")),
    };
    const both = spawnSync(
      "sh",
      ["-c", `sh "$0" once & sh "$0" once & wait`, posix(SCRIPT)],
      { encoding: "utf8", env },
    );

    expect(both.status).toBe(0);
    const files = listing();
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file).toMatch(/^palette-\d{8}T\d{6}Z(-2)?\.dump$/);
      expect(readFileSync(path.join(backups, file), "utf8")).toMatch(
        /^PGDMP \d+$/,
      );
    }
    const contents = files.map((file) =>
      readFileSync(path.join(backups, file), "utf8"),
    );
    expect(new Set(contents).size).toBe(2);
  });

  it("honours PALETTE_BACKUP_RETENTION_DAYS", () => {
    seed("palette-20260103T000000Z.dump", 3 * DAY_S);
    seed("palette-20260104T000000Z.dump", 1 * DAY_S);

    expect(run(["once"], { PALETTE_BACKUP_RETENTION_DAYS: "2" }).status).toBe(
      0,
    );

    expect(listing()).toHaveLength(2);
    expect(listing()).toContain("palette-20260104T000000Z.dump");
  });

  it("keeps every existing dump and leaves no partial file when pg_dump fails", () => {
    seed("palette-20260101T000000Z.dump", 8 * DAY_S);

    const result = run(["once"], { FAKE_DUMP_FAIL: "1" });

    expect(result.status).toBe(1);
    expect(listing()).toEqual(["palette-20260101T000000Z.dump"]);
    expect(result.stderr).toContain("backup FAILED; existing dumps kept");
  });

  it("discards a dump that pg_restore cannot list", () => {
    const result = run(["once"], { FAKE_DUMP_CONTENT: "garbage" });

    expect(result.status).toBe(1);
    expect(listing()).toEqual([]);
  });

  it("reports health from the age of the newest dump", () => {
    seed("palette-20260101T000000Z.dump", 3 * 60 * 60);
    expect(run(["health"]).status).toBe(1);

    seed("palette-20260102T000000Z.dump", 60);
    expect(run(["health"]).status).toBe(0);
  });

  it("refuses to restore without --yes and restores in one transaction with it", () => {
    seed("palette-20260101T000000Z.dump", 60);

    const refused = run(["restore", "palette-20260101T000000Z.dump"]);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("REPLACES all data");
    expect(existsSync(restoreLog)).toBe(false);

    const restored = run(
      ["restore", "palette-20260101T000000Z.dump", "--yes"],
      {
        PGDATABASE: "palette",
      },
    );
    expect(restored.status).toBe(0);
    const psqlArgs = readFileSync(restoreLog, "utf8").trim().split("\n");
    expect(psqlArgs.slice(0, 8)).toEqual([
      "-X",
      "-q",
      "-o",
      "/dev/null",
      "-v",
      "ON_ERROR_STOP=1",
      "--single-transaction",
      "--dbname=palette",
    ]);
    // Drops every non-system schema before replaying the dump, in that order.
    expect(psqlArgs[8]).toBe("-c");
    expect(psqlArgs[9]).toBe("DO $$ DECLARE s name; BEGIN");
    expect(psqlArgs.at(-3)).toBe("END $$; CREATE SCHEMA public;");
    expect(psqlArgs.slice(-2)).toEqual(["-f", "RESTORE SQL"]);
  });

  it("changes nothing when the dump cannot be converted for restore", () => {
    seed("palette-20260101T000000Z.dump", 60);

    const result = run(["restore", "palette-20260101T000000Z.dump", "--yes"], {
      FAKE_SQL_FAIL: "1",
    });

    expect(result.status).toBe(1);
    expect(existsSync(restoreLog)).toBe(false);
  });

  it("rejects a missing backup file and invalid settings", () => {
    expect(run(["restore", "palette-missing.dump", "--yes"]).status).toBe(2);
    expect(
      run(["once"], { PALETTE_BACKUP_INTERVAL_SECONDS: "1h" }).status,
    ).toBe(2);
    expect(
      run(["once"], { PALETTE_BACKUP_DIR: posix(path.join(root, "nope")) })
        .status,
    ).toBe(2);
  });
});
