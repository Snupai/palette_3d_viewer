/// <reference lib="webworker" />
/**
 * Runs the DocAligner corner model with onnxruntime-web: WebGPU when the
 * device offers it, otherwise WebAssembly. Model and runtime are served by
 * this app (`public/models/docaligner/`, `public/ort/`).
 */
import * as ort from "onnxruntime-web";
import {
  DOCALIGNER_INPUT_SIZE,
  frameToTensor,
  heatmapsToQuad,
} from "~/features/project/docAlignerModel";
import type {
  DocAlignerBackend,
  DocAlignerRequest,
  DocAlignerResponse,
} from "~/workers/docAlignerProtocol";
import { createAssetLoader, ORT_WASM_URL } from "~/workers/docAlignerAssets";

declare const self: DedicatedWorkerGlobalScope;

// The binary is handed to ORT as bytes (`wasmBinary`, see `load`), from the
// shared download; the path is only a fallback. Its JS loader is part of the
// bundle. (A path prefix would make ORT fetch the loader from there too.)
ort.env.wasm.wasmPaths = { wasm: ORT_WASM_URL };
// Threads need cross-origin isolation, which this app does not enable.
ort.env.wasm.numThreads = 1;

let session: ort.InferenceSession | null = null;
let backend: DocAlignerBackend | null = null;
let model: ArrayBuffer | null = null;
let loading: Promise<void> | null = null;
const assets = createAssetLoader({
  fetch: (url, init) => fetch(url, init),
  caches: typeof caches === "undefined" ? undefined : caches,
});
/** Detections run one after another: a session must not run twice at once. */
let queue: Promise<void> = Promise.resolve();

function post(message: DocAlignerResponse) {
  self.postMessage(message);
}

function blankInput(): ort.Tensor {
  const size = DOCALIGNER_INPUT_SIZE;
  return new ort.Tensor("float32", new Float32Array(3 * size * size), [
    1,
    3,
    size,
    size,
  ]);
}

/**
 * A session on `provider` that has completed one run (which compiles the
 * WebGPU shaders), with the time each step took.
 */
async function warmSession(provider: DocAlignerBackend, bytes: ArrayBuffer) {
  const start = performance.now();
  const created = await ort.InferenceSession.create(bytes, {
    executionProviders: [provider],
  });
  const sessionMs = performance.now() - start;
  try {
    await created.run({ img: blankInput() });
  } catch (error) {
    await created.release().catch(() => undefined);
    throw error;
  }
  return {
    session: created,
    sessionMs,
    warmupMs: performance.now() - start - sessionMs,
  };
}

/** WebGPU when it both starts and runs, otherwise WebAssembly. */
async function startSession(bytes: ArrayBuffer, downloadMs: number) {
  let started: Awaited<ReturnType<typeof warmSession>> | null = null;
  let provider: DocAlignerBackend = "wasm";
  if ("gpu" in navigator) {
    try {
      started = await warmSession("webgpu", bytes);
      provider = "webgpu";
    } catch {
      // No usable adapter, or its shaders fail: fall back to WebAssembly.
    }
  }
  started ??= await warmSession("wasm", bytes);
  session = started.session;
  backend = provider;
  post({
    type: "loaded",
    backend: provider,
    downloadMs,
    sessionMs: started.sessionMs,
    warmupMs: started.warmupMs,
  });
}

async function load() {
  const start = performance.now();
  // Reuses a prefetch that is still running or already in the cache.
  const downloaded = await assets.get();
  ort.env.wasm.wasmBinary = downloaded.wasm;
  model = downloaded.model;
  await startSession(model, performance.now() - start);
}

/** After a WebGPU run fails, continue on WebAssembly (once). */
async function switchToWasm() {
  const failed = session;
  session = null;
  await failed?.release().catch(() => undefined);
  if (!model) throw new Error("Model not loaded");
  const started = await warmSession("wasm", model);
  session = started.session;
  backend = "wasm";
  post({
    type: "loaded",
    backend: "wasm",
    downloadMs: 0,
    sessionMs: started.sessionMs,
    warmupMs: started.warmupMs,
  });
}

async function detect(id: number, frame: ImageBitmap, decodeSize: number) {
  if (!session) throw new Error("Model not loaded");
  const start = performance.now();
  const canvas = new OffscreenCanvas(frame.width, frame.height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("No 2D context in worker");
  context.drawImage(frame, 0, 0);
  frame.close();
  const { data, width, height } = context.getImageData(
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const read = performance.now();
  const size = DOCALIGNER_INPUT_SIZE;
  const input = new ort.Tensor("float32", frameToTensor(data, width, height), [
    1,
    3,
    size,
    size,
  ]);
  const preprocessed = performance.now();
  const output = await session.run({ img: input });
  const inferred = performance.now();
  const heatmap = output.heatmap!;
  const heatmapSize = heatmap.dims[3]!;
  const quad = heatmapsToQuad(
    (await heatmap.getData()) as Float32Array,
    heatmapSize,
    width,
    height,
    decodeSize,
  );
  heatmap.dispose();
  post({
    type: "detected",
    id,
    quad,
    timings: {
      readMs: read - start,
      tensorMs: preprocessed - read,
      inferenceMs: inferred - preprocessed,
      decodeMs: performance.now() - inferred,
    },
  });
}

self.onmessage = (event: MessageEvent<DocAlignerRequest>) => {
  const request = event.data;
  if (request.type === "prefetch") {
    // Best effort: a failed prefetch is retried when the camera opens.
    assets.prefetch().catch(() => undefined);
    return;
  }
  if (request.type === "load") {
    loading ??= load().catch((error: unknown) => {
      loading = null;
      post({
        type: "loadFailed",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }
  queue = queue.then(() =>
    detect(request.id, request.frame, request.decodeSize).catch(
      async (error: unknown) => {
        request.frame.close();
        if (backend === "webgpu") {
          await switchToWasm().catch((cause: unknown) => {
            post({
              type: "loadFailed",
              message: cause instanceof Error ? cause.message : String(cause),
            });
          });
        }
        post({
          type: "detectFailed",
          id: request.id,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    ),
  );
};
