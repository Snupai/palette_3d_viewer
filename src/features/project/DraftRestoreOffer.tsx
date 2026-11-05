"use client";

import { useLocale } from "~/i18n";

import type { DraftBackup } from "./draftBackupModel";

/**
 * Offers the signed-in user's local draft backups after a re-login or a
 * reload (ADR 0002, #35). Restoring saves through the normal versioned path.
 */
export function DraftRestoreOffer({
  backups,
  busy,
  label,
  onRestore,
  onDiscard,
}: {
  backups: readonly DraftBackup[];
  busy: boolean;
  label: (backup: DraftBackup) => string;
  onRestore: (backup: DraftBackup) => void;
  onDiscard: (backup: DraftBackup) => void;
}) {
  const { t, tag } = useLocale();
  if (backups.length === 0) return null;
  const time = new Intl.DateTimeFormat(tag, {
    dateStyle: "short",
    timeStyle: "short",
  });
  return (
    <div className="fable-page">
      <section
        className="fable-notice draft-restore"
        aria-label={t("project.draft.restoreTitle")}
      >
        <strong>{t("project.draft.restoreTitle")}</strong>
        <span>{t("project.draft.restoreHint")}</span>
        <ul>
          {backups.map((backup) => (
            <li key={backup.projectId}>
              <span>
                {label(backup)} ·{" "}
                {t("project.draft.backedUpAt", {
                  time: time.format(backup.savedAt),
                })}
              </span>
              <button
                type="button"
                className="ui-btn-primary"
                disabled={busy}
                onClick={() => onRestore(backup)}
              >
                {t("project.draft.restore")}
              </button>
              <button
                type="button"
                className="text-action"
                disabled={busy}
                onClick={() => onDiscard(backup)}
              >
                {t("project.draft.discard")}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
