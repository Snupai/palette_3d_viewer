import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RobViewer } from "~/components/RobViewer";
import type {
  RobViewerHandle,
  ViewerCaptureResult,
} from "~/components/rob-viewer/viewerTypes";
import type { PalletData } from "~/domain/palletTypes";

const controller = vi.hoisted(() => ({
  setData: vi.fn(),
  setVisibleUpToLayer: vi.fn(),
  setSimulationPose: vi.fn(),
  setSimulationPackages: vi.fn(),
  setCameraPreset: vi.fn(),
  captureReportFrame: vi.fn<() => ViewerCaptureResult>(() => ({
    status: "fallback",
    reason: "canvas-capture-failed",
    fallback: "layer-pattern-svg",
    message: "capture failed",
  })),
  dispose: vi.fn(),
}));

vi.mock("~/components/rob-viewer/sceneController", () => ({
  createViewerSceneController: () => controller,
}));

function data(): PalletData {
  const box = {
    blueNumber: 1,
    blueLine: null,
    rotation: 0 as const,
    rect: { width: 200, length: 300, x: 300, y: 200 },
    height: 100,
    placeX: 300,
    placeY: 200,
    numPackages: 1,
  };
  return {
    layers: [
      { unique_layer_id: 1, zwischenlage: 0, boxes: [box] },
      {
        unique_layer_id: 1,
        zwischenlage: 0,
        boxes: [{ ...box, rect: { ...box.rect, x: 600 } }],
      },
    ],
    uniqueLayers: {},
    layer_count: 2,
    total_boxes: 2,
    package: { width: 200, length: 300, height: 100 },
    pallet: { width: 1200, length: 800, height: 144 },
    inputDirection: 0,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  controller.captureReportFrame.mockReturnValue({
    status: "fallback",
    reason: "canvas-capture-failed",
    fallback: "layer-pattern-svg",
    message: "capture failed",
  });
});

describe("RobViewer", () => {
  it("offers compact fixed views, lifted top display, and labels without changing data", async () => {
    const source = data();
    render(
      <RobViewer data={source} cameraResetKey="plan-1" visibleUpToLayer={2} />,
    );

    await waitFor(() => expect(controller.setData).toHaveBeenCalled());
    expect(
      screen.getByRole("toolbar", { name: "3D view controls" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Top" }));
    expect(controller.setCameraPreset).toHaveBeenCalledWith("top");

    fireEvent.click(screen.getByRole("button", { name: "Lift top" }));
    await waitFor(() =>
      expect(controller.setData).toHaveBeenLastCalledWith(source, {
        preserveView: true,
        sceneOptions: {
          layerOffsetsZMm: [0, 150],
          showLayerLabels: false,
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Labels" }));
    await waitFor(() =>
      expect(controller.setData).toHaveBeenLastCalledWith(source, {
        preserveView: true,
        sceneOptions: {
          layerOffsetsZMm: [0, 150],
          showLayerLabels: true,
        },
      }),
    );
    expect(source.layers[1]?.boxes[0]?.rect.x).toBe(600);
  });

  it("enriches failed deterministic captures with the reusable 2D fallback", async () => {
    const ref = createRef<RobViewerHandle>();
    render(
      <RobViewer
        ref={ref}
        data={data()}
        visibleUpToLayer={1}
        showSceneControls={false}
      />,
    );
    await waitFor(() => expect(ref.current).not.toBeNull());

    const capture = await ref.current!.captureReportFrame({
      width: 900,
      height: 600,
      cameraPreset: "right-top",
    });

    expect(controller.captureReportFrame).toHaveBeenCalledWith({
      width: 900,
      height: 600,
      cameraPreset: "right-top",
    });
    expect(capture).toMatchObject({
      status: "fallback",
      fallback: "layer-pattern-svg",
      layerPattern: {
        id: "pallet-layer-1",
        label: "Layer 1",
        metadata: { source: "pallet-layer", layerIndex: 0 },
      },
    });
  });
});
