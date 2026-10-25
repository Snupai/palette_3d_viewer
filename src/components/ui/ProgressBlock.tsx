import { useT } from "~/i18n";

/** Determinate progress readout for long runs (solver, exports). */
export function ProgressBlock({
  label,
  completed,
  total,
  detail,
  onCancel,
  cancelLabel,
}: {
  label: string;
  completed: number;
  total: number;
  detail?: string | null;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const t = useT();
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="text-micro flex items-baseline gap-2">
        <span className="text-ink mr-auto font-semibold">{label}</span>
        <span className="text-muted font-mono">
          {safeCompleted}/{safeTotal}
        </span>
        {onCancel ? (
          <button
            type="button"
            className="ui-btn ui-btn-sm ui-btn-ghost"
            onClick={onCancel}
          >
            {cancelLabel ?? t("components.progress.cancel")}
          </button>
        ) : null}
      </div>
      <progress
        className="bg-line [&::-moz-progress-bar]:bg-brand [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:bg-brand h-1 w-full appearance-none overflow-hidden"
        max={safeTotal || 1}
        value={safeTotal === 0 ? 0 : safeCompleted}
      />
      {detail ? (
        <p className="text-micro text-muted truncate font-mono">{detail}</p>
      ) : null}
    </div>
  );
}
