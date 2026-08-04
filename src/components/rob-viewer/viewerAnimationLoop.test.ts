import { describe, expect, it, vi } from "vitest";
import {
  createViewerAnimationLoop,
  type CreateViewerIntersectionObserver,
  type ViewerIntersectionObserver,
  type ViewerVisibilityDocument,
} from "~/components/rob-viewer/viewerAnimationLoop";

function createHarness({
  hidden = false,
  useIntersectionObserver = true,
}: {
  hidden?: boolean;
  useIntersectionObserver?: boolean;
} = {}) {
  let documentHidden = hidden;
  const visibilityListeners = new Set<EventListener>();
  const addVisibilityListener = vi.fn(
    (_type: "visibilitychange", listener: EventListener) => {
      visibilityListeners.add(listener);
    },
  );
  const removeVisibilityListener = vi.fn(
    (_type: "visibilitychange", listener: EventListener) => {
      visibilityListeners.delete(listener);
    },
  );
  const visibilityDocument: ViewerVisibilityDocument = {
    get hidden() {
      return documentHidden;
    },
    addEventListener: addVisibilityListener,
    removeEventListener: removeVisibilityListener,
  };

  let nextFrameHandle = 1;
  const pendingFrames = new Map<number, FrameRequestCallback>();
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const handle = nextFrameHandle++;
    pendingFrames.set(handle, callback);
    return handle;
  });
  const cancelFrame = vi.fn((handle: number) => {
    pendingFrames.delete(handle);
  });

  const target = document.createElement("canvas");
  let intersectionCallback: IntersectionObserverCallback | null = null;
  const observeTarget = vi.fn<(target: Element) => void>();
  const disconnectObserver = vi.fn<() => void>();
  const observer: ViewerIntersectionObserver = {
    observe: observeTarget,
    disconnect: disconnectObserver,
  };
  const createIntersectionObserver = vi.fn(
    (callback: IntersectionObserverCallback) => {
      intersectionCallback = callback;
      return observer;
    },
  ) satisfies CreateViewerIntersectionObserver;
  const onFrame = vi.fn<FrameRequestCallback>();
  const loop = createViewerAnimationLoop({
    target,
    onFrame,
    environment: {
      document: visibilityDocument,
      requestAnimationFrame: requestFrame,
      cancelAnimationFrame: cancelFrame,
      createIntersectionObserver: useIntersectionObserver
        ? createIntersectionObserver
        : null,
    },
  });

  const setDocumentHidden = (value: boolean) => {
    documentHidden = value;
    for (const listener of [...visibilityListeners]) {
      listener(new Event("visibilitychange"));
    }
  };

  const setIntersecting = (value: boolean) => {
    if (!intersectionCallback) {
      throw new Error("IntersectionObserver has not been created");
    }
    intersectionCallback(
      [
        {
          target,
          isIntersecting: value,
          intersectionRatio: value ? 1 : 0,
        } as unknown as IntersectionObserverEntry,
      ],
      observer as IntersectionObserver,
    );
  };

  const runNextFrame = (timestamp = 16) => {
    const next = pendingFrames.entries().next().value;
    if (!next) throw new Error("No animation frame is pending");
    const [handle, callback] = next;
    pendingFrames.delete(handle);
    callback(timestamp);
    return { handle, callback };
  };

  return {
    loop,
    onFrame,
    observer,
    disconnectObserver,
    addVisibilityListener,
    removeVisibilityListener,
    createIntersectionObserver,
    pendingFrames,
    requestFrame,
    cancelFrame,
    setDocumentHidden,
    setIntersecting,
    runNextFrame,
  };
}

describe("viewer animation loop", () => {
  it("waits until both the document and viewer are visible", () => {
    const harness = createHarness({ hidden: true });

    harness.loop.start();
    harness.setIntersecting(true);
    expect(harness.pendingFrames.size).toBe(0);

    harness.setDocumentHidden(false);
    expect(harness.pendingFrames.size).toBe(1);

    harness.setDocumentHidden(true);
    expect(harness.pendingFrames.size).toBe(0);
    expect(harness.cancelFrame).toHaveBeenCalledTimes(1);
  });

  it("pauses offscreen and promptly resumes its frame chain", () => {
    const harness = createHarness();

    harness.loop.start();
    expect(harness.pendingFrames.size).toBe(0);

    harness.setIntersecting(true);
    expect(harness.pendingFrames.size).toBe(1);

    harness.runNextFrame(20);
    expect(harness.onFrame).toHaveBeenCalledWith(20);
    expect(harness.pendingFrames.size).toBe(1);

    harness.setIntersecting(false);
    expect(harness.pendingFrames.size).toBe(0);

    harness.setIntersecting(true);
    expect(harness.pendingFrames.size).toBe(1);
    harness.runNextFrame(40);
    expect(harness.onFrame).toHaveBeenLastCalledWith(40);
  });

  it("coalesces resize/request-render notifications and defers them while paused", () => {
    const harness = createHarness();

    harness.loop.start();
    harness.setIntersecting(true);
    harness.loop.requestRender();
    harness.loop.requestRender();
    expect(harness.pendingFrames.size).toBe(1);
    expect(harness.requestFrame).toHaveBeenCalledTimes(1);

    harness.setIntersecting(false);
    harness.loop.requestRender();
    expect(harness.pendingFrames.size).toBe(0);

    harness.setIntersecting(true);
    expect(harness.pendingFrames.size).toBe(1);
    expect(harness.requestFrame).toHaveBeenCalledTimes(2);
  });

  it("keeps at most one RAF outstanding across repeated events and stale callbacks", () => {
    const harness = createHarness();

    harness.loop.start();
    harness.loop.start();
    harness.setIntersecting(true);
    harness.setIntersecting(true);
    expect(harness.pendingFrames.size).toBe(1);
    expect(harness.requestFrame).toHaveBeenCalledTimes(1);

    const [staleHandle, staleCallback] = harness.pendingFrames
      .entries()
      .next().value!;
    harness.setIntersecting(false);
    expect(harness.cancelFrame).toHaveBeenCalledWith(staleHandle);
    harness.setIntersecting(true);
    expect(harness.pendingFrames.size).toBe(1);

    staleCallback(30);
    expect(harness.onFrame).not.toHaveBeenCalled();
    expect(harness.pendingFrames.size).toBe(1);
    expect(harness.requestFrame).toHaveBeenCalledTimes(2);
  });

  it("cleans up pending work and observers idempotently", () => {
    const harness = createHarness();

    harness.loop.start();
    harness.setIntersecting(true);
    const staleCallback = harness.pendingFrames.values().next().value!;

    harness.loop.stop();
    harness.loop.stop();

    expect(harness.pendingFrames.size).toBe(0);
    expect(harness.disconnectObserver).toHaveBeenCalledTimes(1);
    expect(harness.removeVisibilityListener).toHaveBeenCalledTimes(1);

    staleCallback(50);
    harness.setDocumentHidden(false);
    harness.setIntersecting(true);
    expect(harness.onFrame).not.toHaveBeenCalled();
    expect(harness.pendingFrames.size).toBe(0);
  });

  it("falls back to document visibility when IntersectionObserver is unavailable", () => {
    const harness = createHarness({ useIntersectionObserver: false });

    harness.loop.start();
    expect(harness.pendingFrames.size).toBe(1);

    harness.setDocumentHidden(true);
    expect(harness.pendingFrames.size).toBe(0);

    harness.setDocumentHidden(false);
    expect(harness.pendingFrames.size).toBe(1);
    expect(harness.createIntersectionObserver).not.toHaveBeenCalled();
  });
});
