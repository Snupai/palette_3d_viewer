"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { focusableWithin, wrapFocusIndex } from "./focusTrap";

/**
 * Modal surface for the planner. `wide` covers the viewport (production
 * tools), `narrow` opens at the left edge under the Projects button
 * (library), `dialog` is centred.
 * Escape closes, Tab stays inside, focus returns to the opener on close.
 */
export function Drawer({
  open,
  title,
  width = "wide",
  onClose,
  actions,
  children,
}: {
  open: boolean;
  title: string;
  width?: "narrow" | "wide" | "dialog";
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      (focusableWithin(panel)[0] ?? panel).focus();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = focusableWithin(panelRef.current);
      const active = document.activeElement;
      const index = items.findIndex((item) => item === active);
      const next = wrapFocusIndex(index, items.length, event.shiftKey);
      if (next !== null) {
        event.preventDefault();
        items[next]?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const layout =
    width === "wide"
      ? "w-full h-full"
      : width === "narrow"
        ? "h-full w-[min(420px,calc(100vw-32px))] border-r border-line shadow-[0_2px_8px_rgba(0,0,0,0.1)]"
        : "max-h-[calc(100dvh-48px)] w-[min(720px,calc(100vw-32px))] border border-line shadow-[0_2px_8px_rgba(0,0,0,0.1)]";

  return (
    <div
      role="presentation"
      className={`fixed inset-0 z-40 flex ${
        width === "wide"
          ? ""
          : width === "narrow"
            ? "justify-start bg-black/50"
            : "items-center justify-center bg-black/50 p-4"
      }`}
    >
      {width !== "wide" ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${title} schließen`}
          onClick={onClose}
          className="absolute inset-0 cursor-default"
        />
      ) : null}
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`bg-surface text-ink relative grid min-w-0 grid-rows-[44px_minmax(0,1fr)] outline-none ${layout}`}
      >
        <header className="app-chrome border-line flex items-center gap-2 border-b px-3">
          <h2 className="text-body mr-auto truncate font-semibold">{title}</h2>
          {actions}
          <button type="button" onClick={onClose} className="ui-btn ui-btn-sm">
            Schließen
          </button>
        </header>
        <div className="scrollbar-thin min-h-0 overflow-auto">{children}</div>
      </section>
    </div>
  );
}
