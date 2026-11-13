import { z } from "zod";
import {
  PROJECT_RESOURCES_STORE_NAME,
  PROJECTS_STORE_NAME,
  type PlannerStoreName,
} from "~/lib/plannerDatabase";
import {
  recordId,
  RecordVersionConflictError,
  type PlannerRecordStorage,
  type RecordVersion,
  type RecordWriteOptions,
  type VersionedRecord,
} from "~/lib/plannerRecordStorage";

/**
 * Stores the records API (`/api/records/:store[/:id]`, #31) serves. The other
 * client stores hold local legacy and maintenance data that the server never
 * keeps: reading them yields nothing, writing them is rejected.
 */
export const SERVER_STORE_NAMES: readonly PlannerStoreName[] = [
  PROJECTS_STORE_NAME,
  PROJECT_RESOURCES_STORE_NAME,
];

export type ServerStorageErrorKind =
  /**
   * No or expired session (401), or the session now belongs to another
   * account than the write expected (403 `actor_mismatch`, e.g. a sign-in in
   * another tab). Sign in again; the draft stays local.
   */
  | "unauthenticated"
  /** The session user may not change this record (403). */
  | "forbidden"
  /** The request never got an HTTP answer (offline, DNS, refused, aborted). */
  | "network"
  /** A write to a store the server does not keep. */
  | "unsupported-store"
  /** Any other failure: unexpected status or response body. */
  | "server";

/**
 * A server storage call failed for a reason other than a version conflict
 * (those reject with `RecordVersionConflictError`). Never a reason to switch
 * to IndexedDB (ADR 0002): callers keep the draft and report the error.
 */
export class ServerStorageError extends Error {
  constructor(
    readonly kind: ServerStorageErrorKind,
    readonly operation: keyof PlannerRecordStorage,
    readonly storeName: PlannerStoreName,
    /** HTTP status, or `null` when there was no HTTP answer. */
    readonly status: number | null,
    /** The API's `error` code, when the answer carried one. */
    readonly errorCode: string | null = null,
    options?: { cause?: unknown },
  ) {
    super(
      `Server storage ${operation} on "${storeName}" failed: ${kind}${
        status === null
          ? ""
          : ` (HTTP ${status}${errorCode ? `, ${errorCode}` : ""})`
      }.`,
      options,
    );
    this.name = "ServerStorageError";
  }
}

export type ServerPlannerRecordStorageOptions = {
  /** Origin of the app; default `""` (same origin as the page). */
  baseUrl?: string;
  /** Default: `globalThis.fetch`, looked up per call. */
  fetch?: typeof fetch;
};

const apiRecordSchema = z.object({
  record: z.record(z.string(), z.unknown()),
  version: z.number().int().positive(),
  /**
   * Absent for anonymous readers (and in answers of older servers): unknown.
   * Signed-in readers see their own id or, as admins, any creator's;
   * otherwise `null` (not theirs).
   */
  createdBy: z.string().nullable().optional(),
});
const listSchema = z.object({ records: z.array(apiRecordSchema) });
const conflictSchema = z.object({
  error: z.literal("version_conflict"),
  currentVersion: z.number().int().positive().nullable(),
});
const errorSchema = z.object({ error: z.string() });

type Request = {
  operation: keyof PlannerRecordStorage;
  storeName: PlannerStoreName;
  method: "GET" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
};

/**
 * `PlannerRecordStorage` backed by the LAN server's records API (ADR 0002,
 * 0004, 0006). Sends the session cookie of the page's origin.
 *
 * The API has no unconditional write: a put or delete without
 * `expectedVersion` first reads the current version and then writes against
 * it, so a write racing in between rejects with a conflict instead of being
 * overwritten. 409 becomes `RecordVersionConflictError`; every other failure
 * a {@link ServerStorageError}. It never falls back to IndexedDB.
 *
 * Server tombstones keep versions increasing across delete/recreate, while
 * reads still report deleted records as missing (ADR 0011).
 */
export class ServerPlannerRecordStorage implements PlannerRecordStorage {
  readonly supportsLocalMaintenance = false;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch | undefined;
  /** Last creator seen per store and record id (`null`: none recorded). */
  private readonly creators = new Map<string, string | null>();

  constructor(options: ServerPlannerRecordStorageOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "").replace(/\/+$/, "");
    this.fetchImpl = options.fetch;
  }

  async list(storeName: PlannerStoreName): Promise<unknown[]> {
    if (!isServerStore(storeName)) return [];
    const response = await this.send({
      operation: "list",
      storeName,
      method: "GET",
      path: storePath(storeName),
    });
    if (response.status !== 200) {
      throw await failure(response, "list", storeName);
    }
    const body = await parseBody(response, listSchema, "list", storeName);
    this.forgetCreators(storeName);
    for (const entry of body.records) this.rememberCreator(storeName, entry);
    return body.records.map(({ record }) => record);
  }

  /**
   * The id of the user who created the record, as last seen by a list, read
   * or write of this client: `null` when it is not the signed-in reader's
   * (another account, or the creator was deleted; admins see every id),
   * `undefined` when unknown (not seen, or read anonymously). A hint for the
   * UI only; the server enforces write access.
   */
  createdBy(
    storeName: PlannerStoreName,
    id: string,
  ): string | null | undefined {
    return this.creators.get(creatorKey(storeName, id));
  }

  async get(storeName: PlannerStoreName, id: string): Promise<unknown> {
    return (await this.read("get", storeName, id))?.record;
  }

  getVersioned(
    storeName: PlannerStoreName,
    id: string,
  ): Promise<VersionedRecord | undefined> {
    return this.read("getVersioned", storeName, id);
  }

  async put(
    storeName: PlannerStoreName,
    record: unknown,
    options?: RecordWriteOptions,
  ): Promise<RecordVersion> {
    const id = recordId(record);
    if (!id) throw new Error(`Record for "${storeName}" is missing an id.`);
    if (!isServerStore(storeName)) {
      throw new ServerStorageError("unsupported-store", "put", storeName, null);
    }
    const expectedVersion =
      options?.expectedVersion !== undefined
        ? options.expectedVersion
        : ((await this.read("put", storeName, id))?.version ?? null);
    const response = await this.send({
      operation: "put",
      storeName,
      method: "PUT",
      path: recordPath(storeName, id),
      body:
        options?.expectedActorId === undefined
          ? { record, expectedVersion }
          : {
              record,
              expectedVersion,
              expectedActorId: options.expectedActorId,
            },
    });
    if (response.status === 409) {
      throw await conflict(response, "put", storeName, id, expectedVersion);
    }
    if (response.status !== 200 && response.status !== 201) {
      throw await failure(response, "put", storeName);
    }
    const body = await parseBody(response, apiRecordSchema, "put", storeName);
    this.rememberCreator(storeName, body);
    return body.version;
  }

  async delete(
    storeName: PlannerStoreName,
    id: string,
    options?: RecordWriteOptions,
  ): Promise<void> {
    if (!isServerStore(storeName)) {
      throw new ServerStorageError(
        "unsupported-store",
        "delete",
        storeName,
        null,
      );
    }
    const requested = options?.expectedVersion;
    let expectedVersion: RecordVersion;
    if (typeof requested === "number") {
      expectedVersion = requested;
    } else {
      // The API deletes only at a known version; `null` and an omitted
      // version are checked against the current one here.
      const current = (await this.read("delete", storeName, id))?.version;
      if (current === undefined) return;
      if (requested === null) {
        throw new RecordVersionConflictError(storeName, id, null, current);
      }
      expectedVersion = current;
    }
    const response = await this.send({
      operation: "delete",
      storeName,
      method: "DELETE",
      path: `${recordPath(storeName, id)}?expectedVersion=${expectedVersion}`,
    });
    if (response.status === 204) {
      this.creators.delete(creatorKey(storeName, id));
      return;
    }
    if (response.status === 409) {
      const error = await conflict(
        response,
        "delete",
        storeName,
        id,
        expectedVersion,
      );
      // An unconditional delete of a record that is already gone is done.
      if (requested === undefined && error.actualVersion === null) return;
      throw error;
    }
    throw await failure(response, "delete", storeName);
  }

  private async read(
    operation: keyof PlannerRecordStorage,
    storeName: PlannerStoreName,
    id: string,
  ): Promise<VersionedRecord | undefined> {
    if (!isServerStore(storeName)) return undefined;
    const response = await this.send({
      operation,
      storeName,
      method: "GET",
      path: recordPath(storeName, id),
    });
    if (response.status === 404) {
      const code = await errorCodeOf(response.clone());
      if (code === "record_not_found") {
        this.creators.delete(creatorKey(storeName, id));
        return undefined;
      }
      throw await failure(response, operation, storeName);
    }
    if (response.status !== 200) {
      throw await failure(response, operation, storeName);
    }
    const body = await parseBody(
      response,
      apiRecordSchema,
      operation,
      storeName,
    );
    this.rememberCreator(storeName, body);
    return { record: body.record, version: body.version };
  }

  private rememberCreator(
    storeName: PlannerStoreName,
    entry: z.infer<typeof apiRecordSchema>,
  ): void {
    const id = recordId(entry.record);
    if (!id || entry.createdBy === undefined) return;
    this.creators.set(creatorKey(storeName, id), entry.createdBy);
  }

  private forgetCreators(storeName: PlannerStoreName): void {
    const prefix = creatorKey(storeName, "");
    for (const key of [...this.creators.keys()]) {
      if (key.startsWith(prefix)) this.creators.delete(key);
    }
  }

  private async send(request: Request): Promise<Response> {
    const fetchImpl = this.fetchImpl ?? globalThis.fetch;
    const headers: Record<string, string> = { accept: "application/json" };
    if (request.body !== undefined) {
      headers["content-type"] = "application/json";
    }
    try {
      return await fetchImpl(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        body:
          request.body === undefined ? undefined : JSON.stringify(request.body),
      });
    } catch (cause) {
      throw new ServerStorageError(
        "network",
        request.operation,
        request.storeName,
        null,
        null,
        { cause },
      );
    }
  }
}

