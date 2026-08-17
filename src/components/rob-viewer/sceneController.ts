import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PalletData } from "~/domain/palletTypes";
import { applyCameraPreset } from "~/components/rob-viewer/cameraPresets";
import {
  loadGripperModel,
  type LoadedGripperModel,
} from "~/components/rob-viewer/gripperLoader";
import {
  loadBundledRobotCell,
  type LoadedRobotCell,
} from "~/components/rob-viewer/robotCellLoader";
import { buildViewerScene } from "~/components/rob-viewer/sceneBuilder";
import {
  createViewerCalibrationOverlay,
  type ViewerCalibrationOverlay,
} from "~/components/rob-viewer/sceneCalibrationOverlay";
import {
  createViewerEquipment,
  type ViewerEquipmentController,
} from "~/components/rob-viewer/sceneEquipment";
import {
  createViewerHighlighter,
  type ViewerHighlighter,
} from "~/components/rob-viewer/sceneHighlight";
import {
  gripEntriesFor,
  isClickGesture,
  pickViewerEntry,
  toBoxSelection,
  type PointerPosition,
} from "~/components/rob-viewer/scenePicking";
import {
  applyLayerVisibility,
  isPickEntryVisible,
} from "~/components/rob-viewer/sceneVisibility";
import {
  createViewerAnimationLoop,
  type ViewerAnimationLoop,
  type ViewerAnimationLoopOptions,
} from "~/components/rob-viewer/viewerAnimationLoop";
import type {
  BoxPickEntry,
  BoxSelection,
  BuiltViewerScene,
  ViewerCameraPreset,
  ViewerCaptureOptions,
  ViewerCaptureResult,
  ViewerRobotCellAssetConfig,
  ViewerSceneOptions,
  ViewerScenePose,
  ViewerSimulationState,
  ViewerTemporaryCalibrationState,
  ViewerTemporaryCalibrationTarget,
} from "~/components/rob-viewer/viewerTypes";

const GRIPPER_MODEL_PATH = "/models/gripper/";
const GRIPPER_OBJ = "10_01_43_00016.obj";
const GRIPPER_MTL = "10_01_43_00016.mtl";

export type ViewerRenderer = {
  domElement: HTMLCanvasElement;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(value: number): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
};

export type ViewerControls = {
  enabled: boolean;
  enableDamping: boolean;
  dampingFactor: number;
  screenSpacePanning: boolean;
  maxDistance: number;
  target: THREE.Vector3;
  update(): void;
  dispose(): void;
};

export type ViewerResizeObserver = {
  observe(target: Element): void;
  disconnect(): void;
};

export type ViewerWindow = {
  readonly devicePixelRatio: number;
  addEventListener(type: "resize", listener: EventListener): void;
  removeEventListener(type: "resize", listener: EventListener): void;
};

export type ViewerSceneControllerDependencies = {
  createRenderer: () => ViewerRenderer;
  createControls: (
    camera: THREE.PerspectiveCamera,
    element: HTMLElement,
  ) => ViewerControls;
  buildScene: (
    scene: THREE.Scene,
    data: PalletData,
    options?: ViewerSceneOptions,
  ) => BuiltViewerScene;
  createEquipment: (
    scene: THREE.Scene,
    config: NonNullable<ViewerSceneOptions["equipment"]>,
  ) => ViewerEquipmentController;
  createHighlighter: (options: {
    scene: THREE.Scene;
    packageLength: number;
  }) => ViewerHighlighter;
  createAnimationLoop: (
    options: ViewerAnimationLoopOptions,
  ) => ViewerAnimationLoop;
  loadGripper: typeof loadGripperModel;
  loadRobotCell: typeof loadBundledRobotCell;
  createResizeObserver: (
    callback: ResizeObserverCallback,
  ) => ViewerResizeObserver;
  window: ViewerWindow;
};

export type ViewerSceneController = {
  setData(
    data: PalletData,
    options?: { preserveView?: boolean; sceneOptions?: ViewerSceneOptions },
  ): void;
  setVisibleUpToLayer(visibleUpToLayer: number): void;
  setLiftCarriageMm(value: number | null): void;
  setSimulationPose(pose: ViewerScenePose | null): void;
  setSimulationState(state: ViewerSimulationState | null): void;
  setTemporaryCalibration(state: ViewerTemporaryCalibrationState | null): void;
  setCameraPreset(preset: ViewerCameraPreset): void;
  captureReportFrame(options?: ViewerCaptureOptions): ViewerCaptureResult;
  dispose(): void;
};

