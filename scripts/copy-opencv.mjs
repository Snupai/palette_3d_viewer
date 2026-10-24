// Copies the OpenCV.js build (sheet-photo document scan) into public/ so the
// browser loads it as a plain script on demand instead of bundling 13 MB.
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules/@techstark/opencv-js/dist/opencv.js");
const target = join(root, "public/vendor/opencv/opencv.js");

mkdirSync(dirname(target), { recursive: true });
try {
  if (statSync(target).size === statSync(source).size) process.exit(0);
} catch {
  // target missing → copy below
}
copyFileSync(source, target);
console.log(`Copied OpenCV.js to ${target}`);
