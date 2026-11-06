import {
  BROWSER_PLAN_METADATA_STORE_NAME,
  BROWSER_PLANNER_DATABASE_NAME,
  PROJECTS_STORE_NAME,
  RECORD_VERSIONS_STORE_NAME,
  recordVersionKey,
  requestToPromise,
  runPlannerTransaction,
  type PlannerDatabaseStoreName,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";
import {
  IndexedDbPlannerRecordStorage,
  type RecordVersion,
} from "~/lib/plannerRecordStorage";

/** A publication link belongs to exactly one server origin and account. */
export type BrowserPlanSyncLink = {
  server: string;
  userId: string;
  serverId: string;
  syncedVersion: RecordVersion;
  syncedContentHash: string;
  /** Epoch milliseconds. */
  syncedAt: number;
};

export type BrowserPlanMetadata = {
  /** Local project id. Metadata never changes the project payload. */
  id: string;
  origin: "browser-local";
  /** Epoch milliseconds of the first local write. */
  createdAt: number;
  links: BrowserPlanSyncLink[];
};

/**
 * Browser plans in server mode (ADR 0010). Construct via plannerStorageFactory.
 * This store never uploads anything and is separate from legacy local data.
 * Publication consent and retention decisions belong to the sync model.
 */
export class BrowserLocalPlannerStorage extends IndexedDbPlannerRecordStorage {
  constructor(
    indexedDb: IDBFactory = globalThis.indexedDB,
    private readonly now: () => number = Date.now,
  ) {
    super(indexedDb, BROWSER_PLANNER_DATABASE_NAME);
  }

  protected override writeStores(
    storeName: PlannerStoreName,
  ): PlannerDatabaseStoreName[] {
    const stores = super.writeStores(storeName);
    if (storeName === PROJECTS_STORE_NAME)
      stores.push(BROWSER_PLAN_METADATA_STORE_NAME);
    return stores;
  }

  protected override async afterWrite(
    transaction: IDBTransaction,
    storeName: PlannerStoreName,
    id: string,
    deleted: boolean,
  ): Promise<void> {
    if (storeName !== PROJECTS_STORE_NAME) return;
    const metadata = transaction.objectStore(BROWSER_PLAN_METADATA_STORE_NAME);
    if (deleted) {
      metadata.delete(id);
    } else if ((await requestToPromise(metadata.count(id))) === 0) {
      metadata.put({
        id,
        origin: "browser-local",
        createdAt: this.now(),
        links: [],
      } satisfies BrowserPlanMetadata);
    }
  }

  listMetadata(): Promise<BrowserPlanMetadata[]> {
    return runPlannerTransaction(
      BROWSER_PLAN_METADATA_STORE_NAME,
      "readonly",
      (transaction) =>
        requestToPromise<BrowserPlanMetadata[]>(
          transaction
            .objectStore(BROWSER_PLAN_METADATA_STORE_NAME)
            .getAll() as IDBRequest<BrowserPlanMetadata[]>,
        ),
      this.indexedDb,
      this.databaseName,
    );
  }

  getMetadata(id: string): Promise<BrowserPlanMetadata | undefined> {
    return runPlannerTransaction(
      BROWSER_PLAN_METADATA_STORE_NAME,
      "readonly",
      (transaction) =>
        requestToPromise<BrowserPlanMetadata | undefined>(
          transaction
            .objectStore(BROWSER_PLAN_METADATA_STORE_NAME)
            .get(id) as IDBRequest<BrowserPlanMetadata | undefined>,
        ),
      this.indexedDb,
      this.databaseName,
    );
  }

  /** Updates one account's link without overwriting links written by other tabs. */
  async setSyncLink(id: string, link: BrowserPlanSyncLink): Promise<void> {
    await runPlannerTransaction(
      BROWSER_PLAN_METADATA_STORE_NAME,
      "readwrite",
      async (transaction) => {
        const store = transaction.objectStore(BROWSER_PLAN_METADATA_STORE_NAME);
        const metadata = await requestToPromise<
          BrowserPlanMetadata | undefined
        >(store.get(id) as IDBRequest<BrowserPlanMetadata | undefined>);
        if (!metadata) throw new Error(`Browser plan "${id}" does not exist.`);
        store.put(withSyncLink(metadata, link));
      },
      this.indexedDb,
      this.databaseName,
    );
  }

  /**
   * Finalizes an accepted publication/whole-plan choice. A concurrent local save
   * keeps its payload; an intentional local deletion wins and is never undone.
   * Link-only rows remain discoverable so server deletion is handled explicitly.
   */
  confirmSync(
    id: string,
    link: BrowserPlanSyncLink,
    expectedLocalVersion: RecordVersion,
  ): Promise<"removed" | "retained"> {
    return runPlannerTransaction(
      [
        PROJECTS_STORE_NAME,
        RECORD_VERSIONS_STORE_NAME,
        BROWSER_PLAN_METADATA_STORE_NAME,
      ],
      "readwrite",
      async (transaction) => {
        const metadataStore = transaction.objectStore(
          BROWSER_PLAN_METADATA_STORE_NAME,
        );
        const projects = transaction.objectStore(PROJECTS_STORE_NAME);
        const versions = transaction.objectStore(RECORD_VERSIONS_STORE_NAME);
        const key = recordVersionKey(PROJECTS_STORE_NAME, id);
        const [metadata, count, version] = await Promise.all([
          requestToPromise<BrowserPlanMetadata | undefined>(
            metadataStore.get(id) as IDBRequest<
              BrowserPlanMetadata | undefined
            >,
          ),
          requestToPromise(projects.count(id)),
          requestToPromise<{ id: string; version: RecordVersion } | undefined>(
            versions.get(key) as IDBRequest<
              { id: string; version: RecordVersion } | undefined
            >,
          ),
        ]);
        if (!metadata) return "retained";
        metadataStore.put(withSyncLink(metadata, link));
        if (!count || (version?.version ?? 1) !== expectedLocalVersion)
          return "retained";
        projects.delete(id);
        // Preserve the version tombstone just like a regular record deletion.
        versions.put({ id: key, version: version?.version ?? 1 });
        return "removed";
      },
      this.indexedDb,
      this.databaseName,
    );
  }

  /** Explicit retention cleanup; does not delete or publish the plan. */
  async deleteMetadata(id: string): Promise<void> {
    await runPlannerTransaction(
      BROWSER_PLAN_METADATA_STORE_NAME,
      "readwrite",
      (transaction) => {
        transaction.objectStore(BROWSER_PLAN_METADATA_STORE_NAME).delete(id);
      },
      this.indexedDb,
      this.databaseName,
    );
  }
}

function withSyncLink(
  metadata: BrowserPlanMetadata,
  link: BrowserPlanSyncLink,
): BrowserPlanMetadata {
  const links = metadata.links.filter(
    (existing) =>
      existing.server !== link.server || existing.userId !== link.userId,
  );
  return { ...metadata, links: [...links, link] };
}
