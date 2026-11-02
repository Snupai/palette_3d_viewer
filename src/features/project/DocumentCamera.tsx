"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "~/i18n";
import {
  cameraErrorKind,
  DETECTION_WIDTH,
  detectDocumentQuad,
  initialQuadTracker,
  liveCameraSupported,
  rgbaToLuminance,
  rgbaToWhiteness,
  trackQuad,
  type CameraErrorKind,
  type DocumentQuad,
} from "~/features/project/documentCameraModel";
import {
  quadToPixels,
  warpedSize,
  warpPerspective,
} from "~/features/project/documentWarp";
import {
  sharedDocAligner,
  type DocAlignerClient,
  type DocAlignerLoadTimings,
} from "~/workers/docAlignerClient";
import type { DocAlignerTimings } from "~/workers/docAlignerProtocol";

export type DocumentCameraProps = {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Opens the phone's own camera app when the live preview is unavailable. */
  onFallback: () => void;
};

type Phase = "starting" | "live" | "review" | "error";

const DETECTION_INTERVAL_MS = 100;
/**
 * Heatmap decode size: live frames trade < 1 px of accuracy for speed, the
 * captured photo decodes finer (see `heatmapsToQuad`).
 */
const LIVE_DECODE_SIZE = 256;
const CAPTURE_DECODE_SIZE = 512;
/**
 * The model misses some frames of a sheet it otherwise finds. When the
 * captured frame is one of them, a live detection at most this old (not the
 * smoothed outline, which outlives misses) still crops the photo; older ones
 * may no longer match if the phone or the sheet moved.
 */
const FRESH_DETECTION_MS = 400;
/** Window over which the on-screen detection rate is averaged. */
const STATS_WINDOW_MS = 2000;

/** Which detector produced the last live outline (on-screen readout). */
type DetectorStats = {
  /** `model`: DocAligner found the sheet; `modelMiss`: it did not, classic ran; `classic`: model not ready. */
  engine: "model" | "modelMiss" | "classic";
  modelStatus: "loading" | "ready" | "failed" | "unavailable";
  backend: string | null;
  load: DocAlignerLoadTimings | null;
  /** Where the last model run spent its time. */
  frame: DocAlignerTimings | null;
  fps: number;
  latencyMs: number;
};
const JPEG_QUALITY = 0.92;

type Photo = { file: File; url: string };
type Shot = { original: Photo; cropped: Photo | null };
type ShotVersion = "cropped" | "original";

function canvasToPhoto(
  canvas: HTMLCanvasElement,
  name: string,
): Promise<Photo | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const file = new File([blob], name, { type: "image/jpeg" });
        resolve({ file, url: URL.createObjectURL(file) });
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}

/** Classic (non-ML) sheet outline of a frame, scaled down for detection. */
function detectClassic(
  source: HTMLCanvasElement | HTMLVideoElement,
  sourceWidth: number,
  sourceHeight: number,
): DocumentQuad | null {
  const canvas = document.createElement("canvas");
  canvas.width = DETECTION_WIDTH;
  canvas.height = Math.max(
    1,
    Math.round((DETECTION_WIDTH * sourceHeight) / sourceWidth),
  );
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  return detectDocumentQuad(
    rgbaToLuminance(data),
    canvas.width,
    canvas.height,
    rgbaToWhiteness(data),
  );
}

/** The sheet cut out of the photo and straightened, or null when that fails. */
function cropToSheet(
  source: HTMLCanvasElement,
  quad: DocumentQuad,
): HTMLCanvasElement | null {
  const context = source.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  const corners = quadToPixels(quad, source.width, source.height);
  const { width, height } = warpedSize(corners);
  const warped = warpPerspective(
    context.getImageData(0, 0, source.width, source.height),
    corners,
    width,
    height,
  );
  if (!warped) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const target = canvas.getContext("2d");
  if (!target) return null;
  target.putImageData(new ImageData(warped.data, width, height), 0, 0);
  return canvas;
}

/** Milliseconds as seconds with one decimal, for the readout. */
const seconds = (ms: number | undefined) => ((ms ?? 0) / 1000).toFixed(1);

