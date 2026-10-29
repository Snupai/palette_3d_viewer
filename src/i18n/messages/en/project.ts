import type { projectDe } from "../de/project";

export const projectEn = {
  // Tool titles
  "project.tool.candidateBrowser": "Candidate browser",
  "project.tool.candidate3d": "Candidate 3D inspection",
  "project.tool.stack": "Stack composer",
  "project.tool.editor": "Pattern editor",
  "project.tool.robotics": "Robotics & gripper",
  "project.tool.simulation": "Simulation",
  "project.tool.report": "Pallet sheet",
  "project.tool.fallback": "Tool",
  // Labels
  "project.untitledPlan": "Untitled plan",
  "project.geometryReview":
    "Dimensions or handling were changed. Saved solutions are kept, but must be rebuilt and checked before robotics and export.",
  // Errors and status messages
  "project.error.libraryFailed": "Project library failed: {message}",
  "project.error.libraryFailedGeneric": "Project library failed.",
  "project.status.legacyImported_one":
    "Imported {count} legacy .rob library entry as a non-destructive planner project.",
  "project.status.legacyImported_other":
    "Imported {count} legacy .rob library entries as non-destructive planner projects.",
  "project.error.migrationFailed": "Legacy library migration failed: {message}",
  "project.error.migrationFailedGeneric": "Legacy library migration failed.",
  "project.error.reopenMissing": 'Project "{id}" could not be reopened.',
  "project.error.reopenFailed": "Project reopen failed: {message}",
  "project.error.reopenFailedGeneric": "Project reopen failed.",
  "project.status.planSaved": 'Plan "{name}" saved.',
  "project.status.duplicated": 'Project duplicated as "{name}".',
  "project.error.sourceMissing": "The source project is missing.",
  "project.error.duplicateFailed": "Duplicate failed: {message}",
  "project.error.duplicateFailedGeneric": "Duplicate failed.",
  "project.status.savedAs": 'Project saved as "{name}".',
  "project.error.saveAsFailed": "Save as failed: {message}",
  "project.error.saveAsFailedGeneric": "Save as failed.",
  "project.error.projectGone": "The project no longer exists.",
  "project.status.deleted": 'Project "{name}" deleted.',
  "project.error.deleteFailed": "Delete failed: {message}",
  "project.error.deleteFailedGeneric": "Delete failed.",
  "project.error.robDownloadFailed": ".rob download failed: {message}",
  "project.status.downloaded": "Downloaded {fileName}.",
  "project.fallbackName": "project",
  "project.status.exportedSelected":
    "Selected project and reusable resource library exported.",
  "project.status.exportedAll":
    "Project and reusable resource libraries exported.",
  "project.error.exportFailed": "Export failed: {message}",
  "project.error.exportFailedGeneric": "Export failed.",
  "project.status.imported":
    "Imported {projects} project(s) and {resources} resource(s); skipped {skippedProjects} project(s) and {skippedResources} resource(s).",
  "project.error.importFailed": "Import failed: {message}",
  "project.error.importFailedGeneric": "Import failed.",
  "project.status.robOpened": 'Opened "{name}" as the current plan.',
  "project.error.robImportFailed": ".rob import failed: {message}",
  "project.error.robImportFailedGeneric": ".rob import failed.",
  "project.error.projectRequired":
    "A current project is required before generation.",
  "project.error.editorDirtyBeforeInputs":
    "Save or discard project editor changes before applying generator inputs.",
  "project.status.generatorInputsApplied":
    "Generator package inputs applied: {length} × {width} × {height} mm · {orientation} infeed left to right · automatic multipick grouping {multipick}.",
  "project.enabled": "enabled",
  "project.disabled": "disabled",
  "project.error.editorDirtyBeforeStack":
    "Save or discard project editor changes before replacing the active solution stack.",
  "project.confirm.replaceStack":
    "Replace the saved stack ({existing} layers) with the current draft ({draft} layers)?",
  "project.status.stackSaved":
    "Stack saved: {packages} packages on {layers} layers.",
  // Confirms and prompts
  "project.confirm.discardUnsaved": "{action}: Discard unsaved changes?",
  "project.confirm.discardInTool":
    '{action}: Discard unsaved changes in "{tool}"?',
  "project.action.switchProjects": "Switch projects",
  "project.action.openTool": "Open {tool}",
  "project.action.close": "Close",
  "project.action.duplicate": "Duplicate this project",
  "project.action.saveAs": "Save this project as a copy",
  "project.action.openRob": "Open the .rob file as a project",
  "project.action.createPlan": "Create new plan",
  "project.action.openPlanList": "Open plan list",
  "project.action.openHome": "Open home page",
  "project.copySuffix": "{number} copy",
  "project.copy": "Copy",
  "project.newLine": "New line",
  "project.prompt.lineNumber": "Line number for the new copy",
  "project.prompt.productNumber": "Product number for the new copy",
  "project.confirm.deleteOpen":
    'Delete "{name}" and discard unsaved planner changes?',
  "project.confirm.changePattern":
    "Choose another pattern: Unsaved stack changes are lost when you select another pattern. Continue?",
  "project.confirm.closeInputs": "Close inputs: Discard unsaved inputs?",
  "project.confirm.changedDimensions":
    "Changed dimensions: Discard unsaved stack and editor changes?",
  // Steps
  "project.steps.label": "Planning steps",
  "project.steps.packagePallet": "Package & pallet",
  "project.steps.pickPattern": "Choose pattern",
  "project.steps.buildStack": "Build stack",
  // Validation ledger
  "project.ledger.importedPlan": "Imported plan",
  "project.ledger.importedClaim":
    "The current geometry comes from the imported .rob file; a second reference plan is not required.",
  "project.ledger.importedDetail": "{layers} layers · {packages} packages",
  "project.ledger.currentGeometry": "Current geometry",
  "project.ledger.candidatePassed":
    "The selected solver candidate passed internal geometry checks.",
  "project.ledger.candidateFailed":
    "The selected solver candidate failed internal geometry checks.",
  "project.ledger.importedLayerShown":
    "The imported layer geometry is shown as the current plan.",
  "project.ledger.savedLayerObservable":
    "A saved current layer is observable; solver validation was not rerun.",
  "project.ledger.noGeometry": "No current layer geometry is available.",
  "project.ledger.candidateDetail": "Candidate {rank} · {packages} packages",
  "project.ledger.robotReadiness": "Robot readiness",
  "project.ledger.robotPass":
    "Plan, equipment, pickup point, station workspace, and modeled obstacles passed the available internal checks.",
  "project.ledger.robotObservedEquipment":
    "The observed Multipack equipment profile is selected; current checks do not establish calibrated production readiness.",
  "project.ledger.robotObserved":
    "Robot checks completed with unverified or uncalibrated limitations.",
  "project.ledger.robotSkipped":
    "No robot-readiness pass is claimed because at least one workspace check was not run.",
  "project.ledger.robotBlocked":
    "Complete the plan, equipment, pickup point, and station workspace checks before robot readiness can pass.",
  "project.ledger.exportReadiness": "Export readiness",
  "project.ledger.exportClaim":
    "Production coordinate mapping, quantization, and unknown .rob fields require explicit review in Robotics.",
  // Candidate 3D / .rob download
  "project.candidate3d.empty":
    "Select a generated candidate before opening 3D inspection.",
  "project.download.noRobText": "This project keeps no .rob file text.",
  "project.download.noStack":
    "Save a stack for this project before downloading a .rob plan.",
  "project.download.exportFailed": "The .rob plan could not be exported.",
  // Sheet extraction
  "project.sheet.extractionFailed": "Sheet extraction failed ({status}).",
  // Project library
  "project.library.untitled": "Untitled project",
  "project.library.title": "Projects",
  "project.library.new": "New",
  "project.library.searchLabel": "Search projects",
  "project.library.searchPlaceholder": "ID, line, product, file…",
  "project.library.lineFilter": "Line filter",
  "project.library.lineFilterLabel": "Filter line number",
  "project.library.lineFilterPlaceholder": "Line no.",
  "project.library.productFilter": "Product filter",
  "project.library.productFilterLabel": "Filter product number",
  "project.library.productFilterPlaceholder": "Product no.",
  "project.library.sort": "Sort",
  "project.library.sort.updatedDesc": "Recently updated",
  "project.library.sort.updatedAsc": "Oldest update",
  "project.library.sort.lineAsc": "Line number A–Z",
  "project.library.sort.lineDesc": "Line number Z–A",
  "project.library.sort.productAsc": "Product number A–Z",
  "project.library.sort.productDesc": "Product number Z–A",
  "project.library.sort.createdDesc": "Recently created",
  "project.library.loading": "Loading projects…",
  "project.library.empty": "No projects match the current search.",
  "project.library.listLabel": "Project library",
  "project.library.noLineNumber": "No line number",
  "project.library.actionsFor": "Actions for {title}",
  "project.library.edit": "Edit",
  "project.library.duplicate": "Duplicate",
  "project.library.saveAs": "Save as",
  "project.library.export": "Export",
  "project.library.downloadRob": "Download .rob",
  "project.library.downloadImportedTitle": "Download the imported .rob file",
  "project.library.downloadDerivedTitle":
    "Download the .rob plan derived from the saved stack",
  "project.library.deleteQuestion": "Delete project?",
  "project.library.delete": "Delete",
  "project.library.cancel": "Cancel",
  "project.library.deleteTitle": "Shift+click deletes without confirmation",
  "project.library.exportAll": "Export all projects",
  "project.library.projectConflict": "Project conflict",
  "project.library.projectConflictLabel": "Project import conflict policy",
  "project.library.resourceConflict": "Resource conflict",
  "project.library.resourceConflictLabel": "Resource import conflict policy",
  "project.library.policy.rename": "Rename incoming",
  "project.library.policy.skip": "Skip incoming",
  "project.library.policy.overwrite": "Overwrite existing",
  "project.library.import": "Import project + resource package",
} as const satisfies Record<keyof typeof projectDe, string>;
