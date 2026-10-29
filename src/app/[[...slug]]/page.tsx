"use client";
import { useState } from "react";
import { PlannerProjectWorkspace } from "~/features/project/PlannerProjectWorkspace";
import { useT } from "~/i18n";
export default function HomePage() {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const t = useT();
  return (
    <main className="fable-app">
      <PlannerProjectWorkspace onUnsavedChange={setHasUnsavedChanges} />
      <span className="sr-only" aria-live="polite">
        {hasUnsavedChanges ? t("shell.unsaved") : t("shell.saved")}
      </span>
    </main>
  );
}
