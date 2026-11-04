// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { describePlannerRecordStorageContract } from "~/lib/plannerRecordStorageContract";
import {
  IndexedDbPlannerRecordStorage,
  MemoryPlannerRecordStorage,
} from "~/lib/projectRepository";

describePlannerRecordStorageContract(() => new MemoryPlannerRecordStorage(), {
  label: "MemoryPlannerRecordStorage",
});

// A new IDBFactory is a separate, empty in-memory IndexedDB per test.
describePlannerRecordStorageContract(
  () => new IndexedDbPlannerRecordStorage(new IDBFactory()),
  { label: "IndexedDbPlannerRecordStorage" },
);
