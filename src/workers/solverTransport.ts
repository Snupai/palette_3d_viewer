import { solveLayer } from "~/domain/solver/solve";
import {
  SOLVER_WORKER_PROTOCOL_VERSION,
  serializeSolverError,
  type SolverStartMessage,
  type SolverWorkerRequest,
  type SolverWorkerResponse,
} from "~/workers/solverProtocol";

export type SolverWorkerMessageListener = (
  message: SolverWorkerResponse,
) => void;

export interface SolverWorkerTransport {
  postMessage(message: SolverWorkerRequest): void;
  subscribe(listener: SolverWorkerMessageListener): () => void;
  dispose(): void;
}

abstract class SubscribableSolverTransport implements SolverWorkerTransport {
  private readonly listeners = new Set<SolverWorkerMessageListener>();

  abstract postMessage(message: SolverWorkerRequest): void;

  subscribe(listener: SolverWorkerMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected dispatch(message: SolverWorkerResponse): void {
    for (const listener of this.listeners) listener(message);
  }

  dispose(): void {
    this.listeners.clear();
  }
}

type BrowserSolverRun = {
  worker: Worker;
  cooperativeCancellation: boolean;
};

/** Browser transport: each run gets a module worker so replacement never queues. */
export class BrowserSolverWorkerTransport extends SubscribableSolverTransport {
  private readonly workers = new Map<string, BrowserSolverRun>();

  postMessage(message: SolverWorkerRequest): void {
    if (message.type === "cancel") {
      const run = this.workers.get(message.runId);
      if (!run) return;
      try {
        run.worker.postMessage(message);
      } catch (error) {
        this.release(message.runId);
        throw error;
      }
      if (!run.cooperativeCancellation) this.release(message.runId);
      return;
    }

    const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), {
      type: "module",
      name: `layer-solver-${message.runId}`,
    });
    this.workers.set(message.runId, {
      worker,
      cooperativeCancellation: message.cancellation !== undefined,
    });
    worker.addEventListener(
      "message",
      (event: MessageEvent<SolverWorkerResponse>) => {
        const response = event.data;
        this.dispatch(response);
        if (response.type !== "progress") this.release(response.runId);
      },
    );
    worker.addEventListener("error", (event) => {
      this.dispatch({
        protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
        type: "error",
        runId: message.runId,
        sequence: Number.MAX_SAFE_INTEGER,
        error: {
          name: "WorkerError",
          message: event.message || "The solver worker failed to load or run.",
          ...(event.error instanceof Error && event.error.stack
            ? { stack: event.error.stack }
            : {}),
        },
      });
      this.release(message.runId);
    });
    try {
      worker.postMessage(message);
    } catch (error) {
      this.release(message.runId);
      throw error;
    }
  }

  private release(runId: string): void {
    const run = this.workers.get(runId);
    if (!run) return;
    run.worker.terminate();
    this.workers.delete(runId);
  }

  override dispose(): void {
    for (const { worker } of this.workers.values()) worker.terminate();
    this.workers.clear();
    super.dispose();
  }
}

type SynchronousRun = {
  request: SolverStartMessage;
  cancelled: boolean;
};

/**
 * Deferred synchronous fallback for SSR, tests, and browsers without Worker.
 * It invokes the same pure solver entry point and keeps the wire behavior.
 */
export class SynchronousSolverTransport extends SubscribableSolverTransport {
  private readonly runs = new Map<string, SynchronousRun>();
  private disposed = false;

  postMessage(message: SolverWorkerRequest): void {
    if (message.type === "cancel") {
      const run = this.runs.get(message.runId);
      if (run) run.cancelled = true;
      return;
    }

    const run: SynchronousRun = { request: message, cancelled: false };
    this.runs.set(message.runId, run);
    queueMicrotask(() => this.execute(run));
  }

