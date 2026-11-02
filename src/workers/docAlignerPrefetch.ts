/**
 * When to prefetch the DocAligner model: after the page has loaded and the
 * browser is idle, never on Save-Data or very slow connections. Main-thread
 * work is limited to scheduling and starting the worker; the downloads run
 * in the worker at low priority.
 */

type Connection = { saveData?: boolean; effectiveType?: string };

export type PrefetchEnvironment = {
  navigator?: { connection?: Connection };
  Worker?: unknown;
  OffscreenCanvas?: unknown;
  createImageBitmap?: unknown;
};

/** Connections on which ≈ 12 MB in the background would hurt. */
const SLOW_CONNECTIONS = new Set(["slow-2g", "2g"]);

export function shouldPrefetchDocAligner(
  scope: PrefetchEnvironment = globalThis as PrefetchEnvironment,
): boolean {
  if (
    typeof scope.Worker !== "function" ||
    typeof scope.OffscreenCanvas !== "function" ||
    typeof scope.createImageBitmap !== "function"
  ) {
    return false;
  }
  const connection = scope.navigator?.connection;
  if (connection?.saveData) return false;
  if (
    connection?.effectiveType &&
    SLOW_CONNECTIONS.has(connection.effectiveType)
  ) {
    return false;
  }
  return true;
}

export type IdleScheduler = {
  document: { readyState: string };
  addEventListener: (
    type: "load",
    listener: () => void,
    options: { once: true },
  ) => void;
  removeEventListener: (type: "load", listener: () => void) => void;
  requestIdleCallback?: (
    callback: () => void,
    options: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
};

/** Longest wait for an idle moment once the page has loaded. */
export const PREFETCH_IDLE_TIMEOUT_MS = 10_000;
/** Where `requestIdleCallback` is missing (Safari): this long after load. */
export const PREFETCH_FALLBACK_DELAY_MS = 3_000;

/**
 * Runs `task` once the page has loaded and the browser is idle. Returns a
 * cancel function.
 */
export function whenIdleAfterLoad(
  scope: IdleScheduler,
  task: () => void,
): () => void {
  let cancelled = false;
  let cancelWait: (() => void) | null = null;
  const run = () => {
    if (!cancelled) task();
  };
  const afterLoad = () => {
    if (cancelled) return;
    if (scope.requestIdleCallback) {
      const handle = scope.requestIdleCallback(run, {
        timeout: PREFETCH_IDLE_TIMEOUT_MS,
      });
      cancelWait = () => scope.cancelIdleCallback?.(handle);
    } else {
      const handle = scope.setTimeout(run, PREFETCH_FALLBACK_DELAY_MS);
      cancelWait = () => scope.clearTimeout(handle);
    }
  };
  if (scope.document.readyState === "complete") {
    afterLoad();
  } else {
    scope.addEventListener("load", afterLoad, { once: true });
    cancelWait = () => scope.removeEventListener("load", afterLoad);
  }
  return () => {
    cancelled = true;
    cancelWait?.();
  };
}