/** The server refused a creation past the user's live-project quota. */
export function isServerQuotaExceeded(error: unknown): boolean {
  return (
    error instanceof ServerStorageError &&
    error.status === 403 &&
    error.errorCode === "quota_exceeded"
  );
}

function creatorKey(storeName: PlannerStoreName, id: string): string {
  return `${storeName}\u0000${id}`;
}

function isServerStore(storeName: PlannerStoreName): boolean {
  return SERVER_STORE_NAMES.includes(storeName);
}

function storePath(storeName: PlannerStoreName): string {
  return `/api/records/${encodeURIComponent(storeName)}`;
}

function recordPath(storeName: PlannerStoreName, id: string): string {
  return `${storePath(storeName)}/${encodeURIComponent(id)}`;
}

async function errorCodeOf(response: Response): Promise<string | null> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error : null;
  } catch {
    return null;
  }
}

async function failure(
  response: Response,
  operation: keyof PlannerRecordStorage,
  storeName: PlannerStoreName,
): Promise<ServerStorageError> {
  const errorCode = await errorCodeOf(response);
  const kind: ServerStorageErrorKind =
    response.status === 401 ||
    (response.status === 403 && errorCode === "actor_mismatch")
      ? "unauthenticated"
      : response.status === 403
        ? "forbidden"
        : "server";
  return new ServerStorageError(
    kind,
    operation,
    storeName,
    response.status,
    errorCode,
  );
}

async function conflict(
  response: Response,
  operation: keyof PlannerRecordStorage,
  storeName: PlannerStoreName,
  id: string,
  expectedVersion: RecordVersion | null,
): Promise<RecordVersionConflictError> {
  const body = await parseBody(response, conflictSchema, operation, storeName);
  return new RecordVersionConflictError(
    storeName,
    id,
    expectedVersion,
    body.currentVersion,
  );
}

async function parseBody<T>(
  response: Response,
  schema: z.ZodType<T>,
  operation: keyof PlannerRecordStorage,
  storeName: PlannerStoreName,
): Promise<T> {
  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    throw new ServerStorageError(
      "server",
      operation,
      storeName,
      response.status,
      null,
      { cause },
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ServerStorageError(
      "server",
      operation,
      storeName,
      response.status,
      errorSchema.safeParse(json).data?.error ?? null,
      { cause: parsed.error },
    );
  }
  return parsed.data;
}
