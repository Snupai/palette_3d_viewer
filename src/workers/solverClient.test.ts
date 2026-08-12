import { describe, expect, it } from "vitest";
import { solveLayer } from "~/domain/solver/solve";
import type { LayerSolverInput, SolverProgress } from "~/domain/solver/types";
import {
  LayerSolverClient,
  SolverRunCancelledError,
  SolverWorkerError,
} from "~/workers/solverClient";
import {
  SOLVER_WORKER_PROTOCOL_VERSION,
  type SolverWorkerRequest,
  type SolverWorkerResponse,
} from "~/workers/solverProtocol";
import {
  ResilientSolverTransport,
  SynchronousSolverTransport,
  type SolverWorkerMessageListener,
  type SolverWorkerTransport,
} from "~/workers/solverTransport";

const input: LayerSolverInput = {
  package: {
    shape: "cuboid",
    dimensionsMm: { length: 100, width: 50 },
    clearanceMm: 0,
  },
  envelopeMm: { minX: 0, minY: 0, maxX: 300, maxY: 200 },
  generationBoundsMm: { minX: 50, minY: 50, maxX: 250, maxY: 150 },
  constraints: {
    minimumPackageCount: 3,
    maximumPackageCount: 3,
    maxCandidatesPerGenerator: 20,
  },
};

const completedResult = solveLayer(input, {
  includeSymmetryVariants: false,
});

class FakeSolverTransport implements SolverWorkerTransport {
  readonly requests: SolverWorkerRequest[] = [];
  private readonly listeners = new Set<SolverWorkerMessageListener>();
  disposed = false;

  postMessage(message: SolverWorkerRequest): void {
    this.requests.push(message);
  }

