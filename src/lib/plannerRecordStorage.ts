import {
  PLANNER_DATABASE_NAME,
  PLANNER_STORE_NAMES,
  type PlannerDatabaseStoreName,
  RECORD_VERSIONS_STORE_NAME,
  recordVersionKey,
  requestToPromise,
  runPlannerTransaction,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";

/**
 * Monotonic per-record version (ADR 0006). The first write of an id yields 1;
 * every later put increments it. Versions survive deletes as tombstones, so a
 * record recreated after a delete never reuses a version a stale client might
 * still hold. Records written before versioning existed count as version 1.
 */
export type RecordVersion = number;

export type RecordWriteOptions = {
  /**
   * Omitted: unconditional write (local mode, today's behaviour).
   * `null`: the record must not exist yet.
   * A number: the record must exist with exactly that version.
   */
  expectedVersion?: RecordVersion | null;
};

export type VersionedRecord = {
  record: unknown;
  version: RecordVersion;
};

/**
 * Record-level persistence behind `ProjectRepository`. Which implementation is
 * used in the app is decided once by `createPlannerRecordStorage()` in
 * `plannerStorageFactory.ts`; tests inject `MemoryPlannerRecordStorage`.
 */
export interface PlannerRecordStorage {
  /** Reads may persist schema upgrades, quarantine rows and migrate legacy data. */
  readonly supportsLocalMaintenance: boolean;
  /** Last known server creator; absent on browser-only stores. */
  createdBy?(
    storeName: PlannerStoreName,
    id: string,
  ): string | null | undefined;
  list(storeName: PlannerStoreName): Promise<unknown[]>;
  get(storeName: PlannerStoreName, id: string): Promise<unknown>;
  /** Record and its current version, read together; `undefined` when missing. */
  getVersioned(
    storeName: PlannerStoreName,
    id: string,
  ): Promise<VersionedRecord | undefined>;
  /** Resolves with the record's new version. */
  put(
    storeName: PlannerStoreName,
    record: unknown,
    options?: RecordWriteOptions,
  ): Promise<RecordVersion>;
  delete(
    storeName: PlannerStoreName,
    id: string,
    options?: RecordWriteOptions,
  ): Promise<void>;
}

/**
 * The stored record's version differs from the caller's expected version.
 * Distinct from `ProjectConflictError`, which reports duplicate ids.
 */
export class RecordVersionConflictError extends Error {
  constructor(
    readonly storeName: PlannerStoreName,
    readonly id: string,
    readonly expectedVersion: RecordVersion | null,
    /** `null` when the record does not exist. */
    readonly actualVersion: RecordVersion | null,
  ) {
    super(
      `Record "${id}" in "${storeName}" is at version ${
        actualVersion ?? "none"
      }, expected ${expectedVersion ?? "none"}.`,
    );
    this.name = "RecordVersionConflictError";
  }
}

/** Version of a stored record, given whether it exists and its metadata. */
function currentRecordVersion(
  exists: boolean,
  storedVersion: RecordVersion | undefined,
): RecordVersion | null {
  return exists ? (storedVersion ?? 1) : null;
}

function assertExpectedVersion(
  storeName: PlannerStoreName,
  id: string,
  options: RecordWriteOptions | undefined,
  current: RecordVersion | null,
): void {
  const expected = options?.expectedVersion;
  if (expected === undefined || expected === current) return;
  throw new RecordVersionConflictError(storeName, id, expected, current);
}

function nextRecordVersion(
  current: RecordVersion | null,
  storedVersion: RecordVersion | undefined,
): RecordVersion {
  return (current ?? storedVersion ?? 0) + 1;
}

function requireRecordId(storeName: PlannerStoreName, value: unknown): string {
  const id = recordId(value);
  if (!id) throw new Error(`Record for "${storeName}" is missing an id.`);
  return id;
}

export function recordId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

type RecordVersionRow = { id: string; version: RecordVersion };

function storedVersionOf(row: unknown): RecordVersion | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const version = (row as { version?: unknown }).version;
  return typeof version === "number" ? version : undefined;
}

export class IndexedDbPlannerRecordStorage implements PlannerRecordStorage {
  readonly supportsLocalMaintenance = true;

  constructor(
    protected readonly indexedDb: IDBFactory = globalThis.indexedDB,
    protected readonly databaseName: string = PLANNER_DATABASE_NAME,
  ) {}

  protected writeStores(
    storeName: PlannerStoreName,
  ): PlannerDatabaseStoreName[] {
    return [storeName, RECORD_VERSIONS_STORE_NAME];
  }

  protected async afterWrite(
    _transaction: IDBTransaction,
    _storeName: PlannerStoreName,
    _id: string,
    _deleted: boolean,
  ): Promise<void> {}

  list(storeName: PlannerStoreName): Promise<unknown[]> {
    return runPlannerTransaction(
      storeName,
      "readonly",
      (transaction) =>
        requestToPromise(transaction.objectStore(storeName).getAll()),
      this.indexedDb,
      this.databaseName,
    );
  }

  get(storeName: PlannerStoreName, id: string): Promise<unknown> {
    return runPlannerTransaction(
      storeName,
      "readonly",
      (transaction) =>
        requestToPromise(transaction.objectStore(storeName).get(id)),
      this.indexedDb,
      this.databaseName,
    );
  }

