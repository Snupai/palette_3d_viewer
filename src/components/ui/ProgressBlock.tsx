/** Determinate progress readout for long runs (solver, exports). */
export function ProgressBlock({
  label,
  completed,
  total,
  detail,
  onCancel,
  cancelLabel = "Cancel",
}: {
  label: string;
  completed: number;
  total: number;
  detail?: string | null;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const safeTotal = Math.max(0, total);
  const safeCompleted = Math.min(Math.max(0, completed), safeTotal);
  return (
    <div className="grid gap-1.5" aria-live="polite">
      <div className="flex items-baseline gap-2 text-micro">
        <span className="mr-auto font-semibold text-ink">{label}</span>
        <span className="font-mono text-muted">
          {safeCompleted}/{safeTotal}
        </span>
        {onCancel ? (
          <button
            type="button"
            className="ui-btn ui-btn-sm ui-btn-ghost"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
        ) : null}
      </div>
      <progress
        className="h-1 w-full appearance-none overflow-hidden bg-line [&::-moz-progress-bar]:bg-brand [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:bg-brand"
        max={safeTotal || 1}
        value={safeTotal === 0 ? 0 : safeCompleted}
      />
      {detail ? (
        <p className="truncate font-mono text-micro text-muted">{detail}</p>
      ) : null}
    </div>
  );
}
