"use client";

import { useEffect, useRef } from "react";
import {
  createViewerSceneController,
  type ViewerSceneController,
} from "~/components/rob-viewer/sceneController";
import type { RobViewerProps } from "~/components/rob-viewer/viewerTypes";

export type { BoxSelection } from "~/components/rob-viewer/viewerTypes";

export function RobViewer({
  data,
  cameraResetKey,
  visibleUpToLayer,
  onBoxSelect,
}: RobViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ViewerSceneController | null>(null);
  const onBoxSelectRef = useRef(onBoxSelect);
  const cameraResetKeyRef = useRef(cameraResetKey);
  const resetOnNextDataRef = useRef(false);
  onBoxSelectRef.current = onBoxSelect;

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
  }, [cameraResetKey]);

  useEffect(() => {
    const resetView = resetOnNextDataRef.current;
    resetOnNextDataRef.current = false;
    controllerRef.current?.setData(data, { preserveView: !resetView });
  }, [data]);

  useEffect(() => {
    controllerRef.current?.setVisibleUpToLayer(visibleUpToLayer);
  }, [visibleUpToLayer]);

  return (
    <div
      ref={mountRef}
      className="relative h-full min-h-[320px] w-full sm:min-h-[420px] xl:min-h-[600px]"
    />
  );
}
