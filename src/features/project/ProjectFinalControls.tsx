"use client";
import { useId } from "react";

import type { ProjectFinalControls as Controls } from "./projectFinalModel";

/**
 * "Als fertig markieren" / "Nicht mehr fertig" next to the `.rob` download
 * (ADR 0013). All state comes from `projectFinalControls`.
 */
export function ProjectFinalControls({
  controls,
  onMark,
  onWithdraw,
}: {
  controls: Controls & { visible: true };
  onMark: () => void;
  onWithdraw: () => void;
}) {
  const noteId = useId();
  const { mark, withdraw, hint } = controls;
  const note = mark?.disabledReason ?? hint;
  return (
    <div className="final-controls">
      <div className="button-row">
        {withdraw && (
          <button
            type="button"
            className="ui-btn"
            disabled={withdraw.disabledReason !== null}
            title={withdraw.disabledReason ?? undefined}
            onClick={onWithdraw}
          >
            {withdraw.label}
          </button>
        )}
        {mark && (
          <button
            type="button"
            className="ui-btn"
            disabled={mark.disabledReason !== null}
            title={mark.disabledReason ?? undefined}
            aria-describedby={note ? noteId : undefined}
            onClick={onMark}
          >
            {mark.label}
          </button>
        )}
      </div>
      {note && (
        <p id={noteId} className="final-controls-note" aria-live="polite">
          {note}
        </p>
      )}
    </div>
  );
}
