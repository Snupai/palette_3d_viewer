import type {
  LayerSolverInput,
  SolverOptions,
  SolverProgress,
  SolverResult,
} from "~/domain/solver/types";

export const SOLVER_WORKER_PROTOCOL_VERSION = 1 as const;

export type SolverRunId = string;

export type SolverWorkerOptions = Pick<
  SolverOptions,
  "generatorOrder" | "includeSymmetryVariants" | "progressBatchSize"
>;

export type SolverCancellationSignal = {
  /**
   * Shared when the browser supports it so the synchronous domain solver can
   * observe cancellation while the worker event loop is occupied.
   */
  buffer: SharedArrayBuffer;
};

export type SolverStartMessage = {
  protocolVersion: typeof SOLVER_WORKER_PROTOCOL_VERSION;
  type: "start";
  runId: SolverRunId;
  input: LayerSolverInput;
  options?: SolverWorkerOptions;
  cancellation?: SolverCancellationSignal;
};

export type SolverCancelMessage = {
  protocolVersion: typeof SOLVER_WORKER_PROTOCOL_VERSION;
  type: "cancel";
  runId: SolverRunId;
};

export type SolverWorkerRequest = SolverStartMessage | SolverCancelMessage;

export type SolverProgressMessage = {
  protocolVersion: typeof SOLVER_WORKER_PROTOCOL_VERSION;
  type: "progress";
  runId: SolverRunId;
  sequence: number;
  progress: SolverProgress;
};

export type SolverCompleteMessage = {
  protocolVersion: typeof SOLVER_WORKER_PROTOCOL_VERSION;
  type: "complete";
  runId: SolverRunId;
  sequence: number;
  result: SolverResult;
};

export type SerializedSolverError = {
  name: string;
  message: string;
  stack?: string;
};

export type SolverErrorMessage = {
  protocolVersion: typeof SOLVER_WORKER_PROTOCOL_VERSION;
  type: "error";
  runId: SolverRunId;
  sequence: number;
  error: SerializedSolverError;
};

export type SolverWorkerResponse =
  | SolverProgressMessage
  | SolverCompleteMessage
  | SolverErrorMessage;

export function serializeSolverError(error: unknown): SerializedSolverError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  return {
    name: "Error",
    message: typeof error === "string" ? error : "Unknown solver worker error.",
  };
}
