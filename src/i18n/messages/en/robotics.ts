import type { roboticsDe } from "../de/robotics";

export const roboticsEn = {
  // Workspace header
  "robotics.title": "Robotics & gripper",
  "robotics.layerCount_one": "{count} layer",
  "robotics.layerCount_other": "{count} layers",
  "robotics.layerCount": "{count} layers",
  "robotics.packageCount_one": "{count} package",
  "robotics.packageCount_other": "{count} packages",
  "robotics.packageCount": "{count} packages",
  "robotics.pickupCount_one": "{count} pickup",
  "robotics.pickupCount_other": "{count} pickups",
  "robotics.pickupCount": "{count} pickups",
  "robotics.summaryCalculated": "{layers} · {packages} · {pickups} calculated",
  "robotics.noStack": "No saved stack",
  "robotics.openItems_one": "{count} open item",
  "robotics.openItems_other": "{count} open items",
  "robotics.openItems": "{count} open items",
  "robotics.openItemsUnderAdvanced": "{items} under Engineering",
  "robotics.exportEnabled": "Export enabled",
  "robotics.previewMotion": "View motion",
  "robotics.exportRob": "Export .rob",

  // Equipment panel
  "robotics.equipment": "Equipment",
  "robotics.multipackProfile": "Multipack profile v{version}",
  "robotics.notDerivableFromImport": "cannot be derived from .rob import",
  "robotics.checkAgainstRealCell": "check against the real cell",
  "robotics.gripper": "Gripper",
  "robotics.gripperOfPlan": "Plan gripper",
  "robotics.selectGripper": "Select gripper …",
  "robotics.palletStation": "Pallet station",
  "robotics.palletStationOfPlan": "Plan pallet station",
  "robotics.selectStation": "Select station …",
  "robotics.gripperType.suction": "Suction gripper",
  "robotics.gripperType.clamp": "Clamp gripper",
  "robotics.gripperType.fork": "Fork gripper",
  "robotics.profileNote":
    "From “Multipack für Roboter” {version}, not surveyed.",

  // Pickup panel
  "robotics.pickup": "Pickup",
  "robotics.pickupDerivedTop": "top-centre of the package group",
  "robotics.pickupSurveyed": "surveyed pickup point",
  "robotics.packagesPerPickup": "Packages per pickup",
  "robotics.pickupDerivedNote":
    "Pickup for {length} × {width} × {height} mm: single {singleX} / {singleY} mm{grouped}. Z {height} mm, rotation {yaw}°.",
  "robotics.pickupGroupedNote":
    ", {count}-package pickup {groupedX} / {groupedY} mm",
  "robotics.pickupSurveyedNote":
    "The surveyed coordinates entered under Engineering apply.",
  "robotics.calculatedPickups": "Calculated pickups",

  // Advanced section
  "robotics.advanced": "Engineering",
  "robotics.noOpenItems": "no open items",
  "robotics.advancedWarning":
    "Gripper drafts and mappings are unverified engineering data. Check against the real cell before use.",
  "robotics.pickPointAndEvidence": "Pickup point and evidence",
  "robotics.pickPointHint": "Empty = calculated top-centre.",
  "robotics.xMm": "X (mm)",
  "robotics.yMm": "Y (mm)",
  "robotics.zMm": "Z (mm)",
  "robotics.rotationDeg": "Rotation (°)",
  "robotics.transferClearance": "Travel height above the stack (mm)",
  "robotics.pickReferenceStatus": "Pickup point status",
  "robotics.statusUnverified": "Not checked",
  "robotics.statusVerified": "Checked against the stated source",
  "robotics.pickReferenceSource": "Pickup point source",
  "robotics.fixedObstacles": "Fixed obstacles",

  // Library panels
  "robotics.gripperLibraryTitle": "Gripper: library and editor",
  "robotics.gripperTemplates": "Gripper templates",
  "robotics.selectGripperTemplate": "Select gripper template …",
  "robotics.createSuctionGripper": "Create new suction gripper (unverified)",
  "robotics.gripperBuiltInLimits":
    "Maximum pickup length 450 mm. Package limits: lengthwise 50–500 × 50–420 mm, crosswise 50–500 × 50–300 mm, height 50–400 mm.",
  "robotics.gripperEmpty": "Select or create a gripper to edit it.",
  "robotics.stationLibraryTitle": "Pallet station: library and editor",
  "robotics.stationTemplates": "Station templates",
  "robotics.selectStationTemplate": "Select station template …",
  "robotics.createStation": "Create new station (unverified)",
  "robotics.stationBuiltInLimits":
    "Pallet origin right / bottom. TCP envelope ±2000 mm, clearance outline ±1500 mm. Radius 0 / 0 is kept as an uncalibrated placeholder; reach is not checked.",
  "robotics.stationEmpty": "Select or create a station to edit it.",
  "robotics.apply": "Apply",
  "robotics.removeFromLibrary": "Remove from library",
  "robotics.createEditableCopy": "Create editable copy",
  "robotics.saveToPlan": "Save in plan",
  "robotics.saveAsTemplate": "Save as template",
  "robotics.builtInNotice":
    "The bundled Multipack profile v{version} is read-only. To make changes or create your own template, create an editable copy first.",

  // Retained import
  "robotics.importedOriginal": "Imported original file",
  "robotics.downloadOriginal": "Download original .rob",
  "robotics.downloadEdited": "Download edited .rob",

  // Status and error messages
  "robotics.errorTemplateLibraryLoad":
    "The template library could not be loaded.",
  "robotics.errorSaveFailed": "Saving failed.",
  "robotics.statusGripperApplied": "Gripper applied.",
  "robotics.statusGripperRemoved": "Gripper selection removed.",
  "robotics.statusStationApplied": "Pallet station applied.",
  "robotics.statusStationRemoved": "Station selection removed.",
  "robotics.errorBuiltInGripperReadOnly":
    "The bundled Multipack gripper is read-only. Create an editable copy first.",
  "robotics.errorBuiltInStationReadOnly":
    "The bundled Multipack station is read-only. Create an editable copy first.",
  "robotics.errorBuiltInNotInLibrary":
    "Bundled profiles are not added to the library. Create an editable copy first.",
  "robotics.statusGripperSaved": "Gripper “{name}” saved in plan.",
  "robotics.statusStationSaved": "Pallet station “{name}” saved in plan.",
  "robotics.statusGripperTemplateSaved": "Gripper template “{name}” saved.",
  "robotics.statusStationTemplateSaved": "Station template “{name}” saved.",
  "robotics.statusGripperTemplateApplied":
    "Gripper template “{name}” applied to the plan.",
  "robotics.statusStationTemplateApplied":
    "Station template “{name}” applied to the plan.",
  "robotics.statusTemplateRemoved":
    "Template removed from the library; the copy in the plan is kept.",
  "robotics.statusRobExported":
    ".rob file exported and verified by parser round-trip.",

  // Pickup table
  "robotics.col.layer": "Layer",
  "robotics.col.grip": "Grip",
  "robotics.col.packages": "Packages",
  "robotics.col.pickX": "Pick X",
  "robotics.col.pickY": "Pick Y",
  "robotics.col.pickZ": "Pick Z",
  "robotics.col.pickRotation": "Pick rotation",
  "robotics.col.transfer": "Transfer X/Y/Z",
  "robotics.col.placeX": "Place X",
  "robotics.col.placeY": "Place Y",
  "robotics.col.placeZ": "Place Z",
  "robotics.col.placeRotation": "Place rotation",
  "robotics.col.frame": "Frame",
  "robotics.col.source": "Source",
  "robotics.noPickupsYet": "No pickups calculated yet.",

  // Diagnostics
  "robotics.diagnosticsDetail": "Diagnostics in detail",
  "robotics.diagnosticsNoCollision":
    "No fixed obstacles modelled; no statement about collisions.",
  "robotics.diagnosticsNone": "No findings.",
  "robotics.category.package": "Plan and pickups",
  "robotics.category.gripper": "Gripper",
  "robotics.category.station": "Pallet station",
  "robotics.category.reach": "Reach",
  "robotics.category.envelope": "Entered envelopes",
  "robotics.category.collision": "Obstacles",
  "robotics.category.export": "Export",

  // Readiness
  "robotics.readiness": "Readiness",
  "robotics.readinessBlocked": "Pickup data blocked",
  "robotics.readinessAllPassed": "all checks passed",
  "robotics.readinessChecked": "project data checked",
  "robotics.readinessDisclaimerStrong":
    "Production release is not assessed here.",
  "robotics.readinessDisclaimer":
    "Check the gripper, station frame, program mapping, safety devices and the complete collision model before use on the machine.",
  "robotics.status.complete": "Ready",
  "robotics.status.needs-input": "Input needed",
  "robotics.status.engineering": "Check engineering",
  "robotics.status.not-checked": "Not checked",
  "robotics.status.warning": "Check",
  "robotics.status.blocked": "Blocked",
  "robotics.item.plan": "Plan and pickup list",
  "robotics.item.equipment": "Equipment",
  "robotics.item.pickup": "Pickup point",
  "robotics.item.workspace": "Station workspace",
  "robotics.item.obstacles": "Obstacles",
  "robotics.item.export": "Export mapping",
  "robotics.evidence.planBlocked":
    "The active plan has blocking grouping or order issues.",
  "robotics.evidence.planCalculated_one": "{count} pickup calculated.",
  "robotics.evidence.planCalculated_other": "{count} pickups calculated.",
  "robotics.evidence.planCalculated": "{count} pickups calculated.",
  "robotics.evidence.planEmpty": "Create and stack a package pattern first.",
  "robotics.evidence.equipmentMissing": "Select a gripper and pallet station.",
  "robotics.evidence.equipmentBlocked":
    "The selected equipment does not pass the internal compatibility checks.",
  "robotics.evidence.equipmentProfile":
    "The observed Multipack default profile is selected. Its values are documented evidence, not calibrated production equipment.",
  "robotics.evidence.equipmentOk":
    "Selected gripper and station pass the available internal checks.",
  "robotics.evidence.pickupIncomplete":
    "Enter a surveyed pickup, or leave X, Y, and Z blank to use the box-group top-center.",
  "robotics.evidence.pickupBlocked":
    "The pickup values or their evidence need correction.",
  "robotics.evidence.pickupDerived":
    "Pickup is the top-center of each box group, from package size and count.",
  "robotics.evidence.pickupVerified":
    "Marked as checked against the stated source.",
  "robotics.evidence.pickupUnverified":
    "Coordinates are present but have not been checked against the station.",
  "robotics.evidence.workspaceNotChecked":
    "Select equipment and calculate pickups before checking reach and envelopes.",
  "robotics.evidence.workspaceBlocked":
    "At least one pickup is outside an entered reach or envelope.",
  "robotics.evidence.workspaceSentinel":
    "Entered TCP and free-space envelopes contain the calculated pickups, but radial reach was not checked because 0 / 0 is an uncalibrated legacy sentinel.",
  "robotics.evidence.workspaceOk":
    "Entered reach and envelope limits contain the calculated pickups.",
  "robotics.evidence.obstaclesBlocked":
    "A calculated motion intersects the modeled feed conveyor or an entered obstacle, or an obstacle is invalid.",
  "robotics.evidence.obstaclesChecked_one": "{count} entered obstacle checked.",
  "robotics.evidence.obstaclesChecked_other":
    "{count} entered obstacles checked.",
  "robotics.evidence.obstaclesChecked": "{count} entered obstacles checked.",
  "robotics.evidence.obstaclesCheckedConveyor_one":
    "{count} entered obstacle checked together with the calculated feed conveyor bed.",
  "robotics.evidence.obstaclesCheckedConveyor_other":
    "{count} entered obstacles checked together with the calculated feed conveyor bed.",
  "robotics.evidence.obstaclesCheckedConveyor":
    "{count} entered obstacles checked together with the calculated feed conveyor bed.",
  "robotics.evidence.obstaclesConveyorOnly":
    "The calculated feed conveyor bed was checked. No additional station obstacles are modeled.",
  "robotics.evidence.obstaclesNone":
    "No fixed obstacles are modeled. Collision against individual station objects has not been checked.",
  "robotics.evidence.exportOk": "Internal export preflight passed.",
  "robotics.evidence.exportIssues_one":
    "{count} export setting still requires engineering review.",
  "robotics.evidence.exportIssues_other":
    "{count} export settings still require engineering review.",
  "robotics.evidence.exportIssues":
    "{count} export settings still require engineering review.",

  // Obstacle editor
  "robotics.obstacleDefaultName": "Obstacle {number}",
  "robotics.addObstacle": "Add obstacle",
  "robotics.obstacleNone":
    "No fixed obstacles modelled. Collisions with individual station objects were not checked.",
  "robotics.obstacleNameOf": "Name of obstacle {number}",
  "robotics.remove": "Remove",
  "robotics.minX": "Min X",
  "robotics.minY": "Min Y",
  "robotics.maxX": "Max X",
  "robotics.maxY": "Max Y",
  "robotics.minZ": "Min Z",
  "robotics.maxZ": "Max Z",

  // Export mapping
  "robotics.exportMapping": "Export mapping (.rob)",
  "robotics.quantization": "Integer rounding",
  "robotics.quantization.round": "Round to whole number",
  "robotics.quantization.truncate": "Truncate decimals",
  "robotics.quantization.reject": "Reject decimal values",
  "robotics.lastTwoFields": "Last two .rob fields",
  "robotics.lastTwoFieldsAria": "Handling of the last .rob fields",
  "robotics.unknownField.block": "Block: meaning unknown",
  "robotics.unknownField.fromCycle": "Grip dx/dy, otherwise 0",
  "robotics.unknownField.preserve": "Keep imported values",
  "robotics.unknownField.explicit": "Enter values",
  "robotics.countOnlyInterlayers":
    "Export count only when interlayers are not 3 mm",
  "robotics.mappingId": "Internal mapping ID",
  "robotics.signX": "Sign X",
  "robotics.signY": "Sign Y",
  "robotics.signRotation": "Sign rotation",
  "robotics.rotationOffset": "Rotation offset (°)",
  "robotics.acknowledgeAria": "Confirm unverified .rob mapping",
  "robotics.acknowledgeText":
    "This mapping was entered manually and does not prove external Multipack compatibility.",
  "robotics.field8": "Field 8",
  "robotics.field9": "Field 9",
  "robotics.fieldsMeaning": "Meaning of fields 8 and 9",
  "robotics.fieldsSource": "Source of these values",

  // Resource editors
  "robotics.name": "Name",
  "robotics.externalId": "External ID",
  "robotics.gripperKind": "Type",
  "robotics.kind.suction": "Suction gripper",
  "robotics.kind.clamp": "Clamp gripper (mechanics unverified)",
  "robotics.kind.fork": "Fork gripper (mechanics unverified)",
  "robotics.inletDirection": "Infeed direction",
  "robotics.inlet.any": "Any",
  "robotics.inlet.lengthwise": "Lengthwise",
  "robotics.inlet.crosswise": "Crosswise",
  "robotics.maxPickupLength": "Maximum pickup length (mm, empty = unknown)",
  "robotics.tcpLegend": "Tool centre point TCP (mm)",
  "robotics.toolEnvelope": "Tool envelope (mm)",
  "robotics.allowedPlaceRotations": "Allowed place rotations",
  "robotics.packageLimits": "Package limits (mm)",
  "robotics.checkPackageLimits":
    "Check package dimensions against this gripper",
  "robotics.multipickShared":
    "Multi-package pickup with shared place (adopted, generated shared place unverified)",
  "robotics.otherGripperWarning":
    "Settings for {kind} are saved, but the generated gripping mechanics are unverified and block the export.",
  "robotics.palletOriginX": "Pallet origin X",
  "robotics.palletOriginY": "Pallet origin Y",
  "robotics.left": "Left",
  "robotics.center": "Centre",
  "robotics.right": "Right",
  "robotics.bottom": "Bottom",
  "robotics.top": "Top",
  "robotics.inletAlignment": "Infeed alignment",
  "robotics.tcpEnvelope": "TCP envelope",
  "robotics.obstacleEnvelope": "Clearance / obstacle outline",
  "robotics.robotCenterRange": "Robot centre and reach (mm)",
  "robotics.centerX": "Centre X",
  "robotics.centerY": "Centre Y",
  "robotics.radiusMin": "Radius min.",
  "robotics.radiusMax": "Radius max.",
  "robotics.rangeUncalibrated":
    "0 / 0 means: reach not calibrated. The reach check is skipped until a measured range is entered.",
  "robotics.palletizingDirections": "Palletizing directions",
  "robotics.preferredDirection": "Preferred direction",
} as const satisfies Record<keyof typeof roboticsDe, string>;
