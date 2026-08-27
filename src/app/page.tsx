"use client";

import { useEffect, useState } from "react";
import { MobilePlanner } from "~/features/mobile/MobilePlanner";
import { PlannerProjectWorkspace } from "~/features/project/PlannerProjectWorkspace";

const MOBILE_LAYOUT_QUERY =
  "(max-width: 767px), (pointer: coarse) and (max-width: 1023px)";

export default function HomePage() {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [useMobileLayout, setUseMobileLayout] = useState<boolean | null>(null);

  useEffect(() => {
    const forceDesktop =
      new URLSearchParams(window.location.search).get("layout") === "desktop";
    setUseMobileLayout(
      !forceDesktop && window.matchMedia(MOBILE_LAYOUT_QUERY).matches,
    );
  }, []);

  if (useMobileLayout === null) {
    return <main className="h-dvh bg-[var(--canvas)]" />;
  }

  if (useMobileLayout) {
    return <MobilePlanner />;
  }

  return (
    <main className="flex h-screen min-h-[640px] flex-col overflow-hidden bg-[var(--canvas)] text-[var(--ink)]">
      <PlannerProjectWorkspace onUnsavedChange={setHasUnsavedChanges} />
      <span className="sr-only" aria-live="polite">
        {hasUnsavedChanges
          ? "The active planning case has unsaved changes."
          : "The active planning case is stored."}
      </span>
    </main>
  );
}
