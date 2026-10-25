"use client";
import { useState } from "react";
import { PlannerProjectWorkspace } from "~/features/project/PlannerProjectWorkspace";
export default function HomePage() {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  return (
    <main className="fable-app">
      <PlannerProjectWorkspace onUnsavedChange={setHasUnsavedChanges} />
      <span className="sr-only" aria-live="polite">
        {hasUnsavedChanges
          ? "Der Plan enthält ungespeicherte Änderungen."
          : "Der Plan ist lokal gespeichert."}
      </span>
    </main>
  );
}
