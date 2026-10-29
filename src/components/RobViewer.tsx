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
import { type MessageKey, useT } from "~/i18n";
import { SCENE_THEME, hexToCss } from "~/components/rob-viewer/sceneTheme";
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

const cameraPresetLabelKeys: ReadonlyArray<
  readonly [ViewerCameraPreset, MessageKey]
> = [
  ["top", "components.viewer.presetTop"],
  ["front", "components.viewer.presetFront"],
  ["right-top", "components.viewer.presetRightTop"],
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
    const t = useT();
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
      `px-2 py-1 text-micro font-medium transition ${
        active
          ? "bg-viewport-line text-viewport-ink"
          : "text-viewport-ink/60 hover:bg-viewport-line/60 hover:text-viewport-ink"
      }`;
    const setCalibrationTarget = (target: ViewerTemporaryCalibrationTarget) => {
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
            aria-label={t("components.viewer.toolbar")}
            className="viewer-toolbar border-viewport-line bg-viewport absolute top-2 left-2 z-10 flex max-w-[calc(100%-1rem)] flex-wrap items-center gap-1 border p-1"
          >
            {cameraPresetLabelKeys.map(([preset, labelKey]) => (
              <button
                key={preset}
                type="button"
                aria-pressed={activeCameraPreset === preset}
                onClick={() => applyPreset(preset)}
                className={controlClass(activeCameraPreset === preset)}
              >
                {t(labelKey)}
              </button>
            ))}
            <span
              className="bg-viewport-line mx-0.5 h-4 w-px"
              aria-hidden="true"
            />
            <button
              type="button"
              aria-pressed={topLayerLift > 0}
              disabled={data.layers.length === 0}
              onClick={() =>
                setTopLayerLift((current) =>
                  current > 0 ? 0 : topLiftDistance,
                )
              }
              className={`${controlClass(topLayerLift > 0)} disabled:text-viewport-ink/30 disabled:cursor-not-allowed`}
            >
              {t("components.viewer.liftTopLayer")}
            </button>
            <button
              type="button"
              aria-pressed={labelsVisible}
              onClick={() => setLabelsVisible((current) => !current)}
              className={controlClass(labelsVisible)}
            >
              {t("components.viewer.layerNumbers")}
            </button>
            {temporaryCalibration ? (
              <>
                <span
                  className="bg-viewport-line mx-0.5 h-4 w-px"
                  aria-hidden="true"
                />
                <button
                  type="button"
                  aria-pressed={calibrationEnabled}
                  onClick={() => setCalibrationEnabled((current) => !current)}
                  className={controlClass(calibrationEnabled)}
                >
                  {t("components.calibration.toggle")}
                </button>
              </>
            ) : null}
          </div>
        ) : null}
        {calibrationEnabled && calibrationState ? (
          <section
            aria-label={t("components.calibration.panel")}
            data-testid="temporary-calibration-panel"
            data-calibration-values={calibrationValues}
            className="viewer-calibration border-viewport-line bg-viewport/95 text-viewport-ink absolute bottom-2 left-2 z-20 w-[min(360px,calc(100%-1rem))] border p-2.5 shadow-[0_2px_8px_rgba(0,0,0,0.1)] backdrop-blur"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-viewport-ink text-micro font-semibold">
                  {t("components.calibration.title")}
                </h3>
                <p className="text-micro text-viewport-ink/60 mt-0.5">
                  {t("components.calibration.hint")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCalibrationEnabled(false)}
                className="text-viewport-ink/60 hover:text-viewport-ink text-body px-1 leading-none"
                aria-label={t("components.calibration.close")}
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
                  {target === "pallet"
                    ? t("components.calibration.targetPalletStack")
                    : t("components.calibration.targetPickup")}
                </button>
              ))}
              <span
                className="bg-viewport-line mx-0.5 h-4 w-px"
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
                  {mode === "translate"
                    ? t("components.calibration.modeMove")
                    : t("components.calibration.modeRotate")}
                </button>
              ))}
            </div>

            <div className="border-viewport-line text-micro mt-2 grid grid-cols-[76px_repeat(4,minmax(0,1fr))] gap-x-2 gap-y-1 border-t pt-2 font-mono tabular-nums">
              <span className="text-viewport-ink/50 font-sans">
                {t("components.calibration.object")}
              </span>
              <span className="text-viewport-ink/50 text-right">
                {t("components.calibration.xMm")}
              </span>
              <span className="text-viewport-ink/50 text-right">
                {t("components.calibration.yMm")}
              </span>
              <span className="text-viewport-ink/50 text-right">
                {t("components.calibration.zMm")}
              </span>
              <span className="text-viewport-ink/50 text-right">
                {t("components.calibration.yaw")}
              </span>
              {(
                [
                  [
                    t("components.calibration.pallet"),
                    calibrationState.palletPose,
                    "pallet",
                  ],
                  [
                    t("components.calibration.pickup"),
                    calibrationState.pickupPose,
                    "pickup",
                  ],
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
                    // Active label matches the gizmo colour of that target in the scene.
                    style={
                      calibrationState.activeTarget === target
                        ? {
                            color: hexToCss(
                              target === "pallet"
                                ? SCENE_THEME.calibrationPallet
                                : SCENE_THEME.calibrationPickup,
                            ),
                          }
                        : undefined
                    }
                    className={`text-left font-sans ${
                      calibrationState.activeTarget === target
                        ? ""
                        : "text-viewport-ink/60 hover:text-viewport-ink"
                    }`}
                  >
                    {label}
                  </button>
                  <output className="text-viewport-ink text-right">
                    {formatCalibrationValue(pose.positionMm.x)}
                  </output>
                  <output className="text-viewport-ink text-right">
                    {formatCalibrationValue(pose.positionMm.y)}
                  </output>
                  <output className="text-viewport-ink text-right">
                    {formatCalibrationValue(pose.positionMm.z)}
                  </output>
                  <output className="text-viewport-ink text-right">
                    {formatCalibrationValue(pose.yawDeg)}
                  </output>
                </div>
              ))}
            </div>

            <div className="border-viewport-line mt-2 flex items-center justify-between gap-3 border-t pt-2">
              <span className="text-micro text-viewport-ink/50">
                {t("components.calibration.snapping")}
              </span>
              <button
                type="button"
                onClick={resetCalibration}
                className="text-micro text-viewport-ink/70 hover:text-viewport-ink font-medium"
              >
                {t("components.calibration.resetBoth")}
              </button>
            </div>
          </section>
        ) : null}
      </div>
    );
  },
);

RobViewer.displayName = "RobViewer";
