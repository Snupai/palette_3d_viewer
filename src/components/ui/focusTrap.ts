const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Index to focus when Tab leaves the trapped range, or null when the browser
 * default is fine. `current` is -1 when focus is outside the container.
 */
export function wrapFocusIndex(
  current: number,
  count: number,
  backwards: boolean,
): number | null {
  if (count === 0) return null;
  if (current === -1) return backwards ? count - 1 : 0;
  if (backwards && current === 0) return count - 1;
  if (!backwards && current === count - 1) return 0;
  return null;
}

/**
 * Keydown handling for a modal opened over other surfaces. Register it on
 * `window` in the capture phase: it claims Escape and Tab before a Drawer's
 * document-level listener (which would close the tool or pull focus back),
 * calls `onEscape` for Escape and keeps Tab focus inside `dialog` — on the
 * dialog itself while every control is disabled.
 */
export function claimModalKeys(
  event: KeyboardEvent,
  dialog: HTMLElement,
  onEscape: () => void,
): void {
  if (event.key !== "Escape" && event.key !== "Tab") return;
  event.stopImmediatePropagation();
  if (event.key === "Escape") {
    event.preventDefault();
    onEscape();
    return;
  }
  const items = focusableWithin(dialog);
  if (items.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const index = items.findIndex((item) => item === document.activeElement);
  const next = wrapFocusIndex(index, items.length, event.shiftKey);
  if (next !== null) {
    event.preventDefault();
    items[next]?.focus();
  }
}
