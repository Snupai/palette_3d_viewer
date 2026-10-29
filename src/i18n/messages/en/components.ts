import type { componentsDe } from "../de/components";

export const componentsEn = {
  // Layer slider
  "components.slider.visibleLayers": "Visible layers",
  "components.slider.valueText": "Layer {current} of {total}",
  "components.slider.layer": "Layer {number}",
  // Drawer / progress
  "components.drawer.close": "Close",
  "components.drawer.closeNamed": "Close {title}",
  "components.progress.cancel": "Cancel",
  // 3D viewer toolbar
  "components.viewer.toolbar": "3D view",
  "components.viewer.presetTop": "Top view",
  "components.viewer.presetFront": "Front",
  "components.viewer.presetRightTop": "Angled right",
  "components.viewer.liftTopLayer": "Lift top layer",
  "components.viewer.layerNumbers": "Layer numbers",
  // Temporary calibration
  "components.calibration.toggle": "Calibrate",
  "components.calibration.panel": "Temporary 3D calibration",
  "components.calibration.title": "Temporary calibration",
  "components.calibration.hint": "Drag the 3D axes. Values are not saved.",
  "components.calibration.close": "Close calibration",
  "components.calibration.targetPalletStack": "Pallet + stack",
  "components.calibration.targetPickup": "Pickup",
  "components.calibration.modeMove": "Move",
  "components.calibration.modeRotate": "Rotate Z",
  "components.calibration.object": "Object",
  "components.calibration.xMm": "X mm",
  "components.calibration.yMm": "Y mm",
  "components.calibration.zMm": "Z mm",
  "components.calibration.yaw": "Yaw°",
  "components.calibration.pallet": "Pallet",
  "components.calibration.pickup": "Pickup",
  "components.calibration.snapping": "1 mm / 1° snapping",
  "components.calibration.resetBoth": "Reset both",
} as const satisfies Record<keyof typeof componentsDe, string>;
