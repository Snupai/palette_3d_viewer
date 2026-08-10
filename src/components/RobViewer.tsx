"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createViewerSceneController,
  type ViewerSceneController,
} from "~/components/rob-viewer/sceneController";
import type {
  RobViewerHandle,
  RobViewerProps,
  ViewerCameraPreset,
  ViewerCaptureResult,
} from "~/components/rob-viewer/viewerTypes";
import { palletLayerToPatternPreview } from "~/lib/previewAdapters";

export type { BoxSelection } from "~/components/rob-viewer/viewerTypes";
export type {
  RobViewerHandle,
  RobViewerReportCaptureResult,
  ViewerCameraPreset,
  ViewerEquipmentConfig,
  ViewerScenePose,
} from "~/components/rob-viewer/viewerTypes";

function nonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function unavailableCapture(): ViewerCaptureResult {
  return {
    status: "fallback",
    reason: "viewer-unavailable",
    fallback: "layer-pattern-svg",
    message:
      "The 3D viewer is not ready; render the supplied layer-pattern SVG instead.",
  };
}

const cameraPresetLabels: ReadonlyArray<readonly [ViewerCameraPreset, string]> =
  [
    ["top", "Top"],
    ["front", "Front"],
    ["right-top", "Right top"],
  ];

export const RobViewer = forwardRef<RobViewerHandle, RobViewerProps>(
  function RobViewer(
    {
      data,
      cameraResetKey,
      cameraPreset,
      visibleUpToLayer,
      liftTopLayerMm,
      showLayerLabels,
      showSceneControls = true,
      equipment,
      simulationPose,
      onBoxSelect,
    },
    ref,
  ) {
    const mountRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<ViewerSceneController | null>(null);
    const onBoxSelectRef = useRef(onBoxSelect);
    const dataRef = useRef(data);
    const visibleUpToLayerRef = useRef(visibleUpToLayer);
    const cameraResetKeyRef = useRef(cameraResetKey);
    const resetOnNextDataRef = useRef(false);
    const [activeCameraPreset, setActiveCameraPreset] =
      useState<ViewerCameraPreset | null>(cameraPreset ?? null);
    const [topLayerLift, setTopLayerLift] = useState(() =>
      nonNegative(liftTopLayerMm),
    );
    const [labelsVisible, setLabelsVisible] = useState(
      showLayerLabels ?? false,
    );
    onBoxSelectRef.current = onBoxSelect;
    dataRef.current = data;
    visibleUpToLayerRef.current = visibleUpToLayer;

    useEffect(() => {
      if (liftTopLayerMm === undefined) return;
      setTopLayerLift(nonNegative(liftTopLayerMm));
    }, [liftTopLayerMm]);

    useEffect(() => {
      if (showLayerLabels === undefined) return;
      setLabelsVisible(showLayerLabels);
    }, [showLayerLabels]);

    const layerOffsetsZMm = useMemo(() => {
      const offsets = data.layers.map(() => 0);
      if (offsets.length > 0 && topLayerLift > 0) {
        offsets[offsets.length - 1] = topLayerLift;
      }
      return offsets;
    }, [data.layers, topLayerLift]);

    const sceneOptions = useMemo(
      () => ({
        layerOffsetsZMm,
        showLayerLabels: labelsVisible,
        ...(equipment ? { equipment } : {}),
      }),
      [equipment, labelsVisible, layerOffsetsZMm],
    );

    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      const controller = createViewerSceneController({
        container,
        getOnBoxSelect: () => onBoxSelectRef.current,
      });
      controllerRef.current = controller;

      return () => {
        controllerRef.current = null;
        controller.dispose();
      };
    }, []);

    useEffect(() => {
      if (cameraResetKeyRef.current === cameraResetKey) return;
      cameraResetKeyRef.current = cameraResetKey;
      resetOnNextDataRef.current = true;
      setActiveCameraPreset(null);
    }, [cameraResetKey]);

    useEffect(() => {
      const resetView = resetOnNextDataRef.current;
      resetOnNextDataRef.current = false;
      controllerRef.current?.setData(data, {
        preserveView: !resetView,
        sceneOptions,
      });
    }, [data, sceneOptions]);

    useEffect(() => {
      controllerRef.current?.setVisibleUpToLayer(visibleUpToLayer);
    }, [visibleUpToLayer]);

    useEffect(() => {
      controllerRef.current?.setSimulationPose(simulationPose ?? null);
    }, [simulationPose]);

    useEffect(() => {
      if (!cameraPreset) return;
      setActiveCameraPreset(cameraPreset);
      controllerRef.current?.setCameraPreset(cameraPreset);
    }, [cameraPreset]);

    const applyPreset = (preset: ViewerCameraPreset) => {
      setActiveCameraPreset(preset);
      controllerRef.current?.setCameraPreset(preset);
    };

    useImperativeHandle(
      ref,
      () => ({
        setCameraPreset: applyPreset,
        async captureReportFrame(options = {}) {
          const capture =
            controllerRef.current?.captureReportFrame(options) ??
            unavailableCapture();
          if (capture.status === "captured") return capture;
          const fallbackLayerIndex = Math.max(
            0,
            Math.min(
              dataRef.current.layers.length - 1,
              options.fallbackLayerIndex ?? visibleUpToLayerRef.current - 1,
            ),
          );
          let layerPattern = null;
          try {
            layerPattern = palletLayerToPatternPreview(
              dataRef.current,
              fallbackLayerIndex,
            );
          } catch {
            // Empty plans have no 2D fallback layer.
          }
          return { ...capture, layerPattern };
        },
      }),
      [],
    );

    const topLiftDistance = Math.max(150, data.package.height);
    const controlClass = (active: boolean) =>
      `rounded px-2 py-1 text-[11px] font-medium transition ${
        active
          ? "bg-zinc-700 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`;

    return (
      <div className="relative h-full min-h-[320px] w-full sm:min-h-[420px] xl:min-h-[600px]">
        <div ref={mountRef} className="absolute inset-0" />
        {showSceneControls ? (
          <div
            role="toolbar"
            aria-label="3D view controls"
            className="absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 rounded-md border border-zinc-800 bg-zinc-950 p-1"
          >
            {cameraPresetLabels.map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                aria-pressed={activeCameraPreset === preset}
                onClick={() => applyPreset(preset)}
                className={controlClass(activeCameraPreset === preset)}
              >
                {label}
              </button>
            ))}
            <span className="mx-0.5 h-4 w-px bg-zinc-800" aria-hidden="true" />
            <button
              type="button"
              aria-pressed={topLayerLift > 0}
              disabled={data.layers.length === 0}
              onClick={() =>
                setTopLayerLift((current) =>
                  current > 0 ? 0 : topLiftDistance,
                )
              }
              className={`${controlClass(topLayerLift > 0)} disabled:cursor-not-allowed disabled:text-zinc-700`}
            >
              Lift top
            </button>
            <button
              type="button"
              aria-pressed={labelsVisible}
              onClick={() => setLabelsVisible((current) => !current)}
              className={controlClass(labelsVisible)}
            >
              Labels
            </button>
          </div>
        ) : null}
      </div>
    );
  },
);

RobViewer.displayName = "RobViewer";
