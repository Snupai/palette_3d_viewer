"use client";

import { useEffect } from "react";
import {
  shouldPrefetchDocAligner,
  whenIdleAfterLoad,
} from "~/workers/docAlignerPrefetch";

/**
 * Downloads the sheet camera's DocAligner model and runtime in the background
 * once the page has loaded and the browser is idle, so the camera can use
 * them right away. Renders nothing; skipped on Save-Data or 2G.
 */
export function DocAlignerPrefetch() {
  useEffect(() => {
    if (!shouldPrefetchDocAligner()) return;
    return whenIdleAfterLoad(window, () => {
      // Loaded only now, so the client stays out of the first-load bundle.
      void import("~/workers/docAlignerClient")
        .then(({ sharedDocAligner }) => sharedDocAligner()?.prefetch())
        .catch(() => undefined);
    });
  }, []);
  return null;
}