type ViewerRuntime = {
  setData(
    data: PalletData,
    preserveView: boolean,
    sceneOptions: ViewerSceneOptions,
  ): void;
  setVisibleUpToLayer(visibleUpToLayer: number): void;
  setLiftCarriageMm(value: number | null): void;
  setSimulationPose(pose: ViewerScenePose | null): void;
  setSimulationState(state: ViewerSimulationState | null): void;
  setTemporaryCalibration(state: ViewerTemporaryCalibrationState | null): void;
  setCameraPreset(preset: ViewerCameraPreset): void;
  captureReportFrame(options?: ViewerCaptureOptions): ViewerCaptureResult;
  dispose(): void;
};

function combinedViewerBounds(
  sceneBuild: BuiltViewerScene | null,
  equipment: ViewerEquipmentController | null,
): THREE.Box3 | null {
  const bounds = new THREE.Box3();
  let hasBounds = false;
  if (sceneBuild?.bounds && !sceneBuild.bounds.isEmpty()) {
    bounds.union(sceneBuild.bounds);
    hasBounds = true;
  }
  const equipmentBounds = equipment?.getBounds() ?? null;
  if (equipmentBounds && !equipmentBounds.isEmpty()) {
    bounds.union(equipmentBounds);
    hasBounds = true;
  }
  return hasBounds ? bounds : null;
}

function captureFallback(
  reason: Extract<ViewerCaptureResult, { status: "fallback" }>["reason"],
  message: string,
): ViewerCaptureResult {
  return {
    status: "fallback",
    reason,
    fallback: "layer-pattern-svg",
    message,
  };
}

function captureDimension(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(4096, Math.round(value)));
}

function defaultResizeObserverFactory(
  container: HTMLElement,
): ViewerSceneControllerDependencies["createResizeObserver"] | null {
  const ResizeObserverConstructor =
    container.ownerDocument.defaultView?.ResizeObserver ??
    globalThis.ResizeObserver;
  return typeof ResizeObserverConstructor === "function"
    ? (callback) => new ResizeObserverConstructor(callback)
    : null;
}

