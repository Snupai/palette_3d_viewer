/**
 * Admission guards for the sheet-extraction route. Pure and framework-free so
 * they can be unit-tested; the route composes them around `request.formData()`.
 */

export class RequestBodyTooLargeError extends Error {
  constructor(readonly limitBytes: number) {
    super(`Request body exceeds ${limitBytes} bytes.`);
    this.name = "RequestBodyTooLargeError";
  }
}

/**
 * Returns a request whose body stream aborts once more than `limitBytes` have
 * been read, so multipart parsing never materializes an oversized body. A
 * declared `Content-Length` above the limit is rejected before any read.
 */
export function limitRequestBody(
  request: Request,
  limitBytes: number,
  timeoutMs = 30_000,
): Request {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limitBytes) {
    throw new RequestBodyTooLargeError(limitBytes);
  }
  if (!request.body) return request;

  let seen = 0;
  const limited = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limitBytes) {
          controller.error(new RequestBodyTooLargeError(limitBytes));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
    {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(timeoutMs)]),
    },
  );
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: limited,
    // Required by undici for streaming request bodies.
    ...({ duplex: "half" } as object),
  });
}

export type AdmissionGate = {
  /** Reserves a slot; returns a release function, or null when saturated. */
  tryAcquire(): (() => void) | null;
  readonly inFlight: number;
};

/**
 * Bounded concurrency without a queue: a saturated gate rejects immediately so
 * a burst cannot pile up pending Node requests behind the vision model.
 */
export function createAdmissionGate(maxConcurrent: number): AdmissionGate {
  const limit = Math.max(1, Math.floor(maxConcurrent));
  let inFlight = 0;
  return {
    get inFlight() {
      return inFlight;
    },
    tryAcquire() {
      if (inFlight >= limit) return null;
      inFlight += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        inFlight -= 1;
      };
    },
  };
}
