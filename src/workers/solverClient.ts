import type {
  LayerSolverInput,
  SolverProgress,
  SolverResult,
} from "~/domain/solver/types";
import {
  SOLVER_WORKER_PROTOCOL_VERSION,
  serializeSolverError,
  type SolverCancellationSignal,
  type SolverRunId,
  type SolverWorkerOptions,
  type SolverWorkerResponse,
} from "~/workers/solverProtocol";
import {
  createDefaultSolverTransport,
  type SolverWorkerTransport,
} from "~/workers/solverTransport";

export type SolverClientProgress = {
  runId: SolverRunId;
  sequence: number;
  progress: SolverProgress;
};

export type SolverClientRunOptions = SolverWorkerOptions & {
  runId?: SolverRunId;
  onProgress?: (update: SolverClientProgress) => void;
};

export type SolverRunHandle = {
  runId: SolverRunId;
  result: Promise<SolverResult>;
  cancel(): boolean;
};

export type SolverClientOptions = {
  transport?: SolverWorkerTransport;
  createRunId?: () => SolverRunId;
};

export type SolverCancellationReason = "cancelled" | "replaced" | "disposed";

export class SolverRunCancelledError extends Error {
  constructor(
    readonly runId: SolverRunId,
    readonly reason: SolverCancellationReason,
  ) {
    super(`Solver run ${runId} was ${reason}.`);
    this.name = "SolverRunCancelledError";
  }
}

export class SolverWorkerError extends Error {
  constructor(
    readonly runId: SolverRunId,
    remote: { name: string; message: string; stack?: string },
  ) {
    super(remote.message);
    this.name = remote.name || "SolverWorkerError";
    if (remote.stack) this.stack = remote.stack;
  }
}

type ActiveRun = {
  runId: SolverRunId;
  onProgress?: (update: SolverClientProgress) => void;
  cancellationView?: Int32Array;
  lastSequence: number;
  progressCompleted: Map<string, number>;
  resolve(result: SolverResult): void;
  reject(error: Error): void;
};

function createSharedCancellation():
  | { message: SolverCancellationSignal; view: Int32Array }
  | undefined {
  if (typeof SharedArrayBuffer !== "function") return undefined;
  try {
    const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    return { message: { buffer }, view: new Int32Array(buffer) };
  } catch {
    return undefined;
  }
}

let generatedRunId = 0;
function defaultRunId(): string {
  generatedRunId += 1;
  return `solver-${Date.now().toString(36)}-${generatedRunId.toString(36)}`;
}

function progressKey(progress: SolverProgress): string {
  return `${progress.phase}:${progress.generator ?? ""}`;
}

export class LayerSolverClient {
  private readonly transport: SolverWorkerTransport;
  private readonly createRunId: () => SolverRunId;
  private readonly unsubscribe: () => void;
  private activeRun: ActiveRun | null = null;
  private disposed = false;

  constructor(options: SolverClientOptions = {}) {
    this.transport = options.transport ?? createDefaultSolverTransport();
    this.createRunId = options.createRunId ?? defaultRunId;
    this.unsubscribe = this.transport.subscribe((message) =>
      this.receive(message),
    );
  }

  run(
    input: LayerSolverInput,
    options: SolverClientRunOptions = {},
  ): SolverRunHandle {
    if (this.disposed)
      throw new Error("Cannot start a disposed solver client.");
    if (this.activeRun) this.cancelRun(this.activeRun, "replaced");

    const runId = options.runId ?? this.createRunId();
    const sharedCancellation = createSharedCancellation();
    let resolve!: (result: SolverResult) => void;
    let reject!: (error: Error) => void;
    const result = new Promise<SolverResult>(
      (resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      },
    );
    const activeRun: ActiveRun = {
      runId,
      onProgress: options.onProgress,
      cancellationView: sharedCancellation?.view,
      lastSequence: -1,
      progressCompleted: new Map(),
      resolve,
      reject,
    };
    this.activeRun = activeRun;

    const solverOptions: SolverWorkerOptions = {
      generatorOrder: options.generatorOrder,
      includeSymmetryVariants: options.includeSymmetryVariants,
      progressBatchSize: options.progressBatchSize,
    };
    try {
      this.transport.postMessage({
        protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
        type: "start",
        runId,
        input,
        options: solverOptions,
        cancellation: sharedCancellation?.message,
      });
    } catch (error) {
      this.activeRun = null;
      reject(new SolverWorkerError(runId, serializeSolverError(error)));
    }

    return {
      runId,
      result,
      cancel: () => this.cancel(runId),
    };
  }

  solve(
    input: LayerSolverInput,
    options: SolverClientRunOptions = {},
  ): Promise<SolverResult> {
    return this.run(input, options).result;
  }

  cancel(runId = this.activeRun?.runId): boolean {
    if (!runId || this.activeRun?.runId !== runId) return false;
    this.cancelRun(this.activeRun, "cancelled");
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.activeRun) this.cancelRun(this.activeRun, "disposed");
    this.unsubscribe();
    this.transport.dispose();
  }

  private cancelRun(run: ActiveRun, reason: SolverCancellationReason): void {
    if (this.activeRun !== run) return;
    if (run.cancellationView) Atomics.store(run.cancellationView, 0, 1);
    this.activeRun = null;
    try {
      this.transport.postMessage({
        protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
        type: "cancel",
        runId: run.runId,
      });
    } catch {
      // Cancellation still settles locally if the transport has already failed.
    }
    run.reject(new SolverRunCancelledError(run.runId, reason));
  }

  private receive(message: SolverWorkerResponse): void {
    if (
      this.disposed ||
      message.protocolVersion !== SOLVER_WORKER_PROTOCOL_VERSION
    ) {
      return;
    }
    const run = this.activeRun;
    if (!run || message.runId !== run.runId) return;
    if (!Number.isSafeInteger(message.sequence)) return;
    if (message.sequence <= run.lastSequence) return;
    run.lastSequence = message.sequence;

    if (message.type === "progress") {
      const key = progressKey(message.progress);
      const previousCompleted = run.progressCompleted.get(key) ?? -1;
      if (message.progress.completed < previousCompleted) return;
      run.progressCompleted.set(key, message.progress.completed);
      run.onProgress?.({
        runId: run.runId,
        sequence: message.sequence,
        progress: message.progress,
      });
      return;
    }

    this.activeRun = null;
    if (message.type === "complete") {
      run.resolve(message.result);
    } else {
      run.reject(new SolverWorkerError(run.runId, message.error));
    }
  }
}

export function createLayerSolverClient(
  options: SolverClientOptions = {},
): LayerSolverClient {
  return new LayerSolverClient(options);
}
