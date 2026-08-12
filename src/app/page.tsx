"use client";

import { useState } from "react";
import { PlannerProjectWorkspace } from "~/features/project/PlannerProjectWorkspace";

export default function HomePage() {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  return (
    <main className="flex h-screen min-h-[640px] flex-col overflow-hidden bg-[var(--deck-black)] text-[var(--chalk-text)]">
      <PlannerProjectWorkspace onUnsavedChange={setHasUnsavedChanges} />
      <span className="sr-only" aria-live="polite">
        {hasUnsavedChanges
          ? "The active planning case has unsaved changes."
          : "The active planning case is stored."}
      </span>
    </main>
  );
}
