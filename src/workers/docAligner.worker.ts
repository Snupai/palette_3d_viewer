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

const MODEL_URL = "/models/docaligner/lcnet100_h_e_bifpn_256_fp32.onnx";

declare const self: DedicatedWorkerGlobalScope;

// Only the binary comes from public/ort/; its JS loader is part of the
// bundle. (A path prefix would make ORT fetch the loader from there too.)
ort.env.wasm.wasmPaths = { wasm: "/ort/ort-wasm-simd-threaded.jsep.wasm" };
// Threads need cross-origin isolation, which this app does not enable.
ort.env.wasm.numThreads = 1;

let session: ort.InferenceSession | null = null;
let loading: Promise<void> | null = null;

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

async function createSession(
  model: ArrayBuffer,
): Promise<{ session: ort.InferenceSession; backend: DocAlignerBackend }> {
  if ("gpu" in navigator) {
    try {
      return {
        session: await ort.InferenceSession.create(model, {
          executionProviders: ["webgpu"],
        }),
        backend: "webgpu",
      };
    } catch {
      // No usable adapter (or WebGPU off): fall through to WebAssembly.
    }
  }
  return {
    session: await ort.InferenceSession.create(model, {
      executionProviders: ["wasm"],
    }),
    backend: "wasm",
  };
}

async function load() {
  const start = performance.now();
  const response = await fetch(MODEL_URL);
  if (!response.ok)
    throw new Error(`Model download failed (${response.status})`);
  const model = await response.arrayBuffer();
  const downloaded = performance.now();
  const created = await createSession(model);
  const sessionMs = performance.now() - downloaded;
  const warmupStart = performance.now();
  await created.session.run({ img: blankInput() });
  session = created.session;
  post({
    type: "loaded",
    backend: created.backend,
    downloadMs: downloaded - start,
    sessionMs,
    warmupMs: performance.now() - warmupStart,
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
  detect(request.id, request.frame, request.decodeSize).catch(
    (error: unknown) => {
      request.frame.close();
      post({
        type: "detectFailed",
        id: request.id,
        message: error instanceof Error ? error.message : String(error),
      });
    },
  );
};
