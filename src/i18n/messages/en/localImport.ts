import type { localImportDe } from "../de/localImport";

export const localImportEn = {
  "localImport.open": "Import local plans",
  "localImport.openCount": "Import local plans ({count})",
  "localImport.title": "Import local plans to the server",
  "localImport.intro":
    "This browser holds plans from local storage. Choose which ones to import to the server. The local originals stay in this browser.",
  "localImport.loading": "Comparing local plans with the server …",
  "localImport.section.projects": "Plans",
  "localImport.section.catalog": "Werkskatalog",
  "localImport.source.legacy": "from the old library",
  "localImport.catalogKind.pallet": "Pallet",
  "localImport.catalogKind.gripper": "Gripper",
  "localImport.catalogKind.pallet-station": "Pallet station",
  "localImport.status.new": "New",
  "localImport.status.unchanged": "Already imported",
  "localImport.status.copied": "Imported as a copy",
  "localImport.status.differs": "Differs",
  "localImport.status.server-unreadable": "Unreadable",
  "localImport.status.admin-only": "Admins only",
  "localImport.statusHint.new": "Will be created with you as creator.",
  "localImport.statusHint.differs":
    "Differs on the server – compare after the import.",
  "localImport.statusHint.server-unreadable":
    "The server entry is unreadable and will not be imported.",
  "localImport.statusHint.admin-only": "Only admins may fill the Werkskatalog.",
  "localImport.select": "Import {name}",
  "localImport.unreadable_one":
    "1 local entry is unreadable and is not offered.",
  "localImport.unreadable_other":
    "{count} local entries are unreadable and are not offered.",
  "localImport.nothingToImport":
    "All local plans are already on the server. There is nothing to import.",
  "localImport.confirmPublic":
    "I understand that imported plans are then readable by everyone on the server – also without signing in, including the original .rob text, file names and product names.",
  "localImport.start": "Import {count}",
  "localImport.running": "Importing …",
  "localImport.close": "Close",
  "localImport.recheck": "Compare again",
  "localImport.result.created_one": "1 entry was imported.",
  "localImport.result.created_other": "{count} entries were imported.",
  "localImport.result.already_one": "1 entry was already on the server.",
  "localImport.result.already_other":
    "{count} entries were already on the server.",
  "localImport.result.conflicts_one":
    "1 plan differs from the server state and awaits your decision.",
  "localImport.result.conflicts_other":
    "{count} plans differ from the server state and await your decision.",
  "localImport.result.failed": "{name} was not imported: {message}",
  "localImport.result.decide": "Compare differences",
  "localImport.result.aborted":
    "The import was aborted. Entries already imported stay on the server; a retry skips them.",
  "localImport.error.load": "Reading local plans failed: {message}",
  "localImport.error.plan": "Comparing with the server failed: {message}",
  "localImport.error.recordTooLarge":
    "The plan is too large. The server allows at most 4 MiB per plan.",
  "localImport.error.unknown": "unknown error",
  "localImport.outcome.kept": "{name}: kept the server state.",
  "localImport.outcome.replaced":
    "{name}: replaced the server state with the local plan.",
  "localImport.outcome.created": "{name}: created anew on the server.",
  "localImport.outcome.copied": "{name}: imported as copy {copy}.",
  "localImport.outcome.copyExists":
    "{name}: this state is already on the server as a copy.",
  "localImport.outcome.forbidden":
    "{name}: only the creator or an admin may replace it.",
  "localImport.outcome.postponed_one": "1 difference remains open.",
  "localImport.outcome.postponed_other": "{count} differences remain open.",
  "localImport.catalogConflict.heading": "Differing Werkskatalog entries",
  "localImport.catalogConflict.local": "Local: {name}",
  "localImport.catalogConflict.server": "Server: {name} (version {version})",
  "localImport.catalogConflict.serverDeleted": "Deleted on the server",
  "localImport.catalogConflict.refreshed":
    "The server entry changed again – please decide again.",
  "localImport.catalogCopyName": "{name} copy",
  "localImport.conflict.title": "This plan already exists on the server",
  "localImport.conflict.intro":
    "The server holds a different plan state under this ID. Choose one complete plan state or import the local plan as a copy with a new ID. Creator and permissions of the server plan do not change.",
  "localImport.conflict.serverDeleted":
    "The plan was deleted on the server meanwhile. You can create the local plan anew or import it as a copy.",
  "localImport.conflict.mineHeading": "Local plan",
  "localImport.conflict.mineCaption": "From this browser",
  "localImport.conflict.keepMine": "Use the local state",
  "localImport.conflict.keepMineHint":
    "Replaces the server state – only if it has not changed again.",
  "localImport.conflict.keepMineForbidden":
    "Only the creator or an admin may replace this plan.",
  "localImport.conflict.keepServer": "Keep the server state",
  "localImport.conflict.keepServerHint":
    "Nothing is imported; the local plan stays in the browser.",
  "localImport.conflict.keepServerDeleted": "Do not import",
  "localImport.conflict.keepServerDeletedHint":
    "The local plan stays in the browser only.",
  "localImport.conflict.saveCopy": "Import as a copy",
  "localImport.conflict.saveCopyHint":
    "A new plan with a new ID and you as creator; the server plan stays unchanged.",
  "localImport.conflict.later": "Decide later",
  "localImport.conflict.laterHint":
    "Closes the comparison; it appears again on the next import.",
} satisfies Record<keyof typeof localImportDe, string>;
