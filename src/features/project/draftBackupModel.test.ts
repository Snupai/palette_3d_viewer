import { describe, expect, it } from "vitest";

import { createProject } from "~/domain/project/projectFactory";
import type { Project } from "~/domain/project/projectSchema";
import { ServerStorageError } from "~/lib/serverPlannerRecordStorage";

import {
  draftBackupScope,
  draftBaseVersion,
  readDraftBackups,
  removeAllDraftBackups,
  removeDraftBackup,
  draftBackupStatus,
  saveFailureReason,
  writeDraftBackup,
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

    expect(writeDraftBackup(storage, alice, draft, 4, 1000)).toBe(true);
    // A newer draft of the same plan replaces the backup.
    const newer = { ...draft, productNumber: "Draft A2" };
    writeDraftBackup(storage, alice, newer, 4, 2000);

    expect(readDraftBackups(storage, alice)).toEqual([
      { projectId: "project-a", project: newer, baseVersion: 4, savedAt: 2000 },
    ]);
    expect(readDraftBackups(storage, bob)).toEqual([]);
    expect(readDraftBackups(storage, aliceElsewhere)).toEqual([]);
  });

  it("lists the newest backup first and removes one after a save", () => {
    const storage = new MemoryStorage();
    writeDraftBackup(storage, alice, plan("a", "A"), 1, 1000);
    writeDraftBackup(storage, alice, plan("b", "B"), null, 3000);
    writeDraftBackup(storage, alice, plan("c", "C"), 2, 2000);

    expect(
      readDraftBackups(storage, alice).map(({ projectId }) => projectId),
    ).toEqual(["project-b", "project-c", "project-a"]);

    removeDraftBackup(storage, alice, "project-c");
    expect(
      readDraftBackups(storage, alice).map(({ projectId }) => projectId),
    ).toEqual(["project-b", "project-a"]);
  });

  it("sign-out removes all of that user's backups on that server only", () => {
    const storage = new MemoryStorage();
    writeDraftBackup(storage, alice, plan("a", "A"), 1, 1000);
    writeDraftBackup(storage, alice, plan("b", "B"), 1, 1000);
    writeDraftBackup(storage, bob, plan("a", "A"), 1, 1000);
    writeDraftBackup(storage, aliceElsewhere, plan("a", "A"), 1, 1000);
    storage.setItem("saved_pallets_v1", "[]");

    expect(removeAllDraftBackups(storage, alice)).toBe(2);
    expect(readDraftBackups(storage, alice)).toEqual([]);
    expect(readDraftBackups(storage, bob)).toHaveLength(1);
    expect(readDraftBackups(storage, aliceElsewhere)).toHaveLength(1);
    expect(storage.getItem("saved_pallets_v1")).toBe("[]");
  });

  it("does not mix up users whose ids share a prefix", () => {
    const storage = new MemoryStorage();
    const al = { server: SERVER, userId: "user-al" };
    writeDraftBackup(storage, alice, plan("a", "A"), 1, 1000);

    expect(readDraftBackups(storage, al)).toEqual([]);
    expect(removeAllDraftBackups(storage, al)).toBe(0);
    expect(readDraftBackups(storage, alice)).toHaveLength(1);
  });

  it("skips unreadable entries without deleting them", () => {
    const storage = new MemoryStorage();
    writeDraftBackup(storage, alice, plan("a", "A"), 1, 1000);
    const [key] = storage.entries.keys();
    const broken = key!.replace("project-a", "project-x");
    storage.setItem(broken, "{not json");
    storage.setItem(
      key!.replace("project-a", "project-y"),
      JSON.stringify({ projectId: "project-y", project: {}, savedAt: 1 }),
    );

    expect(
      readDraftBackups(storage, alice).map(({ projectId }) => projectId),
    ).toEqual(["project-a"]);
    expect(storage.getItem(broken)).toBe("{not json");
  });

  it("reports a refused write so the draft is known to be memory-only", () => {
    const storage = new MemoryStorage();
    storage.failWrites = true;
    expect(writeDraftBackup(storage, alice, plan("a", "A"), 1, 1000)).toBe(
      false,
    );
    expect(writeDraftBackup(null, alice, plan("a", "A"), 1, 1000)).toBe(false);
    expect(readDraftBackups(null, alice)).toEqual([]);
  });
});

describe("draftBackupStatus", () => {
  const storage = new MemoryStorage();
  writeDraftBackup(storage, alice, plan("a", "A"), 1, 2000);
  writeDraftBackup(storage, alice, plan("b", "B"), 1, 1000);
  const backups = readDraftBackups(storage, alice);
  const ids = (list: readonly { projectId: string }[]) =>
    list.map(({ projectId }) => projectId);

  it("offers every backup except the draft still open and unsaved here", () => {
    const status = draftBackupStatus({
      backups,
      openDraftProjectId: "project-a",
      draftOpen: true,
      signedIn: true,
    });
    expect(ids(status.restorable)).toEqual(["project-b"]);
    expect(status.hasPendingDrafts).toBe(true);
  });

  it("offers a backup no open draft mirrors, e.g. a failed .rob import", () => {
    const status = draftBackupStatus({
      backups,
      openDraftProjectId: "project-a",
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
        openDraftProjectId: null,
        draftOpen: false,
        signedIn: false,
      }).restorable,
    ).toEqual([]);
    expect(
      draftBackupStatus({
        backups: [],
        openDraftProjectId: null,
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
