import type * as OpenCvNamespace from "@techstark/opencv-js";
import type { Mat } from "@techstark/opencv-js";
import {
  flattenedSize,
  pickDocumentQuad,
  type Point,
  type Quad,
} from "./documentScanModel";

export type DocumentScanResult = {
  /** JPEG of the flattened sheet, or of the (downscaled) photo when nothing was found. */
  blob: Blob;
  /** Whether a sheet outline was found and cut out. */
  detected: boolean;
};

/** The declared namespace is the value shape; the runtime default export is a promise of it. */
type OpenCv = typeof OpenCvNamespace;

/** Working resolution for detection and output; phone photos are far larger. */
const WORK_EDGE_PX = 1600;

/** The enum constants are declared as `any`; pin the ones used here to numbers. */
type CvConstants = Record<
  | "MORPH_RECT"
  | "RETR_LIST"
  | "CHAIN_APPROX_SIMPLE"
  | "CV_32FC2"
  | "INTER_LINEAR"
  | "BORDER_REPLICATE"
  | "COLOR_RGBA2GRAY",
  number
>;
const constants = (cv: OpenCv): CvConstants => cv as unknown as CvConstants;

/** Served from public/ by scripts/copy-opencv.mjs; never part of the app bundle. */
export const OPENCV_SCRIPT_URL = "/vendor/opencv/opencv.js";

let opencvPromise: Promise<OpenCv> | null = null;

/**
 * Loads the ~13 MB OpenCV.js build as a plain script once, only when a photo
 * is actually picked. Its UMD wrapper puts a promise of the module on
 * `globalThis.cv`; a bundler import would trip over that thenable export.
 */
function loadOpenCv(): Promise<OpenCv> {
  opencvPromise ??= new Promise<OpenCv>((resolve, reject) => {
    const existing = (globalThis as { cv?: Promise<OpenCv> | OpenCv }).cv;
    if (existing) {
      resolve(existing);
      return;
    }
    const script = document.createElement("script");
    script.src = OPENCV_SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const loaded = (globalThis as { cv?: Promise<OpenCv> | OpenCv }).cv;
      if (loaded) resolve(loaded);
      else reject(new Error("OpenCV.js loaded but did not define cv."));
    };
    script.onerror = () => {
      opencvPromise = null;
      reject(new Error("OpenCV.js could not be loaded."));
    };
    document.head.append(script);
  });
  return opencvPromise;
}

async function drawToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  const scale = Math.min(
    1,
    WORK_EDGE_PX / Math.max(bitmap.width, bitmap.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      0.92,
    ),
  );
}

/** Edge map → polygon candidates (≥ 4 corners, sorted by contour area). */
function findQuadCandidates(
  cv: OpenCv,
  gray: Mat,
): { points: Point[]; convex: boolean }[] {
  const blurred = new cv.Mat();
  const edges = new cv.Mat();
  const k = constants(cv);
  const kernel = cv.getStructuringElement(k.MORPH_RECT, new cv.Size(3, 3));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const approx = new cv.Mat();
  try {
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    // Close small gaps in the paper outline (creases, pen marks over the edge).
    cv.dilate(edges, edges, kernel);
    cv.findContours(
      edges,
      contours,
      hierarchy,
      k.RETR_LIST,
      k.CHAIN_APPROX_SIMPLE,
    );
    const candidates: { points: Point[]; convex: boolean }[] = [];
    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      const perimeter = cv.arcLength(contour, true);
      cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);
      if (approx.rows === 4) {
        const data = approx.data32S;
        const points: Point[] = [];
        for (let k = 0; k < 4; k += 1) {
          points.push({ x: data[k * 2]!, y: data[k * 2 + 1]! });
        }
        candidates.push({ points, convex: cv.isContourConvex(approx) });
      }
      contour.delete();
    }
    return candidates;
  } finally {
    blurred.delete();
    edges.delete();
    kernel.delete();
    contours.delete();
    hierarchy.delete();
    approx.delete();
  }
}

/** Perspective-warps the quad to an upright rectangle and evens out lighting. */
function flatten(cv: OpenCv, source: Mat, quad: Quad): HTMLCanvasElement {
  const { width, height } = flattenedSize(quad);
  const k = constants(cv);
  const from = cv.matFromArray(
    4,
    1,
    k.CV_32FC2,
    quad.flatMap((p) => [p.x, p.y]),
  );
  const to = cv.matFromArray(4, 1, k.CV_32FC2, [
    0,
    0,
    width,
    0,
    width,
    height,
    0,
    height,
  ]);
  const transform = cv.getPerspectiveTransform(from, to);
  const warped = new cv.Mat();
  const gray = new cv.Mat();
  const clahe = new cv.CLAHE(2, new cv.Size(8, 8));
  try {
    cv.warpPerspective(
      source,
      warped,
      transform,
      new cv.Size(width, height),
      k.INTER_LINEAR,
      k.BORDER_REPLICATE,
    );
    // Scanner look: grayscale with local contrast so shadows and creases
    // don't hide print or handwriting from the model.
    cv.cvtColor(warped, gray, k.COLOR_RGBA2GRAY);
    clahe.apply(gray, gray);
    const canvas = document.createElement("canvas");
    cv.imshow(canvas, gray);
    return canvas;
  } finally {
    from.delete();
    to.delete();
    transform.delete();
    warped.delete();
    gray.delete();
    clahe.delete();
  }
}

/**
 * Finds the pallet sheet in a photo, cuts it out, straightens it, and returns
 * a JPEG. Falls back to the downscaled original when no sheet-sized convex
 * quadrilateral is found, so a failed detection never blocks the import.
 */
export async function scanDocument(file: File): Promise<DocumentScanResult> {
  const canvas = await drawToCanvas(file);
  const cv = await loadOpenCv();
  const source = cv.imread(canvas);
  const gray = new cv.Mat();
  try {
    cv.cvtColor(source, gray, constants(cv).COLOR_RGBA2GRAY);
    const quad = pickDocumentQuad(
      findQuadCandidates(cv, gray),
      canvas.width,
      canvas.height,
    );
    if (!quad) return { blob: await toBlob(canvas), detected: false };
    return { blob: await toBlob(flatten(cv, source, quad)), detected: true };
  } finally {
    source.delete();
    gray.delete();
  }
}
