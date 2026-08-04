export interface ViewerAnimationLoop {
  start(): void;
  requestRender(): void;
  stop(): void;
}

export interface ViewerVisibilityDocument {
  readonly hidden: boolean;
  addEventListener(type: "visibilitychange", listener: EventListener): void;
  removeEventListener(type: "visibilitychange", listener: EventListener): void;
}

export interface ViewerIntersectionObserver {
  observe(target: Element): void;
  disconnect(): void;
}

export type CreateViewerIntersectionObserver = (
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit,
) => ViewerIntersectionObserver;

export interface ViewerAnimationLoopEnvironment {
  document?: ViewerVisibilityDocument;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  createIntersectionObserver?: CreateViewerIntersectionObserver | null;
}

export interface ViewerAnimationLoopOptions {
  target: Element;
  onFrame: FrameRequestCallback;
  environment?: ViewerAnimationLoopEnvironment;
}

type ScheduledFrame = {
  handle: number;
};

/**
 * Runs one RAF chain while both the document and viewer are visible.
 * Browser APIs are injectable so pause/resume and cleanup can be tested
 * without creating a WebGL renderer.
 */
export function createViewerAnimationLoop({
  target,
  onFrame,
  environment = {},
}: ViewerAnimationLoopOptions): ViewerAnimationLoop {
  const ownerDocument = environment.document ?? target.ownerDocument;
  const ownerWindow = target.ownerDocument.defaultView;
  const requestFrame =
    environment.requestAnimationFrame ??
    ownerWindow?.requestAnimationFrame.bind(ownerWindow);
  const cancelFrame =
    environment.cancelAnimationFrame ??
    ownerWindow?.cancelAnimationFrame.bind(ownerWindow);
  const createIntersectionObserver =
    environment.createIntersectionObserver === null
      ? null
      : (environment.createIntersectionObserver ??
        (ownerWindow && typeof ownerWindow.IntersectionObserver === "function"
          ? (callback: IntersectionObserverCallback, options) =>
              new ownerWindow.IntersectionObserver(callback, options)
          : null));

  if (!requestFrame || !cancelFrame) {
    throw new Error("requestAnimationFrame is unavailable for the viewer");
  }

  let started = false;
  let documentVisible = false;
  let targetVisible = createIntersectionObserver === null;
  let scheduledFrame: ScheduledFrame | null = null;
  let intersectionObserver: ViewerIntersectionObserver | null = null;

  const isVisible = () => started && documentVisible && targetVisible;

  const cancelScheduledFrame = () => {
    if (!scheduledFrame) return;
    cancelFrame(scheduledFrame.handle);
    scheduledFrame = null;
  };

  const scheduleFrame = () => {
    if (!isVisible() || scheduledFrame) return;

    const frame: ScheduledFrame = { handle: -1 };
    scheduledFrame = frame;
    frame.handle = requestFrame((timestamp) => {
      // Ignore a callback from a frame that was cancelled before a later
      // visibility transition scheduled its replacement.
      if (scheduledFrame !== frame) return;
      scheduledFrame = null;
      if (!isVisible()) return;

      onFrame(timestamp);
      scheduleFrame();
    });
  };

  const reconcileVisibility = () => {
    if (isVisible()) scheduleFrame();
    else cancelScheduledFrame();
  };

  const onDocumentVisibilityChange: EventListener = () => {
    documentVisible = !ownerDocument.hidden;
    reconcileVisibility();
  };

  const onIntersection: IntersectionObserverCallback = (entries) => {
    if (!started) return;
    const entry = entries.find((candidate) => candidate.target === target);
    if (!entry) return;

    targetVisible = entry.isIntersecting && entry.intersectionRatio > 0;
    reconcileVisibility();
  };

  return {
    start() {
      if (started) {
        reconcileVisibility();
        return;
      }

      started = true;
      documentVisible = !ownerDocument.hidden;
      ownerDocument.addEventListener(
        "visibilitychange",
        onDocumentVisibilityChange,
      );

      if (createIntersectionObserver) {
        targetVisible = false;
        intersectionObserver = createIntersectionObserver(onIntersection, {
          threshold: 0,
        });
        intersectionObserver.observe(target);
      } else {
        targetVisible = true;
      }

      reconcileVisibility();
    },

    requestRender() {
      scheduleFrame();
    },

    stop() {
      if (!started) return;

      started = false;
      cancelScheduledFrame();
      ownerDocument.removeEventListener(
        "visibilitychange",
        onDocumentVisibilityChange,
      );
      intersectionObserver?.disconnect();
      intersectionObserver = null;
      targetVisible = false;
    },
  };
}
