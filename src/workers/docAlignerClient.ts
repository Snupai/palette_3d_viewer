/**
 * Main-thread handle on the DocAligner worker: loads the model once per page
 * (shared by every camera open, so WebGPU compiles its shaders only once),
 * runs one detection at a time and reports whether it is busy, so the live
 * preview can skip frames instead of queueing them.
 */
import type { DocumentQuad } from "~/features/project/documentCameraModel";
import type {
  DocAlignerBackend,
  DocAlignerRequest,
  DocAlignerResponse,
  DocAlignerTimings,
} from "~/workers/docAlignerProtocol";

export type DocAlignerStatus = "loading" | "ready" | "failed";

export type DocAlignerDetection = {
  quad: DocumentQuad | null;
  timings: DocAlignerTimings;
};

/** Where the start-up time went (shown in the camera's readout). */
export type DocAlignerLoadTimings = {
  downloadMs: number;
  sessionMs: number;
  warmupMs: number;
};

const log = (message: string) => {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[DocAligner] ${message}`);
  }
};

export class DocAlignerClient {
  status: DocAlignerStatus = "loading";
  backend: DocAlignerBackend | null = null;
  loadTimings: DocAlignerLoadTimings | null = null;
  /** Timings of the most recent detection. */
  lastTimings: DocAlignerTimings | null = null;
  private readonly worker: Worker;
  private readonly pending = new Map<
    number,
    {
      resolve: (detection: DocAlignerDetection) => void;
      reject: (error: Error) => void;
    }
  >();
  private nextId = 1;
  private inferenceCount = 0;
  private inferenceTotalMs = 0;

  constructor() {
    this.worker = new Worker(
      new URL("./docAligner.worker.ts", import.meta.url),
      { type: "module", name: "docaligner" },
    );
    this.worker.onmessage = (event: MessageEvent<DocAlignerResponse>) =>
      this.receive(event.data);
    this.worker.onerror = () => this.fail("Worker crashed");
    this.send({ type: "load" });
  }

  /** A detection is running or queued (live preview or capture). */
  get busy(): boolean {
    return this.pending.size > 0;
  }

  /** Finds the sheet in `frame` (transferred to the worker). */
  detect(frame: ImageBitmap, decodeSize: number): Promise<DocAlignerDetection> {
    if (this.status !== "ready") {
      frame.close();
      return Promise.reject(new Error("DocAligner not ready"));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(
        { type: "detect", id, frame, decodeSize } satisfies DocAlignerRequest,
        [frame],
      );
    });
  }

  private send(request: DocAlignerRequest) {
    this.worker.postMessage(request);
  }

  /** Gives up on the model: the worker and its sessions are released. */
  private fail(message: string) {
    this.status = "failed";
    this.worker.terminate();
    for (const { reject } of this.pending.values()) reject(new Error(message));
    this.pending.clear();
  }

  private receive(response: DocAlignerResponse) {
    switch (response.type) {
      case "loaded": {
        this.status = "ready";
        this.backend = response.backend;
        const { downloadMs, sessionMs, warmupMs } = response;
        this.loadTimings = { downloadMs, sessionMs, warmupMs };
        log(
          `model ready on ${response.backend}: download ${Math.round(downloadMs)} ms, session ${Math.round(sessionMs)} ms, first inference ${Math.round(warmupMs)} ms`,
        );
        return;
      }
      case "loadFailed":
        this.fail(response.message);
        log(`model unavailable, classic detection only: ${response.message}`);
        return;
      case "detected": {
        const entry = this.pending.get(response.id);
        this.pending.delete(response.id);
        const { readMs, tensorMs, inferenceMs, decodeMs } = response.timings;
        this.lastTimings = response.timings;
        this.inferenceCount++;
        this.inferenceTotalMs += readMs + tensorMs + inferenceMs + decodeMs;
        if (this.inferenceCount % 20 === 0) {
          log(
            `${this.inferenceCount} detections, mean ${Math.round(this.inferenceTotalMs / this.inferenceCount)} ms; last: read ${Math.round(readMs)} ms, tensor ${Math.round(tensorMs)} ms, inference ${Math.round(inferenceMs)} ms, decode ${Math.round(decodeMs)} ms`,
          );
        }
        entry?.resolve({ quad: response.quad, timings: response.timings });
        return;
      }
      case "detectFailed": {
        const entry = this.pending.get(response.id);
        this.pending.delete(response.id);
        entry?.reject(new Error(response.message));
        return;
      }
    }
  }
}

let shared: DocAlignerClient | null = null;

/**
 * The page-wide DocAligner, created (and the model loaded) on first use;
 * null where workers, OffscreenCanvas or ImageBitmap are unavailable.
 */
export function sharedDocAligner(): DocAlignerClient | null {
  if (shared && shared.status !== "failed") return shared;
  if (
    typeof Worker === "undefined" ||
    typeof OffscreenCanvas === "undefined" ||
    typeof createImageBitmap === "undefined"
  ) {
    return null;
  }
  try {
    shared = new DocAlignerClient();
  } catch {
    return null;
  }
  return shared;
}
