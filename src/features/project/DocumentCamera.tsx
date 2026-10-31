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
  trackQuad,
  type CameraErrorKind,
  type DocumentQuad,
} from "~/features/project/documentCameraModel";

export type DocumentCameraProps = {
  onCapture: (file: File) => void;
  onClose: () => void;
  /** Opens the phone's own camera app when the live preview is unavailable. */
  onFallback: () => void;
};

type Phase = "starting" | "live" | "review" | "error";

const DETECTION_INTERVAL_MS = 100;

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
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);

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
    const canvas = document.createElement("canvas");
    canvas.width = DETECTION_WIDTH;
    canvas.height = Math.max(
      1,
      Math.round((DETECTION_WIDTH * videoSize.height) / videoSize.width),
    );
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    let tracker = initialQuadTracker;
    const timer = window.setInterval(() => {
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      tracker = trackQuad(
        tracker,
        detectDocumentQuad(rgbaToLuminance(data), canvas.width, canvas.height),
      );
      setQuad(tracker.quad);
    }, DETECTION_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      setQuad(null);
    };
  }, [phase, videoSize]);

  useEffect(
    () => () => {
      if (shot) URL.revokeObjectURL(shot.url);
    },
    [shot],
  );

  const capture = () => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setCaptureFailed(true);
      return;
    }
    context.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCaptureFailed(true);
          return;
        }
        const file = new File([blob], `palettenblatt-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        setCaptureFailed(false);
        setShot({ file, url: URL.createObjectURL(file) });
        setPhase("review");
      },
      "image/jpeg",
      0.92,
    );
  };

  const retake = () => {
    setShot(null);
    setPhase("live");
  };

  const status =
    phase === "starting"
      ? t("projectForm.camera.starting")
      : phase === "live"
        ? captureFailed
          ? t("projectForm.camera.captureFailed")
          : quad
            ? t("projectForm.camera.detected")
            : t("projectForm.camera.noDocument")
        : phase === "error" && error
          ? t(errorKey[error])
          : null;

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
        {phase === "review" && shot ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
          <img
            src={shot.url}
            alt={t("projectForm.camera.reviewAlt")}
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
              <button type="button" className={buttonClass} onClick={retake}>
                {t("projectForm.camera.retake")}
              </button>
              <button
                type="button"
                className="min-h-11 cursor-pointer bg-white px-4 py-2 text-sm font-semibold text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                onClick={() => shot && onCapture(shot.file)}
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
              disabled={phase !== "live"}
              aria-label={t("projectForm.camera.shutter")}
              title={t("projectForm.camera.shutter")}
              className="size-16 cursor-pointer border-4 border-white bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white disabled:cursor-wait disabled:opacity-50"
              onClick={capture}
            />
          )}
        </div>
      </footer>
    </div>,
    document.body,
  );
}
