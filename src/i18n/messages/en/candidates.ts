import type { candidatesDe } from "../de/candidates";

export const candidatesEn = {
  // Candidate browser
  "candidates.browser.title": "Selectable layouts",
  "candidates.browser.summary":
    "{shown} of {total} layouts · {generated} generated candidates",
  "candidates.browser.exactCount": "Exact count",
  "candidates.browser.exactCountAria": "Exact package count",
  "candidates.browser.maximum": "Maximum ({count})",
  "candidates.browser.resetFilters": "Reset filters",
  "candidates.browser.listAria": "Selectable candidate layouts",
  "candidates.browser.colNr": "No.",
  "candidates.browser.colCount": "Count",
  "candidates.browser.colGeometry": "Geometry",
  "candidates.browser.colBlocks": "Blocks",
  "candidates.browser.colCycles": "Cycles",
  "candidates.browser.colLength": "Length",
  "candidates.browser.colWidth": "Width",
  "candidates.browser.geometryOk": "Geometry OK",
  "candidates.browser.rejected": "Rejected",
  "candidates.browser.blocksTitle":
    "The legacy MultiPack Blocks value has not been verified and is not inferred.",
  "candidates.browser.unknown": "Unknown",
  "candidates.browser.noMatch": "No candidate matches the current filters.",
  "candidates.browser.selectCandidate": "Select a candidate",
  "candidates.browser.score": "Score",
  "candidates.browser.utilization": "Utilization",
  "candidates.browser.generators": "Generators",
  "candidates.browser.noneRecorded": "None recorded",
  "candidates.browser.noDiagnosticsActive": "No active candidate diagnostics.",
  "candidates.browser.diagnosticsSummary":
    "Solver diagnostics ({diagnostics}) and exclusions ({exclusions})",
  "candidates.browser.noDiagnostics": "No diagnostics or exclusions.",
  "candidates.browser.moreExclusions": "{count} more exclusions not shown.",
  // Rank reasons
  "candidates.rank.packages": "More packages per layer ({current} vs {next})",
  "candidates.rank.utilization":
    "Higher area utilization ({current}% vs {next}%)",
  "candidates.rank.cycles": "Fewer robot cycles ({current} vs {next})",
  "candidates.rank.boundingBlock":
    "Smaller bounding block ({currentLength} × {currentWidth} mm vs {nextLength} × {nextWidth} mm)",
  "candidates.rank.perimeter":
    "Tighter bounding block perimeter ({current} mm vs {next} mm)",
  "candidates.rank.tie":
    "Equivalent score — ranked ahead by the deterministic identity tie-break",
  // Package label face picker
  "candidates.picker.infeedOrientation": "Infeed orientation",
  "candidates.picker.lengthwise": "Lengthwise",
  "candidates.picker.crosswise": "Crosswise",
  "candidates.picker.physicalFace": "Physical label face",
  "candidates.picker.infeedLength": "L →",
  "candidates.picker.infeedWidth": "W →",
  "candidates.picker.acrossWidth": "W ↕",
  "candidates.picker.acrossLength": "L ↕",
  "candidates.picker.edgeLabel.top": "Top",
  "candidates.picker.edgeLabel.right": "Right",
  "candidates.picker.edgeLabel.bottom": "Bottom",
  "candidates.picker.edgeLabel.left": "Left",
  "candidates.picker.edgeName.top": "top",
  "candidates.picker.edgeName.right": "right",
  "candidates.picker.edgeName.bottom": "bottom",
  "candidates.picker.edgeName.left": "left",
  "candidates.picker.physicalSide.top": "0° top face (+Y)",
  "candidates.picker.physicalSide.right": "0° right face (+X)",
  "candidates.picker.physicalSide.bottom": "0° bottom face (−Y)",
  "candidates.picker.physicalSide.left": "0° left face (−X)",
  "candidates.picker.selectEdge": "Select label on displayed {edge} edge",
  "candidates.picker.faceTitle": "Physical package face: {face}",
  "candidates.picker.infeedDirectionAria": "Infeed direction: left to right",
  "candidates.picker.infeed": "Infeed",
  "candidates.picker.leftToRight": "Left → right",
  "candidates.picker.selectedSummary": "{face} · shown on {edge} edge",
  "candidates.picker.noPreference": "No nearest-edge label preference",
  "candidates.picker.noLabel": "No label",
  // Solver controls: shared labels and errors
  "candidates.solver.packageLength": "Package length",
  "candidates.solver.packageWidth": "Package width",
  "candidates.solver.packageHeight": "Package height",
  "candidates.solver.lengthTotal": "Length total overhang / underhang",
  "candidates.solver.widthTotal": "Width total overhang / underhang",
  "candidates.solver.packagesPerLayer": "Packages per layer",
  "candidates.solver.candidatesPerGenerator": "Candidates per generator",
  "candidates.solver.automaticGroupLimit": "Automatic group limit",
  "candidates.solver.error.positive":
    "{label} must be a finite positive number.",
  "candidates.solver.error.required": "{label} is required.",
  "candidates.solver.error.finite": "{label} must be a finite number.",
  "candidates.solver.error.integer": "{label} must be a positive integer.",
  "candidates.solver.error.palletRequired":
    "A pallet is required before generation.",
  "candidates.solver.error.prepare": "Unable to prepare solver input.",
  "candidates.solver.error.applyFailed":
    "Package input update failed: {message}",
  "candidates.solver.error.applyFailedUnknown": "Package input update failed.",
  "candidates.solver.error.appliedInvalid":
    "The applied generator inputs are invalid.",
  "candidates.solver.error.cancelled":
    "Solver run cancelled. No partial candidates were applied.",
  "candidates.solver.error.failed": "Solver failed: {message}",
  "candidates.solver.error.workerUnknown":
    "Solver failed with an unknown worker error.",
  "candidates.solver.progress.applying":
    "Applying package inputs before generation.",
  "candidates.solver.progress.starting": "Starting solver worker.",
  "candidates.solver.stale":
    "The previous solver run was discarded because generator inputs changed.",
  "candidates.solver.labelFace.top":
    "+Y face — edge parallel to package length",
  "candidates.solver.labelFace.right":
    "+X face — edge parallel to package width",
  "candidates.solver.labelFace.bottom":
    "−Y face — edge parallel to package length",
  "candidates.solver.labelFace.left":
    "−X face — edge parallel to package width",
  "candidates.solver.progressTitle": "Generating patterns…",
  "candidates.solver.progressAria": "Pattern generation progress",
  // Solver controls: guided
  "candidates.solver.guided.aria": "Pattern search",
  "candidates.solver.guided.titleRunning": "Searching for matching patterns",
  "candidates.solver.guided.titleDone": "Search complete",
  "candidates.solver.guided.titleIdle": "Calculate patterns",
  "candidates.solver.guided.subtitle": "{length} × {width} mm on {pallet}",
  "candidates.solver.guided.palletFallback": "Pallet",
  "candidates.solver.guided.stateRunning": "Calculating",
  "candidates.solver.cancelled": "Cancelled",
  "candidates.solver.guided.stateDistinct": "{count} distinct patterns",
  "candidates.solver.guided.stateReady": "Ready",
  "candidates.solver.guided.phase.generation": "Generating patterns",
  "candidates.solver.guided.phase.validation": "Checking geometry",
  "candidates.solver.guided.phase.ranking": "Ranking patterns",
  "candidates.solver.guided.phase.complete": "Complete",
  "candidates.solver.guided.phase.normalization": "Checking inputs",
  "candidates.solver.guided.phase.default": "Calculating patterns",
  "candidates.solver.guided.adjust": "Adjust search",
  "candidates.solver.guided.cancelRun": "Cancel calculation",
  "candidates.solver.guided.recalculate": "Recalculate",
  "candidates.solver.guided.generate": "Generate patterns",
  "candidates.solver.guided.adjustParams": "Adjust search parameters",
  "candidates.solver.guided.packageLengthMm": "Package length (mm)",
  "candidates.solver.guided.packageWidthMm": "Package width (mm)",
  "candidates.solver.guided.packageHeightMm": "Package height (mm)",
  "candidates.solver.guided.lengthTotalMm":
    "Total length overhang / underhang (mm)",
  "candidates.solver.guided.widthTotalMm":
    "Total width overhang / underhang (mm)",
  "candidates.solver.guided.maxCandidates": "Max. candidates per generator",
  "candidates.solver.guided.maxPerGrip": "Max. packages per grip",
  "candidates.solver.guided.mixOrientations":
    "Combine lengthwise and crosswise",
  "candidates.solver.multipick": "Allow multipick",
  "candidates.solver.guided.symmetry": "Include mirrored variants",
  "candidates.solver.guided.allowanceHint":
    "The overhang / underhang is split equally between both sides. The search parameters do not change the saved pallet allowance.",
  "candidates.solver.guided.enterCount":
    "Enter the desired number of packages per layer.",
  "candidates.solver.guided.cancelledNotice":
    "Calculation cancelled. No incomplete patterns were applied.",
  "candidates.solver.guided.stale":
    "The search parameters have changed. Please recalculate the patterns.",
  "candidates.solver.guided.noMatch":
    "No matching pattern found. Change the package count or the search parameters.",
  // Solver controls: classic form
  "candidates.solver.title": "Layer solver",
  "candidates.solver.packageDimensions": "Package dimensions · mm",
  "candidates.solver.palletAllowance": "Total pallet allowance · mm",
  "candidates.solver.effectiveFrame": "Effective frame: {length} × {width} mm",
  "candidates.solver.required": "Required",
  "candidates.solver.noGripper":
    "No gripper is selected, so all four orthogonal place yaws are provisionally available. Select a gripper to enforce its exact yaw limits.",
  "candidates.solver.allowMixed":
    "Allow mixed lengthwise / crosswise orientations",
  "candidates.solver.advanced": "Advanced generation",
  "candidates.solver.candidatesSlash": "Candidates / generator",
  "candidates.solver.blockSymmetries": "Include block symmetries",
  "candidates.solver.cancel": "Cancel",
  "candidates.solver.applyAndSolve": "Apply inputs & solve",
  "candidates.solver.preflightFailed": "Preflight failed.",
  "candidates.solver.ready":
    "Ready: {length} × {width} × {height} mm package · {orientation} infeed left to right · L {lengthTotal}/W {widthTotal} mm total · {count} packages · label {label} · mixed orientations {mixed} · automatic grouping {grouping}.",
  "candidates.solver.orientation.lengthwise": "lengthwise",
  "candidates.solver.orientation.crosswise": "crosswise",
  "candidates.solver.labelUnconstrained": "not constrained",
  "candidates.solver.allowed": "allowed",
  "candidates.solver.disabled": "disabled",
  "candidates.solver.groupingEnabled": "enabled up to {limit}",
  "candidates.solver.groupingDisabled": "disabled; singleton picks only",
  "candidates.solver.resultCompleted": "Completed",
  "candidates.solver.resultSummary":
    "{status}: {candidates} candidates ({distinct} distinct layouts) from {drafts} drafts; {invalid} invalid and {merged} equivalent layout variants merged.",
} as const satisfies Record<keyof typeof candidatesDe, string>;
