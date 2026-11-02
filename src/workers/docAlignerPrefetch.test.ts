import { describe, expect, it } from "vitest";
import {
  PREFETCH_FALLBACK_DELAY_MS,
  PREFETCH_IDLE_TIMEOUT_MS,
  shouldPrefetchDocAligner,
  whenIdleAfterLoad,
  type IdleScheduler,
} from "~/workers/docAlignerPrefetch";

const capable = {
  Worker: class {},
  OffscreenCanvas: class {},
  createImageBitmap: () => undefined,
};

describe("shouldPrefetchDocAligner", () => {
  it("prefetches on capable browsers with a normal connection", () => {
    expect(shouldPrefetchDocAligner(capable)).toBe(true);
    expect(
      shouldPrefetchDocAligner({
        ...capable,
        navigator: { connection: { effectiveType: "3g" } },
      }),
    ).toBe(true);
  });

  it("skips Save-Data and 2G connections", () => {
    for (const connection of [
      { saveData: true, effectiveType: "4g" },
      { effectiveType: "2g" },
      { effectiveType: "slow-2g" },
    ]) {
      expect(
        shouldPrefetchDocAligner({ ...capable, navigator: { connection } }),
      ).toBe(false);
    }
  });

  it("skips browsers that could not run the model anyway", () => {
    expect(shouldPrefetchDocAligner({ ...capable, Worker: undefined })).toBe(
      false,
    );
    expect(
      shouldPrefetchDocAligner({ ...capable, OffscreenCanvas: undefined }),
    ).toBe(false);
  });
});

/** Scheduler whose load event, idle callbacks and timers run on demand. */
function fakeScheduler(
  readyState: string,
  idle: boolean,
): IdleScheduler & {
  fireLoad: () => void;
  flush: () => void;
  waits: string[];
} {
  let loadListener: (() => void) | null = null;
  const queued = new Map<number, () => void>();
  let next = 1;
  const waits: string[] = [];
  const queue = (callback: () => void, label: string) => {
    waits.push(label);
    queued.set(next, callback);
    return next++;
  };
  return {
    document: { readyState },
    addEventListener: (_type, listener) => {
      loadListener = listener;
    },
    removeEventListener: (_type, listener) => {
      if (loadListener === listener) loadListener = null;
    },
    requestIdleCallback: idle
      ? (callback, { timeout }) => queue(callback, `idle ${timeout}`)
      : undefined,
    cancelIdleCallback: (handle) => queued.delete(handle),
    setTimeout: (callback, ms) => queue(callback, `timeout ${ms}`),
    clearTimeout: (handle) => queued.delete(handle),
    fireLoad: () => loadListener?.(),
    flush: () => {
      for (const [handle, callback] of [...queued]) {
        queued.delete(handle);
        callback();
      }
    },
    waits,
  };
}

describe("whenIdleAfterLoad", () => {
  it("waits for an idle moment on a loaded page", () => {
    const scope = fakeScheduler("complete", true);
    let runs = 0;
    whenIdleAfterLoad(scope, () => runs++);
    expect([runs, scope.waits]).toEqual([
      0,
      [`idle ${PREFETCH_IDLE_TIMEOUT_MS}`],
    ]);
    scope.flush();
    expect(runs).toBe(1);
  });

  it("waits for the load event first", () => {
    const scope = fakeScheduler("interactive", true);
    let runs = 0;
    whenIdleAfterLoad(scope, () => runs++);
    scope.flush();
    expect([runs, scope.waits]).toEqual([0, []]);
    scope.fireLoad();
    scope.flush();
    expect(runs).toBe(1);
  });

  it("uses a delay where requestIdleCallback is missing (Safari)", () => {
    const scope = fakeScheduler("complete", false);
    let runs = 0;
    whenIdleAfterLoad(scope, () => runs++);
    expect(scope.waits).toEqual([`timeout ${PREFETCH_FALLBACK_DELAY_MS}`]);
    scope.flush();
    expect(runs).toBe(1);
  });

  it("never runs once cancelled, before or after load", () => {
    for (const readyState of ["loading", "complete"]) {
      const scope = fakeScheduler(readyState, true);
      let runs = 0;
      const cancel = whenIdleAfterLoad(scope, () => runs++);
      cancel();
      scope.fireLoad();
      scope.flush();
      expect(runs).toBe(0);
    }
  });
});
