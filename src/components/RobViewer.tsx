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
  ViewerScenePose,
  ViewerTemporaryCalibrationConfig,
  ViewerTemporaryCalibrationState,
  ViewerTemporaryCalibrationTarget,
} from "~/components/rob-viewer/viewerTypes";
import { palletLayerToPatternPreview } from "~/lib/previewAdapters";

export type { BoxSelection } from "~/components/rob-viewer/viewerTypes";
export type {
  RobViewerHandle,
  RobViewerReportCaptureResult,
  ViewerCameraPreset,
  ViewerEquipmentConfig,
  ViewerRobotCellAssetConfig,
  ViewerSceneCalibrationConfig,
  ViewerScenePose,
  ViewerSimulationPackage,
  ViewerSimulationState,
  ViewerTemporaryCalibrationConfig,
  ViewerTemporaryCalibrationState,
} from "~/components/rob-viewer/viewerTypes";

function nonNegative(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clonePose(pose: ViewerScenePose): ViewerScenePose {
  return {
    positionMm: { ...pose.positionMm },
    yawDeg: pose.yawDeg,
  };
}

function createCalibrationState(
  config: ViewerTemporaryCalibrationConfig,
): ViewerTemporaryCalibrationState {
  return {
    activeTarget: "pallet",
    mode: "translate",
    palletPose: clonePose(config.palletPose),
    pickupPose: clonePose(config.pickupPose),
  };
}

function formatCalibrationValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
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
      liftCarriageMm,
      simulationPose,
      simulationState,
      sceneCalibration,
      temporaryCalibration,
      onBoxSelect,
    },
    ref,
  ) {
    const mountRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<ViewerSceneController | null>(null);
    const onBoxSelectRef = useRef(onBoxSelect);
    const temporaryCalibrationRef = useRef(temporaryCalibration);
    const onTemporaryCalibrationChangeRef = useRef<
      | ((
          target: ViewerTemporaryCalibrationTarget,
          pose: ViewerScenePose,
        ) => void)
      | undefined
    >(undefined);
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
    const [calibrationEnabled, setCalibrationEnabled] = useState(false);
    const [calibrationState, setCalibrationState] =
      useState<ViewerTemporaryCalibrationState | null>(() =>
        temporaryCalibration
          ? createCalibrationState(temporaryCalibration)
          : null,
      );
    onBoxSelectRef.current = onBoxSelect;
    temporaryCalibrationRef.current = temporaryCalibration;
    onTemporaryCalibrationChangeRef.current = (target, pose) => {
      setCalibrationState((current) => {
        if (!current) return current;
        return target === "pallet"
          ? { ...current, palletPose: clonePose(pose) }
          : { ...current, pickupPose: clonePose(pose) };
      });
    };
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

    const calibrationResetKey = temporaryCalibration?.resetKey ?? null;
    useEffect(() => {
      const config = temporaryCalibrationRef.current;
      setCalibrationEnabled(false);
      setCalibrationState(config ? createCalibrationState(config) : null);
    }, [calibrationResetKey]);

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
        ...(sceneCalibration
          ? { palletPose: sceneCalibration.palletPose }
          : {}),
        ...(equipment ? { equipment } : {}),
      }),
      [equipment, labelsVisible, layerOffsetsZMm, sceneCalibration],
    );

    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      const controller = createViewerSceneController({
        container,
        getOnBoxSelect: () => onBoxSelectRef.current,
        getOnTemporaryCalibrationChange: () =>
          onTemporaryCalibrationChangeRef.current,
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
      controllerRef.current?.setLiftCarriageMm(liftCarriageMm ?? null);
    }, [liftCarriageMm]);

    useEffect(() => {
      controllerRef.current?.setSimulationPose(simulationPose ?? null);
    }, [simulationPose]);

    useEffect(() => {
      controllerRef.current?.setSimulationState(simulationState ?? null);
    }, [simulationState]);

    useEffect(() => {
      controllerRef.current?.setTemporaryCalibration(
        calibrationEnabled ? calibrationState : null,
      );
    }, [calibrationEnabled, calibrationState]);

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
      `cursor-pointer rounded px-2 py-1 text-[11px] font-medium transition ${
        active
          ? "bg-zinc-700 text-zinc-100"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
      }`;
    const setCalibrationTarget = (
      target: ViewerTemporaryCalibrationTarget,
    ) => {
      setCalibrationState((current) =>
        current ? { ...current, activeTarget: target } : current,
      );
    };
    const resetCalibration = () => {
      const config = temporaryCalibrationRef.current;
      if (!config) return;
      setCalibrationState(createCalibrationState(config));
    };
    const calibrationValues = calibrationState
      ? JSON.stringify({
          pallet: calibrationState.palletPose,
          pickup: calibrationState.pickupPose,
        })
      : undefined;

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
            {temporaryCalibration ? (
              <>
                <span
                  className="mx-0.5 h-4 w-px bg-zinc-800"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  aria-pressed={calibrationEnabled}
                  onClick={() => setCalibrationEnabled((current) => !current)}
                  className={controlClass(calibrationEnabled)}
                >
                  Calibrate
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {calibrationEnabled && calibrationState ? (
          <section
            aria-label="Temporary 3D calibration"
            data-testid="temporary-calibration-panel"
            data-calibration-values={calibrationValues}
            className="absolute bottom-2 left-2 z-20 w-[min(360px,calc(100%-1rem))] border border-amber-400/40 bg-zinc-950/95 p-2.5 text-zinc-200 shadow-2xl backdrop-blur"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-amber-300">
                  Temporary calibration
                </h3>
                <p className="mt-0.5 text-[10px] text-zinc-500">
                  Drag the 3D axes. Values are not saved.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCalibrationEnabled(false)}
                className="cursor-pointer px-1 text-sm leading-none text-zinc-500 hover:text-zinc-200"
                aria-label="Close calibration"
              >
                ×
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1">
              {(["pallet", "pickup"] as const).map((target) => (
                <button
                  key={target}
                  type="button"
                  aria-pressed={calibrationState.activeTarget === target}
                  onClick={() => setCalibrationTarget(target)}
                  className={controlClass(
                    calibrationState.activeTarget === target,
                  )}
                >
                  {target === "pallet" ? "Pallet + stack" : "Pickup"}
                </button>
              ))}
              <span
                className="mx-0.5 h-4 w-px bg-zinc-800"
                aria-hidden="true"
              />
              {(["translate", "rotate"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={calibrationState.mode === mode}
                  onClick={() =>
                    setCalibrationState((current) =>
                      current ? { ...current, mode } : current,
                    )
                  }
                  className={controlClass(calibrationState.mode === mode)}
                >
                  {mode === "translate" ? "Move" : "Rotate Z"}
                </button>
              ))}
            </div>

            <div className="mt-2 grid grid-cols-[76px_repeat(4,minmax(0,1fr))] gap-x-2 gap-y-1 border-t border-zinc-800 pt-2 font-mono text-[10px] tabular-nums">
              <span className="font-sans text-zinc-600">Object</span>
              <span className="text-right text-zinc-600">X mm</span>
              <span className="text-right text-zinc-600">Y mm</span>
              <span className="text-right text-zinc-600">Z mm</span>
              <span className="text-right text-zinc-600">Yaw°</span>
              {(
                [
                  ["Pallet", calibrationState.palletPose, "pallet"],
                  ["Pickup", calibrationState.pickupPose, "pickup"],
                ] as const
              ).map(([label, pose, target]) => (
                <div
                  key={target}
                  className="contents"
                  data-calibration-target={target}
                >
                  <button
                    type="button"
                    onClick={() => setCalibrationTarget(target)}
                    className={`cursor-pointer text-left font-sans ${
                      calibrationState.activeTarget === target
                        ? target === "pallet"
                          ? "text-amber-300"
                          : "text-cyan-300"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    {label}
                  </button>
                  <output className="text-right text-zinc-200">
                    {formatCalibrationValue(pose.positionMm.x)}
                  </output>
                  <output className="text-right text-zinc-200">
                    {formatCalibrationValue(pose.positionMm.y)}
                  </output>
                  <output className="text-right text-zinc-200">
                    {formatCalibrationValue(pose.positionMm.z)}
                  </output>
                  <output className="text-right text-zinc-200">
                    {formatCalibrationValue(pose.yawDeg)}
                  </output>
                </div>
              ))}
            </div>

            <div className="mt-2 flex items-center justify-between gap-3 border-t border-zinc-800 pt-2">
              <span className="text-[10px] text-zinc-600">
                1 mm / 1° snapping
              </span>
              <button
                type="button"
                onClick={resetCalibration}
                className="cursor-pointer text-[10px] font-medium text-zinc-400 hover:text-zinc-100"
              >
                Reset both
              </button>
            </div>
          </section>
        ) : null}
      </div>
    );
  },
);

RobViewer.displayName = "RobViewer";
