// Copies the onnxruntime-web WebAssembly binary into public/ort/ so the sheet
// camera loads it from this app (no CDN). Runs on install; public/ort/ is not
// committed. The default onnxruntime-web bundle uses the JSEP build, which
// serves both the WebGPU and the plain WASM execution provider.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = "ort-wasm-simd-threaded.jsep.wasm";
const target = join(root, "public", "ort");
mkdirSync(target, { recursive: true });
copyFileSync(
  join(root, "node_modules", "onnxruntime-web", "dist", file),
  join(target, file),
);
