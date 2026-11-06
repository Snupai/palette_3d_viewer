import type { browserSyncDe } from "../de/browserSync";

export const browserSyncEn = {
  "browserSync.running": "Syncing browser plans …",
  "browserSync.saveFirst":
    "Save or discard changes to the open browser plan first.",
  "browserSync.open": "Sync browser plans ({count})",
  "browserSync.title": "Sync browser plans",
  "browserSync.intro":
    "Choose the browser plans to publish on this server. You decide each difference in a comparison.",
  "browserSync.retention":
    "After successful sync, the local copy is removed. Plans you keep local and browser plans changed in the meantime remain here.",
  "browserSync.dismissal":
    "Later hides this offer for your account in this tab until the browser session ends. You can reopen it anytime using the header button.",
  "browserSync.loading": "Comparing browser plans …",
  "browserSync.empty": "No browser plans need syncing.",
  "browserSync.select": "Sync {name}",
  "browserSync.start": "Sync {count}",
  "browserSync.later": "Later",
  "browserSync.close": "Close",
  "browserSync.retry": "Compare again and continue",
  "browserSync.progress": "{done}/{total} plans processed",
  "browserSync.summary":
    "{synced} synced · {local} kept local · {failed} failed",
  "browserSync.pending": "{count} differences await your decision.",
  "browserSync.decide": "Compare differences",
  "browserSync.sessionLost":
    "Your session has expired. Results are kept. Sign in again to continue.",
  "browserSync.networkLost":
    "The connection was interrupted. Results are kept. Compare again to continue.",
  "browserSync.unreadable":
    "{count} local entries could not be read and remain in this browser.",
  "browserSync.result.synced": "Synced",
  "browserSync.result.kept-local": "Kept local",
  "browserSync.result.failed": "Failed: {reason}",
  "browserSync.result.conflict": "Decision pending",
  "browserSync.result.retained": "Synced; newer browser changes remain local.",
  "browserSync.status.new": "New",
  "browserSync.status.unchanged": "Already synced",
  "browserSync.status.local-changed": "Changed in browser",
  "browserSync.status.server-changed": "Changed on server",
  "browserSync.status.conflict": "Changed on both sides",
  "browserSync.status.server-deleted": "Deleted on server",
  "browserSync.status.other-owner": "Different creator",
  "browserSync.status.server-unreadable": "Server state unreadable",
  "browserSync.deletedNoReplace":
    "A deleted server plan can only be published as a new copy.",
} satisfies Record<keyof typeof browserSyncDe, string>;
