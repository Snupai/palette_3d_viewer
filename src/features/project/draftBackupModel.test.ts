import { describe, expect, it } from "vitest";

import { createProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";

import {
  draftBackupScope,
  draftBackupStatus,
  draftBaseVersion,
  readDraftBackups,
  removeAllDraftBackups,
  removeDraftBackup,
  saveFailureReason,
  writeDraftBackup,
  type DraftBackupScope,
  type DraftBackupStorage,
} from "./draftBackupModel";

class MemoryStorage implements DraftBackupStorage {
  readonly entries = new Map<string, string>();
  failWrites = false;
  get length() {
    return this.entries.size;
  }
  key(index: number) {
    return [...this.entries.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.entries.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.entries.set(key, value);
  }
  removeItem(key: string) {
    this.entries.delete(key);
  }
}

function plan(id: string, productNumber: string): Project {
  return createProject(
    { productNumber, package: { dimensionsMm: { length: 400, width: 300 } } },
    { now: () => 1, createId: (kind) => `${kind}-${id}` },
  );
}

const SERVER = "https://planner.local";
const alice = { server: SERVER, userId: "user-alice" };
const bob = { server: SERVER, userId: "user-bob" };
const aliceElsewhere = { server: "https://other.local", userId: "user-alice" };

/** A backup written by the draft `token` at revision 1. */
function seed(
  storage: MemoryStorage,
  scope: DraftBackupScope,
  project: Project,
  baseVersion: number | null,
  savedAt: number,
  token = `draft-${project.id}`,
) {
  return writeDraftBackup(storage, scope, project, baseVersion, savedAt, {
    token,
    rev: 1,
  });
}

const ids = (list: readonly { projectId: string }[]) =>
  list.map(({ projectId }) => projectId);

describe("draftBackupScope", () => {
  it("backs up only in server mode with a known user", () => {
    expect(draftBackupScope("server", SERVER, "user-alice")).toEqual(alice);
    expect(draftBackupScope("local", SERVER, "user-alice")).toBeNull();
    expect(draftBackupScope("server", SERVER, null)).toBeNull();
  });
});

describe("draftBaseVersion", () => {
  it("is the loaded version of that plan, otherwise none", () => {
    const loaded = { projectId: "project-a", version: 7 };
    expect(draftBaseVersion(loaded, "project-a")).toBe(7);
    expect(draftBaseVersion(loaded, "project-b")).toBeNull();
    expect(draftBaseVersion(null, "project-a")).toBeNull();
  });
});

describe("draft backup lifecycle", () => {
  it("keeps one backup per server, user and project and restores it intact", () => {
    const storage = new MemoryStorage();
    const draft = plan("a", "Draft A");

    expect(seed(storage, alice, draft, 4, 1000)).toBe("written");
    // The same draft's next revision replaces its backup.
    const newer = { ...draft, productNumber: "Draft A2" };
    expect(
      writeDraftBackup(storage, alice, newer, 4, 2000, {
        token: "draft-project-a",
        rev: 2,
      }),
    ).toBe("written");

    expect(readDraftBackups(storage, alice)).toEqual([
      {
        projectId: "project-a",
        project: newer,
        baseVersion: 4,
        savedAt: 2000,
        token: "draft-project-a",
        rev: 2,
      },
    ]);
    expect(readDraftBackups(storage, bob)).toEqual([]);
    expect(readDraftBackups(storage, aliceElsewhere)).toEqual([]);
  });

  it("never lets another draft overwrite or remove a backup (m1)", () => {
    const storage = new MemoryStorage();
    seed(storage, alice, plan("a", "Earlier draft"), 3, 1000, "earlier");
    const before = [...storage.entries.values()];

    // Another draft of the same plan: refused, the earlier backup stays.
    expect(
      writeDraftBackup(storage, alice, plan("a", "Later draft"), 5, 2000, {
        token: "later",
        rev: 1,
      }),
    ).toBe("foreign");
    expect([...storage.entries.values()]).toEqual(before);

    // Removing with the wrong token or a stale revision does nothing.
    expect(removeDraftBackup(storage, alice, "project-a", "later")).toBe(false);
    expect(removeDraftBackup(storage, alice, "project-a", "earlier", 2)).toBe(
      false,
    );
    expect([...storage.entries.values()]).toEqual(before);

    // Exactly that draft at exactly that revision removes it.
    expect(removeDraftBackup(storage, alice, "project-a", "earlier", 1)).toBe(
      true,
    );
    expect(readDraftBackups(storage, alice)).toEqual([]);
  });

  it("treats a backup without a token as foreign, and an unreadable one too", () => {
    const storage = new MemoryStorage();
    seed(storage, alice, plan("a", "A"), 1, 1000);
    const [key] = storage.entries.keys();
    const legacy = JSON.parse(storage.getItem(key!)!) as Record<
      string,
      unknown
    >;
    delete legacy.token;
    delete legacy.rev;
    storage.setItem(key!, JSON.stringify(legacy));

    const [read] = readDraftBackups(storage, alice);
    expect([read?.token, read?.rev]).toEqual(["legacy:1000", 0]);
    expect(seed(storage, alice, plan("a", "A2"), 1, 2000)).toBe("foreign");

    const broken = key!.replace("project-a", "project-x");
    storage.setItem(broken, "{not json");
    expect(seed(storage, alice, plan("x", "X"), 1, 2000)).toBe("foreign");
    expect(storage.getItem(broken)).toBe("{not json");
  });

  it("lists the newest backup first", () => {
    const storage = new MemoryStorage();
    seed(storage, alice, plan("a", "A"), 1, 1000);
    seed(storage, alice, plan("b", "B"), null, 3000);
    seed(storage, alice, plan("c", "C"), 2, 2000);

    expect(ids(readDraftBackups(storage, alice))).toEqual([
      "project-b",
      "project-c",
      "project-a",
    ]);
  });

  it("sign-out removes only the warned-about backups of that user on that server", () => {
    const storage = new MemoryStorage();
    seed(storage, alice, plan("a", "A"), 1, 1000);
    seed(storage, alice, plan("b", "B"), 1, 1000);
    seed(storage, alice, plan("c", "C"), 1, 1000);
    seed(storage, bob, plan("a", "A"), 1, 1000);
    seed(storage, aliceElsewhere, plan("a", "A"), 1, 1000);
    storage.setItem("saved_pallets_v1", "[]");

    // "project-c" was backed up after the warning was shown.
    const warned = new Set(["draft-project-a", "draft-project-b"]);
    expect(removeAllDraftBackups(storage, alice, warned)).toBe(2);
    expect(ids(readDraftBackups(storage, alice))).toEqual(["project-c"]);
    expect(readDraftBackups(storage, bob)).toHaveLength(1);
    expect(readDraftBackups(storage, aliceElsewhere)).toHaveLength(1);
    expect(storage.getItem("saved_pallets_v1")).toBe("[]");
  });

  it("does not mix up users whose ids share a prefix", () => {
    const storage = new MemoryStorage();
    const al = { server: SERVER, userId: "user-al" };
    seed(storage, alice, plan("a", "A"), 1, 1000);

    expect(readDraftBackups(storage, al)).toEqual([]);
    expect(
      removeAllDraftBackups(storage, al, new Set(["draft-project-a"])),
    ).toBe(0);
    expect(readDraftBackups(storage, alice)).toHaveLength(1);
  });

  it("skips unreadable entries without deleting them", () => {
    const storage = new MemoryStorage();
    seed(storage, alice, plan("a", "A"), 1, 1000);
    const [key] = storage.entries.keys();
    const broken = key!.replace("project-a", "project-x");
    storage.setItem(broken, "{not json");
    storage.setItem(
      key!.replace("project-a", "project-y"),
      JSON.stringify({ projectId: "project-y", project: {}, savedAt: 1 }),
    );

    expect(ids(readDraftBackups(storage, alice))).toEqual(["project-a"]);
    expect(storage.getItem(broken)).toBe("{not json");
  });

  it("reports a refused write so the draft is known to be memory-only", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(seed(storage, alice, plan("a", "A"), 1, 1000)).toBe("failed");
    expect(
      writeDraftBackup(null, alice, plan("a", "A"), 1, 1000, {
        token: "t",
        rev: 1,
      }),
    ).toBe("failed");
    expect(readDraftBackups(null, alice)).toEqual([]);
  });
});

describe("draftBackupStatus", () => {
  const storage = new MemoryStorage();
  seed(storage, alice, plan("a", "A"), 1, 2000);
  seed(storage, alice, plan("b", "B"), 1, 1000);
  const backups = readDraftBackups(storage, alice);

  it("offers every backup except the open unsaved draft's own", () => {
    const status = draftBackupStatus({
      backups,
      openDraftToken: "draft-project-a",
      draftOpen: true,
      signedIn: true,
    });
    expect(ids(status.restorable)).toEqual(["project-b"]);
    expect(status.hasPendingDrafts).toBe(true);
  });

  it("keeps offering a foreign backup of the plan being edited", () => {
    const status = draftBackupStatus({
      backups,
      openDraftToken: "a-newer-draft-of-project-a",
      draftOpen: true,
      signedIn: true,
    });
    expect(ids(status.restorable)).toEqual(["project-a", "project-b"]);
  });

  it("offers a backup no open draft mirrors, e.g. a failed .rob import", () => {
    const status = draftBackupStatus({
      backups,
      openDraftToken: "draft-project-a",
      draftOpen: false,
      signedIn: true,
    });
    expect(ids(status.restorable)).toEqual(["project-a", "project-b"]);
    // Nothing is dirty, but sign-out would still discard the backups.
    expect(status.hasPendingDrafts).toBe(true);
  });

  it("offers nothing while signed out and has nothing pending without drafts", () => {
    expect(
      draftBackupStatus({
        backups,
        openDraftToken: null,
        draftOpen: false,
        signedIn: false,
      }).restorable,
    ).toEqual([]);
    expect(
      draftBackupStatus({
        backups: [],
        openDraftToken: null,
        draftOpen: false,
        signedIn: true,
      }),
    ).toEqual({ restorable: [], hasPendingDrafts: false });
  });
});

describe("saveFailureReason", () => {
  const failure = (kind: ConstructorParameters<typeof ServerStorageError>[0]) =>
    new ServerStorageError(kind, "put", "projects", null);

  it("keeps the draft pending when the server is unreachable or the session expired", () => {
    expect(saveFailureReason(failure("network"))).toBe("network");
    expect(saveFailureReason(failure("unauthenticated"))).toBe("session");
  });

  it("does not treat other failures as pending", () => {
    expect(saveFailureReason(failure("forbidden"))).toBeNull();
    expect(saveFailureReason(failure("server"))).toBeNull();
    expect(saveFailureReason(new Error("invalid plan"))).toBeNull();
  });
});