export function createViewerSceneController({
  container,
  getOnBoxSelect,
  getOnTemporaryCalibrationChange = () => undefined,
  dependencies = {},
}: {
  container: HTMLElement;
  getOnBoxSelect: () => ((selection: BoxSelection | null) => void) | undefined;
  getOnTemporaryCalibrationChange?: () =>
    | ((
        target: ViewerTemporaryCalibrationTarget,
        pose: ViewerScenePose,
      ) => void)
    | undefined;
  dependencies?: Partial<ViewerSceneControllerDependencies>;
}): ViewerSceneController {
  const browserWindow =
    dependencies.window ?? container.ownerDocument.defaultView;
  if (!browserWindow) {
    throw new Error("Viewer window is unavailable");
  }

  const createRenderer =
    dependencies.createRenderer ??
    (() => new THREE.WebGLRenderer({ antialias: true }));
  const createControls =
    dependencies.createControls ??
    ((camera: THREE.PerspectiveCamera, element: HTMLElement) =>
      new OrbitControls(camera, element));
  const buildScene = dependencies.buildScene ?? buildViewerScene;
  const createEquipment =
    dependencies.createEquipment ??
    ((
      scene: THREE.Scene,
      config: NonNullable<ViewerSceneOptions["equipment"]>,
    ) => createViewerEquipment(scene, config));
  const createHighlighter =
    dependencies.createHighlighter ?? createViewerHighlighter;
  const createAnimationLoop =
    dependencies.createAnimationLoop ?? createViewerAnimationLoop;
  const loadGripper = dependencies.loadGripper ?? loadGripperModel;
  const loadRobotCell = dependencies.loadRobotCell ?? loadBundledRobotCell;
  const createResizeObserver =
    dependencies.createResizeObserver ??
    defaultResizeObserverFactory(container);

  let runtime: ViewerRuntime | null = null;
  let visibleUpToLayer = 1;
  let sceneOptions: ViewerSceneOptions = {};
  let liftCarriageMm: number | null = 0;
  let simulationPose: ViewerScenePose | null = null;
  let simulationState: ViewerSimulationState | null = null;
  let temporaryCalibration: ViewerTemporaryCalibrationState | null = null;
  let disposed = false;

  const emitSelection = (selection: BoxSelection | null) => {
    getOnBoxSelect()?.(selection);
  };

  const disposeRuntime = () => {
    runtime?.dispose();
    runtime = null;
  };

  const createRuntime = (data: PalletData): ViewerRuntime => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101013);

    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      1,
      10000,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(1400, 1000, 1400);
    camera.lookAt(new THREE.Vector3(600, 400, 300));

    const renderer = createRenderer();
    const displayPixelRatio = Math.min(browserWindow.devicePixelRatio, 2);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(displayPixelRatio);
    renderer.setClearColor(0x101013, 1);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    let currentData = data;
    let sceneBuild: BuiltViewerScene | null = null;
    let highlighter: ViewerHighlighter | null = null;
    let controls: ViewerControls | null = null;
    let animationLoop: ViewerAnimationLoop | null = null;
    let resizeObserver: ViewerResizeObserver | null = null;
    let loadedGripper: LoadedGripperModel | null = null;
    let loadedRobotCell: LoadedRobotCell | null = null;
    let robotCellAbortController: AbortController | null = null;
    let robotCellLoadKey: string | null = null;
    let robotCellRequest = 0;
    let equipment: ViewerEquipmentController | null = null;
    let calibrationOverlay: ViewerCalibrationOverlay | null = null;
    let runtimeDisposed = false;
    let pointerDown: PointerPosition | null = null;
    let selectedEntry: BoxPickEntry | null = null;
    let maxVisibleLayer = 1;
    let visibleCenterZ: number | null = null;
    let resizeListenerAttached = false;
    let pointerListenersAttached = false;
    const gripperAbortController = new AbortController();

    const onResize = () => {
      if (runtimeDisposed) return;
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
      animationLoop?.requestRender();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (temporaryCalibration) {
        pointerDown = null;
        return;
      }
      pointerDown = { x: event.clientX, y: event.clientY };
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerUp = (event: PointerEvent) => {
      if (temporaryCalibration) {
        pointerDown = null;
        return;
      }
      if (!pointerDown || !sceneBuild || !highlighter) return;
      const pointerUp = { x: event.clientX, y: event.clientY };
      const startedAt = pointerDown;
      pointerDown = null;
      if (!isClickGesture(startedAt, pointerUp)) return;

      const entry = pickViewerEntry({
        clientX: event.clientX,
        clientY: event.clientY,
        element: renderer.domElement,
        camera,
        raycaster,
        pointer,
        layerRenders: sceneBuild.layerRenders,
      });
      if (!entry) {
        selectedEntry = null;
        highlighter.clear();
        emitSelection(null);
        return;
      }

      selectedEntry = entry;
      const gripEntries = gripEntriesFor(sceneBuild.pickEntries, entry);
      highlighter.show(entry, gripEntries, maxVisibleLayer);
      emitSelection(toBoxSelection(entry, gripEntries));
    };

    const updateLayerLabelFacing = () => {
      if (!sceneBuild) return;
      for (const label of sceneBuild.layerLabels) {
        label.object.quaternion.copy(camera.quaternion);
      }
    };

    const setCameraPreset = (preset: ViewerCameraPreset) => {
      if (!controls) return;
      applyCameraPreset(
        camera,
        controls,
        combinedViewerBounds(sceneBuild, equipment),
        preset,
      );
      updateLayerLabelFacing();
      animationLoop?.requestRender();
    };

    // Top face Z of the highest visible box, from pick entries (no mesh traversal).
    const visibleStackTopZ = (): number | null => {
      if (!sceneBuild) return null;
      let top = Number.NEGATIVE_INFINITY;
      for (const layer of sceneBuild.layerRenders) {
        if (layer.layerNum + 1 > maxVisibleLayer) continue;
        for (const entry of layer.pickEntries) {
          top = Math.max(top, entry.zBottom + entry.height);
        }
      }
      return Number.isFinite(top) ? top : null;
    };

    // Keep the orbit centered on the visible part of the stack: when layers are
    // hidden, shift camera and target down together so zooming in still frames
    // the remaining boxes instead of the empty space above them.
    const recenterOnVisibleStack = () => {
      if (!sceneBuild?.bounds || sceneBuild.bounds.isEmpty()) return;
      const top = visibleStackTopZ();
      if (top === null) return;
      const nextCenterZ = (sceneBuild.bounds.min.z + top) / 2;
      if (visibleCenterZ !== null && controls) {
        const deltaZ = nextCenterZ - visibleCenterZ;
        if (deltaZ !== 0) {
          controls.target.z += deltaZ;
          camera.position.z += deltaZ;
          controls.update();
          animationLoop?.requestRender();
        }
      }
      visibleCenterZ = nextCenterZ;
    };

    const syncRobotCell = (config: ViewerRobotCellAssetConfig | null) => {
      const nextLoadKey = config
        ? `${config.assetUrl}@${config.revision}`
        : null;
      if (nextLoadKey === robotCellLoadKey) return;

      robotCellLoadKey = nextLoadKey;
      robotCellRequest += 1;
      const request = robotCellRequest;
      robotCellAbortController?.abort();
      robotCellAbortController = null;
      equipment?.setRobotCell(null);
      loadedRobotCell?.dispose();
      loadedRobotCell = null;

      if (!config) {
        animationLoop?.requestRender();
        return;
      }

      const abortController = new AbortController();
      robotCellAbortController = abortController;
      void loadRobotCell({ config, signal: abortController.signal })
        .then((loaded) => {
          if (
            runtimeDisposed ||
            abortController.signal.aborted ||
            request !== robotCellRequest
          ) {
            loaded.dispose();
            return;
          }
          robotCellAbortController = null;
          loadedRobotCell = loaded;
          loaded.setLiftCarriageMm(liftCarriageMm);
          equipment?.setRobotCell(loaded.root);
          animationLoop?.requestRender();
        })
        .catch(() => {
          if (request === robotCellRequest) {
            robotCellAbortController = null;
          }
        });
    };

    const syncTemporaryCalibration = (
      state: ViewerTemporaryCalibrationState | null,
    ) => {
      if (!state) {
        calibrationOverlay?.dispose();
        calibrationOverlay = null;
        if (controls) controls.enabled = true;
        animationLoop?.requestRender();
        return;
      }
      if (!sceneBuild) return;
      calibrationOverlay ??= createViewerCalibrationOverlay({
          scene,
          camera,
          domElement: renderer.domElement,
          palletObject: sceneBuild.root,
          packageDimensionsMm: currentData.package,
          onPoseChange: (target, pose) => {
            getOnTemporaryCalibrationChange()?.(target, pose);
          },
          onDraggingChange: (dragging) => {
            if (controls) controls.enabled = !dragging;
            pointerDown = null;
          },
        requestRender: () => animationLoop?.requestRender(),
      });
      pointerDown = null;
      if (selectedEntry) {
        selectedEntry = null;
        highlighter?.clear();
        emitSelection(null);
      }
      calibrationOverlay.setState(state);
    };

    const updateVisibility = (nextVisibleUpToLayer: number) => {
      if (!sceneBuild || !highlighter) return;
      maxVisibleLayer = applyLayerVisibility({
        layerRenders: sceneBuild.layerRenders,
        interlayerRenders: sceneBuild.interlayerRenders,
        layerLabels: sceneBuild.layerLabels,
        visibleUpToLayer: nextVisibleUpToLayer,
        layerCount: currentData.layers.length,
      });
      sceneBuild.setSimulationState(simulationState);
      recenterOnVisibleStack();

      if (selectedEntry && isPickEntryVisible(selectedEntry, maxVisibleLayer)) {
        highlighter.show(
          selectedEntry,
          gripEntriesFor(sceneBuild.pickEntries, selectedEntry),
          maxVisibleLayer,
        );
      } else if (selectedEntry) {
        selectedEntry = null;
        highlighter.clear();
        emitSelection(null);
      } else {
        highlighter.clear();
      }
    };

    const replaceSceneData = (
      nextData: PalletData,
      preserveView: boolean,
      nextSceneOptions: ViewerSceneOptions,
    ) => {
      const nextSceneBuild = buildScene(scene, nextData, nextSceneOptions);
      let nextHighlighter: ViewerHighlighter | null = null;
      try {
        nextHighlighter = createHighlighter({
          scene,
          packageLength: nextData.package.length,
        });
        equipment?.setConfig(nextSceneOptions.equipment ?? {});
        equipment?.setSimulationPose(simulationPose);
        syncRobotCell(nextSceneOptions.equipment?.robotCell ?? null);
      } catch (error) {
        nextHighlighter?.dispose();
        nextSceneBuild.dispose();
        throw error;
      }

      if (!nextHighlighter) {
        nextSceneBuild.dispose();
        throw new Error("Viewer highlighter was not created.");
      }

      calibrationOverlay?.dispose();
      calibrationOverlay = null;
      highlighter?.dispose();
      sceneBuild?.dispose();
      currentData = nextData;
      sceneBuild = nextSceneBuild;
      highlighter = nextHighlighter;
      pointerDown = null;
      selectedEntry = null;
      maxVisibleLayer = 1;
      visibleCenterZ = null;

      if (loadedGripper) {
        highlighter.setGripperModel(loadedGripper.model);
        equipment?.setGripperModel(loadedGripper.model);
      }
      updateVisibility(visibleUpToLayer);

      if (!preserveView && controls) {
        const { center } = applyCameraPreset(
          camera,
          controls,
          combinedViewerBounds(sceneBuild, equipment),
          "right-top",
        );
        if (visibleCenterZ !== null) {
          const deltaZ = visibleCenterZ - center.z;
          controls.target.z += deltaZ;
          camera.position.z += deltaZ;
          controls.update();
        }
      }

      updateLayerLabelFacing();
      syncTemporaryCalibration(temporaryCalibration);
      emitSelection(null);
      animationLoop?.requestRender();
    };

    const cleanup = () => {
      if (runtimeDisposed) return;
      runtimeDisposed = true;
      gripperAbortController.abort();
      robotCellRequest += 1;
      robotCellAbortController?.abort();
      robotCellAbortController = null;
      animationLoop?.stop();
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (resizeListenerAttached) {
        browserWindow.removeEventListener("resize", onResize);
        resizeListenerAttached = false;
      }
      if (pointerListenersAttached) {
        renderer.domElement.removeEventListener("pointerdown", onPointerDown);
        renderer.domElement.removeEventListener("pointerup", onPointerUp);
        pointerListenersAttached = false;
      }
      pointerDown = null;
      selectedEntry = null;
      calibrationOverlay?.dispose();
      calibrationOverlay = null;
      highlighter?.dispose();
      highlighter = null;
      equipment?.setRobotCell(null);
      equipment?.dispose();
      equipment = null;
      loadedRobotCell?.dispose();
      loadedRobotCell = null;
      loadedGripper?.dispose();
      loadedGripper = null;
      sceneBuild?.dispose();
      sceneBuild = null;
      renderer.dispose();
      renderer.domElement.parentElement?.removeChild(renderer.domElement);
      controls?.dispose();
      controls = null;
      scene.clear();
    };

    try {
      controls = createControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.screenSpacePanning = true;
      equipment = createEquipment(scene, sceneOptions.equipment ?? {});
      equipment.setSimulationPose(simulationPose);
      replaceSceneData(data, false, sceneOptions);

      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      renderer.domElement.addEventListener("pointerup", onPointerUp);
      pointerListenersAttached = true;

      animationLoop = createAnimationLoop({
        target: renderer.domElement,
        onFrame: () => {
          controls?.update();
          updateLayerLabelFacing();
          renderer.render(scene, camera);
        },
      });

      if (createResizeObserver) {
        resizeObserver = createResizeObserver(onResize);
        resizeObserver.observe(container);
      }
      browserWindow.addEventListener("resize", onResize);
      resizeListenerAttached = true;

      animationLoop.start();
      onResize();

      void loadGripper({
        basePath: GRIPPER_MODEL_PATH,
        objFile: GRIPPER_OBJ,
        mtlFile: GRIPPER_MTL,
        signal: gripperAbortController.signal,
      })
        .then((loaded) => {
          if (runtimeDisposed || gripperAbortController.signal.aborted) {
            loaded.dispose();
            return;
          }
          loadedGripper = loaded;
          highlighter?.setGripperModel(loaded.model);
          equipment?.setGripperModel(loaded.model);
          animationLoop?.requestRender();
        })
        .catch(() => {
          // Keep sphere fallback if MTL/OBJ loading or preparation fails.
        });
    } catch (error) {
      cleanup();
      throw error;
    }

    const captureReportFrame = (
      options: ViewerCaptureOptions = {},
    ): ViewerCaptureResult => {
      if (runtimeDisposed || !controls || !sceneBuild) {
        return captureFallback(
          "viewer-unavailable",
          "The 3D viewer is not ready; render the supplied layer-pattern SVG instead.",
        );
      }
      const width = captureDimension(options.width, 1200);
      const height = captureDimension(options.height, 800);
      const cameraPreset = options.cameraPreset ?? "right-top";
      const previous = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        up: camera.up.clone(),
        near: camera.near,
        far: camera.far,
        aspect: camera.aspect,
        zoom: camera.zoom,
        target: controls.target.clone(),
        maxDistance: controls.maxDistance,
      };

      try {
        renderer.setPixelRatio(1);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        applyCameraPreset(
          camera,
          controls,
          combinedViewerBounds(sceneBuild, equipment),
          cameraPreset,
        );
        updateLayerLabelFacing();
        renderer.render(scene, camera);
        if (typeof renderer.domElement.toDataURL !== "function") {
          return captureFallback(
            "canvas-capture-unavailable",
            "This browser cannot capture the WebGL canvas; render the supplied layer-pattern SVG instead.",
          );
        }
        const dataUrl = renderer.domElement.toDataURL("image/png");
        if (
          !dataUrl ||
          dataUrl === "data:," ||
          !dataUrl.startsWith("data:image/")
        ) {
          return captureFallback(
            "empty-canvas-capture",
            "The WebGL canvas returned no image; render the supplied layer-pattern SVG instead.",
          );
        }
        return {
          status: "captured",
          dataUrl,
          width,
          height,
          cameraPreset,
        };
      } catch {
        return captureFallback(
          "canvas-capture-failed",
          "The WebGL canvas could not be captured; render the supplied layer-pattern SVG instead.",
        );
      } finally {
        camera.position.copy(previous.position);
        camera.quaternion.copy(previous.quaternion);
        camera.up.copy(previous.up);
        camera.near = previous.near;
        camera.far = previous.far;
        camera.aspect = previous.aspect;
        camera.zoom = previous.zoom;
        camera.updateProjectionMatrix();
        controls.target.copy(previous.target);
        controls.maxDistance = previous.maxDistance;
        controls.update();
        renderer.setPixelRatio(displayPixelRatio);
        renderer.setSize(
          Math.max(1, container.clientWidth),
          Math.max(1, container.clientHeight),
          false,
        );
        updateLayerLabelFacing();
        animationLoop?.requestRender();
      }
    };

    return {
      setData(nextData, preserveView, nextSceneOptions) {
        if (runtimeDisposed) return;
        replaceSceneData(nextData, preserveView, nextSceneOptions);
      },
      setVisibleUpToLayer: updateVisibility,
      setLiftCarriageMm(value) {
        if (runtimeDisposed) return;
        loadedRobotCell?.setLiftCarriageMm(value);
        animationLoop?.requestRender();
      },
      setSimulationPose(pose) {
        if (runtimeDisposed) return;
        equipment?.setSimulationPose(pose);
        animationLoop?.requestRender();
      },
      setSimulationState(state) {
        if (runtimeDisposed || !sceneBuild) return;
        sceneBuild.setSimulationState(state);
        if (state === null) {
          updateVisibility(visibleUpToLayer);
        } else if (selectedEntry) {
          selectedEntry = null;
          highlighter?.clear();
          emitSelection(null);
        }
        animationLoop?.requestRender();
      },
      setTemporaryCalibration(state) {
        if (runtimeDisposed) return;
        syncTemporaryCalibration(state);
      },
      setCameraPreset,
      captureReportFrame,
      dispose: cleanup,
    };
  };

  return {
    setData(data, options) {
      if (disposed) return;
      sceneOptions = options?.sceneOptions ?? sceneOptions;
      if (!runtime) {
        runtime = createRuntime(data);
        return;
      }
      runtime.setData(data, options?.preserveView ?? false, sceneOptions);
    },
    setVisibleUpToLayer(nextVisibleUpToLayer) {
      if (disposed) return;
      visibleUpToLayer = nextVisibleUpToLayer;
      runtime?.setVisibleUpToLayer(nextVisibleUpToLayer);
    },
    setLiftCarriageMm(value) {
      if (disposed) return;
      liftCarriageMm = value;
      runtime?.setLiftCarriageMm(value);
    },
    setSimulationPose(pose) {
      if (disposed) return;
      simulationPose = pose;
      runtime?.setSimulationPose(pose);
    },
    setSimulationState(state) {
      if (disposed) return;
      simulationState = state;
      runtime?.setSimulationState(state);
    },
    setTemporaryCalibration(state) {
      if (disposed) return;
      temporaryCalibration = state;
      runtime?.setTemporaryCalibration(state);
    },
    setCameraPreset(preset) {
      if (disposed) return;
      runtime?.setCameraPreset(preset);
    },
    captureReportFrame(options) {
      if (disposed || !runtime) {
        return captureFallback(
          "viewer-unavailable",
          "The 3D viewer is not ready; render the supplied layer-pattern SVG instead.",
        );
      }
      return runtime.captureReportFrame(options);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeRuntime();
    },
  };
}