  subscribe(listener: SolverWorkerMessageListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message: SolverWorkerResponse): void {
    for (const listener of this.listeners) listener(message);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}

function progress(completed: number): SolverProgress {
  return {
    phase: "generation",
    generator: "row",
    completed,
    total: 4,
    message: `Generated ${completed}.`,
  };
}

function progressMessage(
  runId: string,
  sequence: number,
  completed: number,
): SolverWorkerResponse {
  return {
    protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
    type: "progress",
    runId,
    sequence,
    progress: progress(completed),
  };
}

function completeMessage(
  runId: string,
  sequence: number,
): SolverWorkerResponse {
  return {
    protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
    type: "complete",
    runId,
    sequence,
    result: completedResult,
  };
}

describe("LayerSolverClient worker protocol", () => {
  it("delivers monotonic progress before deterministic completion", async () => {
    const transport = new FakeSolverTransport();
    const events: string[] = [];
    const client = new LayerSolverClient({
      transport,
      createRunId: () => "progress-run",
    });
    const run = client.run(input, {
      onProgress: ({ sequence, progress: update }) =>
        events.push(`progress:${sequence}:${update.completed}`),
    });
    const completion = run.result.then((result) => {
      events.push("complete");
      return result;
    });

    transport.emit(progressMessage(run.runId, 1, 2));
    transport.emit(progressMessage(run.runId, 2, 1));
    transport.emit(progressMessage(run.runId, 2, 4));
    transport.emit(progressMessage(run.runId, 3, 4));
    transport.emit(completeMessage(run.runId, 4));

    await expect(completion).resolves.toEqual(completedResult);
    expect(events).toEqual(["progress:1:2", "progress:3:4", "complete"]);
    client.dispose();
  });

  it("sends cancellation and rejects the matching run", async () => {
    const transport = new FakeSolverTransport();
    const client = new LayerSolverClient({
      transport,
      createRunId: () => "cancel-run",
    });
    const run = client.run(input);
    const rejection = expect(run.result).rejects.toMatchObject({
      name: "SolverRunCancelledError",
      runId: run.runId,
      reason: "cancelled",
    });

    expect(run.cancel()).toBe(true);
    expect(run.cancel()).toBe(false);
    await rejection;
    expect(transport.requests.map(({ type }) => type)).toEqual([
      "start",
      "cancel",
    ]);
    expect(transport.requests[1]).toMatchObject({ runId: run.runId });
    client.dispose();
  });

  it("suppresses stale messages after replacing the active run", async () => {
    const transport = new FakeSolverTransport();
    let nextId = 0;
    const progressEvents: string[] = [];
    const client = new LayerSolverClient({
      transport,
      createRunId: () => `replacement-${++nextId}`,
    });
    const first = client.run(input);
    const firstRejection = expect(first.result).rejects.toMatchObject({
      reason: "replaced",
    });
    const second = client.run(input, {
      onProgress: ({ runId }) => progressEvents.push(runId),
    });

    transport.emit(progressMessage(first.runId, 1, 1));
    transport.emit(completeMessage(first.runId, 2));
    transport.emit(progressMessage(second.runId, 1, 1));
    transport.emit(completeMessage(second.runId, 2));

    await firstRejection;
    await expect(second.result).resolves.toEqual(completedResult);
    expect(progressEvents).toEqual([second.runId]);
    expect(
      transport.requests.map(({ type, runId }) => `${type}:${runId}`),
    ).toEqual([
      `start:${first.runId}`,
      `cancel:${first.runId}`,
      `start:${second.runId}`,
    ]);
    client.dispose();
  });

  it("ignores out-of-order terminal messages until completion follows progress", async () => {
    const transport = new FakeSolverTransport();
    const client = new LayerSolverClient({
      transport,
      createRunId: () => "ordered-run",
    });
    const run = client.run(input);
    let settled = false;
    void run.result.finally(() => {
      settled = true;
    });

    transport.emit(progressMessage(run.runId, 5, 2));
    transport.emit(completeMessage(run.runId, 4));
    await Promise.resolve();
    expect(settled).toBe(false);

    transport.emit(completeMessage(run.runId, 6));
    await expect(run.result).resolves.toEqual(completedResult);
    expect(settled).toBe(true);
    client.dispose();
  });

  it("turns worker errors into run-scoped client errors", async () => {
    const transport = new FakeSolverTransport();
    const client = new LayerSolverClient({
      transport,
      createRunId: () => "error-run",
    });
    const run = client.run(input);

    transport.emit({
      protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
      type: "error",
      runId: run.runId,
      sequence: 1,
      error: {
        name: "RangeError",
        message: "Synthetic worker failure.",
        stack: "remote stack",
      },
    });

    const error = await run.result.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(SolverWorkerError);
    expect(error).toMatchObject({
      name: "RangeError",
      message: "Synthetic worker failure.",
      runId: run.runId,
      stack: "remote stack",
    });
    client.dispose();
  });
});

describe("SynchronousSolverTransport fallback", () => {
  it("runs the pure solver without Worker and supports cooperative cancellation", async () => {
    const client = new LayerSolverClient({
      transport: new SynchronousSolverTransport(),
      createRunId: () => "fallback-run",
    });
    const run = client.run(input, {
      progressBatchSize: 1,
      onProgress: ({ progress: update }) => {
        if (update.phase === "generation" && update.completed >= 1) {
          client.cancel("fallback-run");
        }
      },
    });

    await expect(run.result).rejects.toBeInstanceOf(SolverRunCancelledError);
    client.dispose();
  });

  it("completes deterministically through the same pure solver entry point", async () => {
    const client = new LayerSolverClient({
      transport: new SynchronousSolverTransport(),
      createRunId: () => "fallback-complete",
    });

    await expect(
      client.solve(input, { includeSymmetryVariants: false }),
    ).resolves.toEqual(completedResult);
    client.dispose();
  });
});

describe("ResilientSolverTransport", () => {
  function workerLoadFailure(runId: string): SolverWorkerResponse {
    return {
      protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
      type: "error",
      runId,
      sequence: Number.MAX_SAFE_INTEGER,
      error: {
        name: "WorkerError",
        message: "The solver worker failed to load or run.",
      },
    };
  }

  it("restarts a pending run on the fallback when the worker never loads", async () => {
    const primary = new FakeSolverTransport();
    const client = new LayerSolverClient({
      transport: new ResilientSolverTransport(primary),
      createRunId: () => "resilient-run",
    });

    const run = client.run(input, { includeSymmetryVariants: false });
    primary.emit(workerLoadFailure("resilient-run"));

    await expect(run.result).resolves.toEqual(completedResult);
    expect(primary.disposed).toBe(true);
    client.dispose();
  });

  it("surfaces a worker error once the run has already produced responses", async () => {
    const primary = new FakeSolverTransport();
    const client = new LayerSolverClient({
      transport: new ResilientSolverTransport(primary),
      createRunId: () => "resilient-late",
    });

    const run = client.run(input);
    primary.emit({
      protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
      type: "progress",
      runId: "resilient-late",
      sequence: 1,
      progress: progress(1),
    });
    primary.emit(workerLoadFailure("resilient-late"));

    await expect(run.result).rejects.toBeInstanceOf(SolverWorkerError);
    client.dispose();
  });

  it("routes later runs straight to the fallback after degrading", async () => {
    const primary = new FakeSolverTransport();
    let runIndex = 0;
    const client = new LayerSolverClient({
      transport: new ResilientSolverTransport(primary),
      createRunId: () => `resilient-seq-${(runIndex += 1)}`,
    });

    const first = client.run(input, { includeSymmetryVariants: false });
    primary.emit(workerLoadFailure("resilient-seq-1"));
    await expect(first.result).resolves.toEqual(completedResult);

    await expect(
      client.solve(input, { includeSymmetryVariants: false }),
    ).resolves.toEqual(completedResult);
    expect(primary.requests).toHaveLength(1);
    client.dispose();
  });
});