  private execute(run: SynchronousRun): void {
    const { request } = run;
    if (this.disposed || this.runs.get(request.runId) !== run) return;
    let sequence = 0;
    const sharedCancelled = () =>
      request.cancellation
        ? Atomics.load(new Int32Array(request.cancellation.buffer), 0) !== 0
        : false;

    try {
      const result = solveLayer(request.input, {
        ...request.options,
        onProgress: (progress) => {
          sequence += 1;
          this.dispatch({
            protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
            type: "progress",
            runId: request.runId,
            sequence,
            progress,
          });
        },
        shouldCancel: () => run.cancelled || sharedCancelled(),
      });
      sequence += 1;
      this.dispatch({
        protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
        type: "complete",
        runId: request.runId,
        sequence,
        result,
      });
    } catch (error) {
      sequence += 1;
      this.dispatch({
        protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
        type: "error",
        runId: request.runId,
        sequence,
        error: serializeSolverError(error),
      });
    } finally {
      this.runs.delete(request.runId);
    }
  }

  override dispose(): void {
    this.disposed = true;
    this.runs.clear();
    super.dispose();
  }
}

/**
 * Wraps a primary transport and restarts the run on a fallback transport when
 * the worker never starts — a stale chunk URL, a blocked script, or a browser
 * that refuses module workers all surface as a `WorkerError` before any
 * response has been dispatched. The restart is only safe while the run is still
 * pending, because `LayerSolverClient` drops responses whose sequence is not
 * strictly increasing.
 */
export class ResilientSolverTransport extends SubscribableSolverTransport {
  private readonly pending = new Map<string, SolverStartMessage>();
  private readonly fallbackRuns = new Set<string>();
  private fallback: SolverWorkerTransport | null = null;
  private unsubscribePrimary: (() => void) | null;
  private primaryFailed = false;

  constructor(
    private readonly primary: SolverWorkerTransport,
    private readonly createFallback: () => SolverWorkerTransport = () =>
      new SynchronousSolverTransport(),
  ) {
    super();
    this.unsubscribePrimary = primary.subscribe((message) =>
      this.receivePrimary(message),
    );
  }

  postMessage(message: SolverWorkerRequest): void {
    if (message.type === "cancel") {
      this.pending.delete(message.runId);
      if (this.fallbackRuns.delete(message.runId)) {
        this.fallback?.postMessage(message);
      } else if (!this.primaryFailed) {
        this.primary.postMessage(message);
      }
      return;
    }

    if (this.primaryFailed) {
      this.startOnFallback(message);
      return;
    }

    this.pending.set(message.runId, message);
    try {
      this.primary.postMessage(message);
    } catch {
      this.pending.delete(message.runId);
      this.degrade();
      this.startOnFallback(message);
    }
  }

  private receivePrimary(message: SolverWorkerResponse): void {
    const pendingStart = this.pending.get(message.runId);
    this.pending.delete(message.runId);
    if (
      pendingStart &&
      message.type === "error" &&
      message.error.name === "WorkerError"
    ) {
      this.degrade();
      this.startOnFallback(pendingStart);
      return;
    }
    this.dispatch(message);
  }

  private startOnFallback(message: SolverStartMessage): void {
    this.fallbackRuns.add(message.runId);
    this.ensureFallback().postMessage(message);
  }

  private ensureFallback(): SolverWorkerTransport {
    if (this.fallback) return this.fallback;
    const fallback = this.createFallback();
    fallback.subscribe((message) => {
      if (message.type !== "progress") this.fallbackRuns.delete(message.runId);
      this.dispatch(message);
    });
    this.fallback = fallback;
    return fallback;
  }

  private degrade(): void {
    if (this.primaryFailed) return;
    this.primaryFailed = true;
    this.unsubscribePrimary?.();
    this.unsubscribePrimary = null;
    this.primary.dispose();
  }

  override dispose(): void {
    this.unsubscribePrimary?.();
    this.unsubscribePrimary = null;
    this.primary.dispose();
    this.fallback?.dispose();
    this.fallback = null;
    this.pending.clear();
    this.fallbackRuns.clear();
    super.dispose();
  }
}

export function createDefaultSolverTransport(): SolverWorkerTransport {
  return typeof window !== "undefined" && typeof Worker !== "undefined"
    ? new ResilientSolverTransport(new BrowserSolverWorkerTransport())
    : new SynchronousSolverTransport();
}
