import { solveLayer } from "~/domain/solver/solve";
import {
  SOLVER_WORKER_PROTOCOL_VERSION,
  serializeSolverError,
  type SolverWorkerRequest,
  type SolverWorkerResponse,
} from "~/workers/solverProtocol";

type SolverWorkerScope = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<SolverWorkerRequest>) => void,
  ): void;
  postMessage(message: SolverWorkerResponse): void;
};

type SolverWorkerResponsePayload = SolverWorkerResponse extends infer Message
  ? Message extends SolverWorkerResponse
    ? Omit<Message, "protocolVersion" | "runId">
    : never
  : never;

const workerScope = globalThis as unknown as SolverWorkerScope;
const cancelledRunIds = new Set<string>();

function sharedCancellationWasRequested(
  request: Extract<SolverWorkerRequest, { type: "start" }>,
): boolean {
  if (!request.cancellation) return false;
  return Atomics.load(new Int32Array(request.cancellation.buffer), 0) !== 0;
}

workerScope.addEventListener("message", (event) => {
  const request = event.data;
  if (request.protocolVersion !== SOLVER_WORKER_PROTOCOL_VERSION) return;

  if (request.type === "cancel") {
    cancelledRunIds.add(request.runId);
    return;
  }

  let sequence = 0;
  const post = (message: SolverWorkerResponsePayload) => {
    workerScope.postMessage({
      ...message,
      protocolVersion: SOLVER_WORKER_PROTOCOL_VERSION,
      runId: request.runId,
    } as SolverWorkerResponse);
  };

  try {
    const result = solveLayer(request.input, {
      ...request.options,
      onProgress: (progress) => {
        sequence += 1;
        post({ type: "progress", sequence, progress });
      },
      shouldCancel: () =>
        cancelledRunIds.has(request.runId) ||
        sharedCancellationWasRequested(request),
    });
    sequence += 1;
    post({ type: "complete", sequence, result });
  } catch (error) {
    sequence += 1;
    post({
      type: "error",
      sequence,
      error: serializeSolverError(error),
    });
  } finally {
    cancelledRunIds.delete(request.runId);
  }
});
