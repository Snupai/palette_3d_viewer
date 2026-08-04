import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  createViewerSceneController,
  type ViewerControls,
  type ViewerRenderer,
  type ViewerSceneControllerDependencies,
  type ViewerWindow,
} from "~/components/rob-viewer/sceneController";
import type { LoadedGripperModel } from "~/components/rob-viewer/gripperLoader";
import type { ViewerHighlighter } from "~/components/rob-viewer/sceneHighlight";
import type { ViewerAnimationLoop } from "~/components/rob-viewer/viewerAnimationLoop";
import type {
  BoxSelection,
  BuiltViewerScene,
} from "~/components/rob-viewer/viewerTypes";
import type { PalletData } from "~/domain/palletTypes";

function palletData(): PalletData {
  return {
    layers: [{ unique_layer_id: 1, zwischenlage: 0, boxes: [] }],
    uniqueLayers: {},
    layer_count: 1,
    total_boxes: 0,
    package: { width: 200, length: 300, height: 150 },
    pallet: { width: 1200, length: 800, height: 144 },
    inputDirection: 0,
  };
}

describe("viewer scene controller cleanup", () => {
  it("releases browser, renderer, scene, highlight, and late gripper ownership", async () => {
    const container = document.createElement("div");
    Object.defineProperties(container, {
      clientWidth: { configurable: true, value: 640 },
      clientHeight: { configurable: true, value: 480 },
    });
    document.body.appendChild(container);

    const canvas = document.createElement("canvas");
    const removeCanvasListener = vi.spyOn(canvas, "removeEventListener");
    const rendererDispose = vi.fn();
    const renderer: ViewerRenderer = {
      domElement: canvas,
      setSize: vi.fn(),
      setPixelRatio: vi.fn(),
      setClearColor: vi.fn(),
      render: vi.fn(),
      dispose: rendererDispose,
    };
    const controlsDispose = vi.fn();
    const controls: ViewerControls = {
      enableDamping: false,
      dampingFactor: 0,
      screenSpacePanning: false,
      maxDistance: 0,
      target: new THREE.Vector3(),
      update: vi.fn(),
      dispose: controlsDispose,
    };

    const sceneDispose = vi.fn();
    const builtScene: BuiltViewerScene = {
      root: new THREE.Group(),
      bounds: null,
      layerRenders: [],
      interlayerRenders: [],
      pickEntries: [],
      dispose: sceneDispose,
    };
    const highlighterDispose = vi.fn();
    const setGripperModel = vi.fn();
    const highlighter: ViewerHighlighter = {
      highlightGroup: new THREE.Group(),
      gripperHolder: new THREE.Group(),
      show: vi.fn(),
      clear: vi.fn(),
      setGripperModel,
      dispose: highlighterDispose,
    };
    const animationStart = vi.fn();
    const animationStop = vi.fn();
    const animationLoop: ViewerAnimationLoop = {
      start: animationStart,
      requestRender: vi.fn(),
      stop: animationStop,
    };
    const resizeDisconnect = vi.fn();
    const resizeObserver = {
      observe: vi.fn<(target: Element) => void>(),
      disconnect: resizeDisconnect,
    };
    const addWindowListener =
      vi.fn<(type: "resize", listener: EventListener) => void>();
    const removeWindowListener =
      vi.fn<(type: "resize", listener: EventListener) => void>();
    const viewerWindow: ViewerWindow = {
      devicePixelRatio: 1.5,
      addEventListener: addWindowListener,
      removeEventListener: removeWindowListener,
    };

    const gripperLoad = { signal: null as AbortSignal | null };
    let resolveGripper!: (loaded: LoadedGripperModel) => void;
    const pendingGripper = new Promise<LoadedGripperModel>((resolve) => {
      resolveGripper = resolve;
    });
    const loadGripper = vi.fn<ViewerSceneControllerDependencies["loadGripper"]>(
      (options) => {
        gripperLoad.signal = options.signal;
        return pendingGripper;
      },
    );
    const loadedDispose = vi.fn();
    const loadedGripper: LoadedGripperModel = {
      model: new THREE.Group(),
      dispose: loadedDispose,
    };
    const onBoxSelect = vi.fn<(selection: BoxSelection | null) => void>();

    const controller = createViewerSceneController({
      container,
      getOnBoxSelect: () => onBoxSelect,
      dependencies: {
        createRenderer: () => renderer,
        createControls: () => controls,
        buildScene: () => builtScene,
        createHighlighter: () => highlighter,
        createAnimationLoop: () => animationLoop,
        loadGripper,
        createResizeObserver: () => resizeObserver,
        window: viewerWindow,
      },
    });

    controller.setVisibleUpToLayer(2);
    controller.setData(palletData());

    expect(container.contains(canvas)).toBe(true);
    expect(animationStart).toHaveBeenCalledTimes(1);
    expect(resizeObserver.observe).toHaveBeenCalledWith(container);
    expect(addWindowListener).toHaveBeenCalledTimes(1);
    expect(onBoxSelect).toHaveBeenCalledWith(null);
    expect(gripperLoad.signal?.aborted).toBe(false);

    controller.dispose();
    controller.dispose();

    expect(gripperLoad.signal?.aborted).toBe(true);
    expect(animationStop).toHaveBeenCalledTimes(1);
    expect(resizeDisconnect).toHaveBeenCalledTimes(1);
    expect(removeWindowListener).toHaveBeenCalledTimes(1);
    expect(removeCanvasListener).toHaveBeenCalledWith(
      "pointerdown",
      expect.any(Function),
    );
    expect(removeCanvasListener).toHaveBeenCalledWith(
      "pointerup",
      expect.any(Function),
    );
    expect(highlighterDispose).toHaveBeenCalledTimes(1);
    expect(sceneDispose).toHaveBeenCalledTimes(1);
    expect(rendererDispose).toHaveBeenCalledTimes(1);
    expect(controlsDispose).toHaveBeenCalledTimes(1);
    expect(container.contains(canvas)).toBe(false);

    resolveGripper(loadedGripper);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadedDispose).toHaveBeenCalledTimes(1);
    expect(setGripperModel).not.toHaveBeenCalled();
    container.remove();
  });
});