const errorKey = {
  unsupported: "projectForm.camera.error.unsupported",
  denied: "projectForm.camera.error.denied",
  notFound: "projectForm.camera.error.notFound",
  busy: "projectForm.camera.error.busy",
  failed: "projectForm.camera.error.failed",
} as const satisfies Record<CameraErrorKind, string>;

/**
 * Full-screen live camera for photographing a pallet sheet: a white outline
 * follows the detected sheet, the shot can be reviewed and retaken before it
 * is handed on.
 */
export function DocumentCamera({
  onCapture,
  onClose,
  onFallback,
}: DocumentCameraProps) {
  const t = useT();
  const titleId = useId();
  const videoRef = useRef<HTMLVideoElement>(null);
  const shutterRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<CameraErrorKind | null>(null);
  const [captureFailed, setCaptureFailed] = useState(false);
  const [videoSize, setVideoSize] = useState({ width: 0, height: 0 });
  const [quad, setQuad] = useState<DocumentQuad | null>(null);
  const [shot, setShot] = useState<Shot | null>(null);
  const [version, setVersion] = useState<ShotVersion>("cropped");
  const [capturing, setCapturing] = useState(false);
  const [stats, setStats] = useState<DetectorStats | null>(null);
  const mountedRef = useRef(true);
  const capturingRef = useRef(false);
  const alignerRef = useRef<DocAlignerClient | null>(null);
  /** Last frame in which a detector actually found the sheet. */
  const lastHitRef = useRef<{ quad: DocumentQuad; at: number } | null>(null);

  useEffect(() => {
    // The DocAligner model loads when the camera first opens and stays loaded
    // for the page; until it is ready, or if it cannot load, the classic
    // detector outlines the sheet.
    alignerRef.current = sharedDocAligner();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    rootRef.current?.focus();
    // The camera usually opens from inside the project dialog. Claim Escape
    // before React sees it, so it closes only the camera, wherever focus is.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setPhase("starting");
    setError(null);
    if (!liveCameraSupported()) {
      setError("unsupported");
      setPhase("error");
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then((granted) => {
        // Closed while the permission prompt was open: release the camera.
        if (cancelled) {
          granted.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = granted;
        video.srcObject = granted;
        return video.play();
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cameraErrorKind(cause));
        setPhase("error");
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (phase !== "live") return;
    shutterRef.current?.focus();
    const video = videoRef.current;
    if (!video || !videoSize.width || !videoSize.height) return;
    let tracker = initialQuadTracker;
    let stopped = false;
    // One model run at a time; frames arriving meanwhile are skipped.
    let inFlight = false;
    const started = performance.now();
    const completions: number[] = [];
    let lastStats = 0;
    const update = (
      detected: DocumentQuad | null,
      engine: DetectorStats["engine"],
      since: number,
    ) => {
      if (stopped) return;
      if (detected)
        lastHitRef.current = { quad: detected, at: performance.now() };
      tracker = trackQuad(tracker, detected);
      setQuad(tracker.quad);
      const now = performance.now();
      completions.push(now);
      while (completions[0]! < now - STATS_WINDOW_MS) completions.shift();
      if (now - lastStats < 250) return;
      lastStats = now;
      const aligner = alignerRef.current;
      const window = Math.min(STATS_WINDOW_MS, now - started) / 1000;
      setStats({
        engine,
        modelStatus: aligner?.status ?? "unavailable",
        backend: aligner?.backend ?? null,
        load: aligner?.loadTimings ?? null,
        frame: aligner?.lastTimings ?? null,
        fps: window > 0 ? completions.length / window : 0,
        latencyMs: now - since,
      });
    };
    const classic = () =>
      detectClassic(video, videoSize.width, videoSize.height);
    const timer = window.setInterval(() => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const aligner = alignerRef.current;
      const since = performance.now();
      if (aligner?.status !== "ready") {
        update(classic(), "classic", since);
        return;
      }
      if (inFlight) return;
      inFlight = true;
      createImageBitmap(video)
        .then((frame) => aligner.detect(frame, LIVE_DECODE_SIZE))
        .then(({ quad: found }) =>
          found
            ? update(found, "model", since)
            : update(classic(), "modelMiss", since),
        )
        .catch(() => update(classic(), "modelMiss", since))
        .finally(() => {
          inFlight = false;
        });
    }, DETECTION_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      setQuad(null);
      setStats(null);
    };
  }, [phase, videoSize]);

  useEffect(
    () => () => {
      if (!shot) return;
      URL.revokeObjectURL(shot.original.url);
      if (shot.cropped) URL.revokeObjectURL(shot.cropped.url);
    },
    [shot],
  );

  const capture = async () => {
    const video = videoRef.current;
    if (!video?.videoWidth || capturingRef.current) return;
    const hit = lastHitRef.current;
    const recentHit =
      hit && performance.now() - hit.at <= FRESH_DETECTION_MS ? hit.quad : null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      setCaptureFailed(true);
      return;
    }
    context.drawImage(video, 0, 0);
    capturingRef.current = true;
    setCapturing(true);
    const stamp = Date.now();
    const original = await canvasToPhoto(canvas, `palettenblatt-${stamp}.jpg`);
    let sheet: HTMLCanvasElement | null = null;
    try {
      let sheetQuad: DocumentQuad | null = null;
      const aligner = alignerRef.current;
      if (aligner?.status === "ready") {
        try {
          sheetQuad = (
            await aligner.detect(
              await createImageBitmap(canvas),
              CAPTURE_DECODE_SIZE,
            )
          ).quad;
        } catch {
          // Fall back to classic detection below.
        }
      }
      // This frame first; otherwise only a detection from just before the
      // shutter, never the smoothed outline, which can be stale.
      sheetQuad ??=
        detectClassic(canvas, canvas.width, canvas.height) ?? recentHit;
      sheet = sheetQuad ? cropToSheet(canvas, sheetQuad) : null;
    } catch {
      // Cropping is optional; the original photo still goes through.
      sheet = null;
    }
    const cropped = sheet
      ? await canvasToPhoto(sheet, `palettenblatt-${stamp}-zugeschnitten.jpg`)
      : null;
    if (!mountedRef.current) {
      if (original) URL.revokeObjectURL(original.url);
      if (cropped) URL.revokeObjectURL(cropped.url);
      return;
    }
    capturingRef.current = false;
    setCapturing(false);
    if (!original) {
      if (cropped) URL.revokeObjectURL(cropped.url);
      setCaptureFailed(true);
      return;
    }
    setCaptureFailed(false);
    setShot({ original, cropped });
    setVersion(cropped ? "cropped" : "original");
    setPhase("review");
  };

  const retake = () => {
    setShot(null);
    setPhase("live");
  };

  const status =
    phase === "starting"
      ? t("projectForm.camera.starting")
      : phase === "live"
        ? capturing
          ? t("projectForm.camera.processing")
          : captureFailed
            ? t("projectForm.camera.captureFailed")
            : quad
              ? t("projectForm.camera.detected")
              : t("projectForm.camera.noDocument")
        : phase === "review" && shot && !shot.cropped
          ? t("projectForm.camera.noCrop")
          : phase === "error" && error
            ? t(errorKey[error])
            : null;

  const selected =
    shot && (version === "original" || !shot.cropped)
      ? shot.original
      : (shot?.cropped ?? null);

  const buttonClass =
    "min-h-11 cursor-pointer border border-white/40 bg-black/40 px-4 py-2 text-sm text-white focus-visible:outline-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-50";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[60] flex flex-col bg-black text-white outline-none"
      ref={rootRef}
      tabIndex={-1}
    >
      <header className="flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <h2 id={titleId} className="text-base font-semibold">
          {t("projectForm.camera.title")}
        </h2>
        <button type="button" className={buttonClass} onClick={onClose}>
          {t("projectForm.camera.close")}
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          aria-hidden="true"
          className={`absolute inset-0 h-full w-full object-contain ${
            phase === "live" || phase === "starting" ? "" : "invisible"
          }`}
          onLoadedMetadata={(event) => {
            const { videoWidth, videoHeight } = event.currentTarget;
            setVideoSize({ width: videoWidth, height: videoHeight });
            setPhase("live");
          }}
        />
        {phase === "live" && quad && videoSize.width ? (
          // Same box and aspect fit as the video, so the outline lands on it.
          <svg
            aria-hidden="true"
            data-testid="document-outline"
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 ${videoSize.width} ${videoSize.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <polygon
              points={quad
                .map(
                  ({ x, y }) =>
                    `${Math.round(x * videoSize.width)},${Math.round(y * videoSize.height)}`,
                )
                .join(" ")}
              fill="rgba(255,255,255,0.08)"
              stroke="white"
              strokeWidth={3}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        ) : null}
        {phase === "live" && stats ? (
          // Detector readout for judging speed on the phone.
          <p
            data-testid="detector-stats"
            className="pointer-events-none absolute top-2 left-2 bg-black/60 px-2 py-1 font-mono text-[11px] leading-tight text-white"
          >
            {stats.modelStatus === "ready"
              ? t("projectForm.camera.stats.model", {
                  backend: stats.backend === "webgpu" ? "WebGPU" : "WASM",
                  download: seconds(stats.load?.downloadMs),
                  session: seconds(stats.load?.sessionMs),
                  warmup: seconds(stats.load?.warmupMs),
                })
              : stats.modelStatus === "loading"
                ? t("projectForm.camera.stats.loading")
                : t("projectForm.camera.stats.unavailable")}
            <br />
            {stats.engine === "model"
              ? t("projectForm.camera.stats.byModel")
              : stats.engine === "modelMiss"
                ? t("projectForm.camera.stats.byFallback")
                : t("projectForm.camera.stats.byClassic")}
            {` · ${stats.fps.toFixed(1)} fps · ${Math.round(stats.latencyMs)} ms`}
            {stats.modelStatus === "ready" && stats.frame ? (
              <>
                <br />
                {t("projectForm.camera.stats.frame", {
                  read: Math.round(stats.frame.readMs),
                  tensor: Math.round(stats.frame.tensorMs),
                  inference: Math.round(stats.frame.inferenceMs),
                  decode: Math.round(stats.frame.decodeMs),
                })}
              </>
            ) : null}
          </p>
        ) : null}
        {phase === "review" && selected ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
          <img
            src={selected.url}
            alt={
              selected === shot?.cropped
                ? t("projectForm.camera.reviewAltCropped")
                : t("projectForm.camera.reviewAlt")
            }
            className="absolute inset-0 h-full w-full object-contain"
          />
        ) : null}
      </div>

      <footer className="grid gap-3 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <p
          role={phase === "error" ? "alert" : "status"}
          aria-live="polite"
          className="min-h-5 text-center text-sm"
        >
          {status}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {phase === "review" ? (
            <>
              {shot?.cropped ? (
                <div
                  role="group"
                  aria-label={t("projectForm.camera.version")}
                  className="flex basis-full justify-center"
                >
                  {(["cropped", "original"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={version === option}
                      className={`min-h-11 cursor-pointer border border-white/40 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-white ${
                        version === option
                          ? "bg-white font-semibold text-black"
                          : "bg-black/40 text-white"
                      }`}
                      onClick={() => setVersion(option)}
                    >
                      {t(`projectForm.camera.version.${option}`)}
                    </button>
                  ))}
                </div>
              ) : null}
              <button type="button" className={buttonClass} onClick={retake}>
                {t("projectForm.camera.retake")}
              </button>
              <button
                type="button"
                className="min-h-11 cursor-pointer bg-white px-4 py-2 text-sm font-semibold text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={() => selected && onCapture(selected.file)}
              >
                {t("projectForm.camera.use")}
              </button>
            </>
          ) : phase === "error" ? (
            <>
              {error !== "unsupported" ? (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => setAttempt((count) => count + 1)}
                >
                  {t("projectForm.camera.retry")}
                </button>
              ) : null}
              <button
                type="button"
                className={buttonClass}
                onClick={onFallback}
              >
                {t("projectForm.camera.fallback")}
              </button>
            </>
          ) : (
            <button
              ref={shutterRef}
              type="button"
              disabled={phase !== "live" || capturing}
              aria-label={t("projectForm.camera.shutter")}
              title={t("projectForm.camera.shutter")}
              className="size-16 cursor-pointer border-4 border-white bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-wait disabled:opacity-50"
              onClick={() => void capture()}
            />
          )}
        </div>
      </footer>
    </div>,
    document.body,
  );
}
