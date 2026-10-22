import {
  type StatusTone,
  statusToneBorder,
  statusToneSymbol,
  statusToneText,
} from "./statusTone";

/** Compact mono status marker: symbol + label, coloured by tone. */
export function StatusBadge({
  tone,
  label,
  framed = false,
  className = "",
}: {
  tone: StatusTone;
  label: string;
  framed?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-micro font-semibold whitespace-nowrap ${statusToneText[tone]} ${
        framed ? `border px-1.5 py-px ${statusToneBorder[tone]}` : ""
      } ${className}`}
    >
      <span aria-hidden="true">{statusToneSymbol[tone]}</span>
      {label}
    </span>
  );
}

/** Inline message box for errors, warnings and notices. */
export function Notice({
  tone,
  children,
  className = "",
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "blocked" ? "alert" : "status"}
      className={`border-l-2 bg-canvas px-3 py-2 text-micro text-ink ${statusToneBorder[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