  getVersioned(
    storeName: PlannerStoreName,
    id: string,
  ): Promise<VersionedRecord | undefined> {
    return runPlannerTransaction(
      [storeName, RECORD_VERSIONS_STORE_NAME],
      "readonly",
      async (transaction) => {
        const [record, versionRow] = await Promise.all([
          requestToPromise<unknown>(transaction.objectStore(storeName).get(id)),
          requestToPromise<unknown>(
            transaction
              .objectStore(RECORD_VERSIONS_STORE_NAME)
              .get(recordVersionKey(storeName, id)),
          ),
        ]);
        if (record === undefined) return undefined;
        return { record, version: storedVersionOf(versionRow) ?? 1 };
      },
      this.indexedDb,
      this.databaseName,
    );
  }

  async put(
    storeName: PlannerStoreName,
    record: unknown,
    options?: RecordWriteOptions,
  ): Promise<RecordVersion> {
    const id = requireRecordId(storeName, record);
    return runPlannerTransaction(
      this.writeStores(storeName),
      "readwrite",
      async (transaction) => {
        const records = transaction.objectStore(storeName);
        const versions = transaction.objectStore(RECORD_VERSIONS_STORE_NAME);
        const key = recordVersionKey(storeName, id);
        // Check and write share one readwrite transaction, so the expected
        // version comparison is atomic with the write (ADR 0006).
        const [count, versionRow] = await Promise.all([
          requestToPromise(records.count(id)),
          requestToPromise<unknown>(versions.get(key)),
        ]);
        const stored = storedVersionOf(versionRow);
        const current = currentRecordVersion(count > 0, stored);
        assertExpectedVersion(storeName, id, options, current);
        const version = nextRecordVersion(current, stored);
        records.put(record);
        versions.put({ id: key, version } satisfies RecordVersionRow);
        await this.afterWrite(transaction, storeName, id, false);
        return version;
      },
      this.indexedDb,
      this.databaseName,
    );
  }

  async delete(
    storeName: PlannerStoreName,
    id: string,
    options?: RecordWriteOptions,
  ): Promise<void> {
    await runPlannerTransaction(
      this.writeStores(storeName),
      "readwrite",
      async (transaction) => {
        const records = transaction.objectStore(storeName);
        const versions = transaction.objectStore(RECORD_VERSIONS_STORE_NAME);
        const key = recordVersionKey(storeName, id);
        const [count, versionRow] = await Promise.all([
          requestToPromise(records.count(id)),
          requestToPromise<unknown>(versions.get(key)),
        ]);
        const current = currentRecordVersion(
          count > 0,
          storedVersionOf(versionRow),
        );
        assertExpectedVersion(storeName, id, options, current);
        if (current === null) return;
        records.delete(id);
        await this.afterWrite(transaction, storeName, id, true);
        // Keep the last version as a tombstone so a recreated record continues
        // counting instead of reusing versions.
        versions.put({ id: key, version: current } satisfies RecordVersionRow);
      },
      this.indexedDb,
      this.databaseName,
    );
  }
}

function cloneValue<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export class MemoryPlannerRecordStorage implements PlannerRecordStorage {
  readonly supportsLocalMaintenance = true;
  private readonly stores = new Map<PlannerStoreName, Map<string, unknown>>();
  /** Explicit versions and tombstones; records without an entry are version 1. */
  private readonly versions = new Map<string, RecordVersion>();

  constructor(
    initial: Partial<Record<PlannerStoreName, readonly unknown[]>> = {},
  ) {
    PLANNER_STORE_NAMES.forEach((name) => {
      const records = new Map<string, unknown>();
      for (const value of initial[name] ?? []) {
        const id = recordId(value);
        if (!id) {
          throw new Error(`Memory store "${name}" record is missing an id.`);
        }
        records.set(id, cloneValue(value));
      }
      this.stores.set(name, records);
    });
  }

  async list(storeName: PlannerStoreName): Promise<unknown[]> {
    return [...this.store(storeName).values()].map(cloneValue);
  }

  async get(storeName: PlannerStoreName, id: string): Promise<unknown> {
    const value = this.store(storeName).get(id);
    return value === undefined ? undefined : cloneValue(value);
  }

  async getVersioned(
    storeName: PlannerStoreName,
    id: string,
  ): Promise<VersionedRecord | undefined> {
    const value = this.store(storeName).get(id);
    if (value === undefined) return undefined;
    return {
      record: cloneValue(value),
      version: this.versions.get(recordVersionKey(storeName, id)) ?? 1,
    };
  }

  async put(
    storeName: PlannerStoreName,
    value: unknown,
    options?: RecordWriteOptions,
  ): Promise<RecordVersion> {
    const id = requireRecordId(storeName, value);
    const store = this.store(storeName);
    const key = recordVersionKey(storeName, id);
    const stored = this.versions.get(key);
    const current = currentRecordVersion(store.has(id), stored);
    assertExpectedVersion(storeName, id, options, current);
    const version = nextRecordVersion(current, stored);
    store.set(id, cloneValue(value));
    this.versions.set(key, version);
    return version;
  }

  async delete(
    storeName: PlannerStoreName,
    id: string,
    options?: RecordWriteOptions,
  ): Promise<void> {
    const store = this.store(storeName);
    const key = recordVersionKey(storeName, id);
    const current = currentRecordVersion(store.has(id), this.versions.get(key));
    assertExpectedVersion(storeName, id, options, current);
    if (current === null) return;
    store.delete(id);
    this.versions.set(key, current);
  }

  private store(storeName: PlannerStoreName): Map<string, unknown> {
    const store = this.stores.get(storeName);
    if (!store) throw new Error(`Unknown memory store "${storeName}".`);
    return store;
  }
}
