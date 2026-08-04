import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { PalletData } from "~/domain/palletTypes";
import {
  loadGripperModel,
  type LoadedGripperModel,
} from "~/components/rob-viewer/gripperLoader";
import { buildViewerScene } from "~/components/rob-viewer/sceneBuilder";
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
} from "~/components/rob-viewer/viewerTypes";

const GRIPPER_MODEL_PATH = "/models/gripper/";
const GRIPPER_OBJ = "10_01_43_00016.obj";
const GRIPPER_MTL = "10_01_43_00016.mtl";

export type ViewerRenderer = {
  domElement: HTMLCanvasElement;
  setSize(width: number, height: number): void;
  setPixelRatio(value: number): void;
  setClearColor(color: THREE.ColorRepresentation, alpha?: number): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
};

export type ViewerControls = {
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
  buildScene: (scene: THREE.Scene, data: PalletData) => BuiltViewerScene;
  createHighlighter: (options: {
    scene: THREE.Scene;
    packageLength: number;
  }) => ViewerHighlighter;
  createAnimationLoop: (
    options: ViewerAnimationLoopOptions,
  ) => ViewerAnimationLoop;
  loadGripper: typeof loadGripperModel;
  createResizeObserver: (
    callback: ResizeObserverCallback,
  ) => ViewerResizeObserver;
  window: ViewerWindow;
};

export type ViewerSceneController = {
  setData(data: PalletData): void;
  setVisibleUpToLayer(visibleUpToLayer: number): void;
  dispose(): void;
};

type ViewerRuntime = {
  setVisibleUpToLayer(visibleUpToLayer: number): void;
  dispose(): void;
};

function fitCameraToScene(
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3 | null,
): { center: THREE.Vector3 | null; maxOrbitDistance: number } {
  let center: THREE.Vector3 | null = null;
  let maxOrbitDistance = camera.far * 0.8;

  if (bounds && !bounds.isEmpty()) {
    const size = bounds.getSize(new THREE.Vector3());
    center = bounds.getCenter(new THREE.Vector3());
    const boundingSphere = bounds.getBoundingSphere(new THREE.Sphere());
    const maxSize = Math.max(size.x, size.y, size.z);
    const distance = maxSize * 1.8 + 500;
    camera.position.set(
      center.x + distance,
      center.y + distance,
      center.z + distance,
    );
    camera.lookAt(center);

    const initialOrbitDistance = camera.position.distanceTo(center);
    maxOrbitDistance = initialOrbitDistance * 3;
    camera.near = THREE.MathUtils.clamp(boundingSphere.radius / 100, 1, 10);
    camera.far = maxOrbitDistance + boundingSphere.radius * 2;
    camera.updateProjectionMatrix();
  }

  return { center, maxOrbitDistance };
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
  dependencies = {},
}: {
  container: HTMLElement;
  getOnBoxSelect: () => ((selection: BoxSelection | null) => void) | undefined;
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
  const createHighlighter =
    dependencies.createHighlighter ?? createViewerHighlighter;
  const createAnimationLoop =
    dependencies.createAnimationLoop ?? createViewerAnimationLoop;
  const loadGripper = dependencies.loadGripper ?? loadGripperModel;
  const createResizeObserver =
    dependencies.createResizeObserver ??
    defaultResizeObserverFactory(container);

  let runtime: ViewerRuntime | null = null;
  let visibleUpToLayer = 1;
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
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(browserWindow.devicePixelRatio, 2));
    renderer.setClearColor(0x101013, 1);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    let sceneBuild: BuiltViewerScene | null = null;
    let highlighter: ViewerHighlighter | null = null;
    let controls: ViewerControls | null = null;
    let animationLoop: ViewerAnimationLoop | null = null;
    let resizeObserver: ViewerResizeObserver | null = null;
    let loadedGripper: LoadedGripperModel | null = null;
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
      pointerDown = { x: event.clientX, y: event.clientY };
    };

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerUp = (event: PointerEvent) => {
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

    const updateVisibility = (nextVisibleUpToLayer: number) => {
      if (!sceneBuild || !highlighter) return;
      maxVisibleLayer = applyLayerVisibility({
        layerRenders: sceneBuild.layerRenders,
        interlayerRenders: sceneBuild.interlayerRenders,
        visibleUpToLayer: nextVisibleUpToLayer,
        layerCount: data.layers.length,
      });
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

    const cleanup = () => {
      if (runtimeDisposed) return;
      runtimeDisposed = true;
      gripperAbortController.abort();
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
      highlighter?.dispose();
      highlighter = null;
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
      sceneBuild = buildScene(scene, data);
      highlighter = createHighlighter({
        scene,
        packageLength: data.package.length,
      });
      updateVisibility(visibleUpToLayer);

      const { center, maxOrbitDistance } = fitCameraToScene(
        camera,
        sceneBuild.bounds,
      );
      controls = createControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.05;
      controls.screenSpacePanning = true;
      controls.maxDistance = maxOrbitDistance;
      controls.target.copy(center ?? new THREE.Vector3(600, 400, 300));
      // fitCameraToScene framed the full stack; shift to the visible portion
      // when the viewer mounts with layers already hidden.
      if (center && visibleCenterZ !== null) {
        const deltaZ = visibleCenterZ - center.z;
        controls.target.z += deltaZ;
        camera.position.z += deltaZ;
      }
      controls.update();

      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      renderer.domElement.addEventListener("pointerup", onPointerUp);
      pointerListenersAttached = true;

      animationLoop = createAnimationLoop({
        target: renderer.domElement,
        onFrame: () => {
          controls?.update();
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
      emitSelection(null);

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
          animationLoop?.requestRender();
        })
        .catch(() => {
          // Keep sphere fallback if MTL/OBJ loading or preparation fails.
        });
    } catch (error) {
      cleanup();
      throw error;
    }

    return {
      setVisibleUpToLayer: updateVisibility,
      dispose: cleanup,
    };
  };

  return {
    setData(data) {
      if (disposed) return;
      disposeRuntime();
      runtime = createRuntime(data);
    },
    setVisibleUpToLayer(nextVisibleUpToLayer) {
      if (disposed) return;
      visibleUpToLayer = nextVisibleUpToLayer;
      runtime?.setVisibleUpToLayer(nextVisibleUpToLayer);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeRuntime();
    },
  };
}
