/**
 * Messages between the sheet camera and the DocAligner worker. The worker
 * owns onnxruntime-web and the model, so neither ever runs on the UI thread.
 */
import type { DocumentQuad } from "~/features/project/documentCameraModel";

export type DocAlignerBackend = "webgpu" | "wasm";

export type DocAlignerRequest =
  /** Download model and runtime only (into the cache), at low priority. */
  | { type: "prefetch" }
  /** Download (or reuse the prefetch) and start a session. */
  | { type: "load" }
  | {
      type: "detect";
      id: number;
      /** Frame to search; transferred, closed by the worker. */
      frame: ImageBitmap;
      /** Side the heatmaps are decoded at (smaller is faster, see `heatmapsToQuad`). */
      decodeSize: number;
    };

export type DocAlignerTimings = {
  /** Frame → pixels (draw into a canvas, read back). */
  readMs: number;
  /** Pixels → model input (pad, resize, BGR). */
  tensorMs: number;
  /** `session.run`. */
  inferenceMs: number;
  /** Heatmaps → corners. */
  decodeMs: number;
};

export type DocAlignerResponse =
  | {
      type: "loaded";
      backend: DocAlignerBackend;
      /** Waiting for model and runtime (≈ 0 when prefetched or cached). */
      downloadMs: number;
      /** Session creation, including fetching and compiling the runtime. */
      sessionMs: number;
      /** First inference, which compiles shaders / kernels. */
      warmupMs: number;
    }
  | { type: "loadFailed"; message: string }
  | {
      type: "detected";
      id: number;
      quad: DocumentQuad | null;
      timings: DocAlignerTimings;
    }
  | { type: "detectFailed"; id: number; message: string };
