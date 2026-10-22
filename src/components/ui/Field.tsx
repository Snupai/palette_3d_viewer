import type { ReactNode } from "react";

/** Label + control + inline error. The control is passed as children. */
export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`grid min-w-0 gap-1 text-micro font-medium text-muted ${className}`}
    >
      <span>
        {label}
        {hint ? <span className="font-normal"> {hint}</span> : null}
      </span>
      {children}
      {error ? <span className="text-micro text-danger">{error}</span> : null}
    </label>
  );
}

/**
 * Number input that keeps the raw text while typing. `onValue` receives the
 * parsed number, or null when the field is empty or not a finite number.
 */
export function NumberField({
  label,
  hint,
  value,
  onChange,
  onValue,
  error,
  integer = false,
  min,
  max,
  step,
  unit,
  placeholder,
  disabled = false,
  touch = false,
  className = "",
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string | number | null;
  onChange?: (raw: string) => void;
  onValue?: (value: number | null) => void;
  error?: string | null | undefined;
  integer?: boolean;
  min?: number;
  max?: number;
  step?: number | "any";
  unit?: string;
  placeholder?: string;
  disabled?: boolean;
  touch?: boolean;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      <span className="flex min-w-0 items-stretch">
        <input
          type="number"
          inputMode={integer ? "numeric" : "decimal"}
          min={min}
          max={max}
          step={step ?? (integer ? 1 : "any")}
          value={value ?? ""}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            onChange?.(raw);
            onValue?.(parseNumberInput(raw));
          }}
          className={`ui-input min-w-0 font-mono ${touch ? "min-h-11 text-base" : "text-xs"}`}
        />
        {unit ? (
          <span className="flex items-center border border-l-0 border-line bg-surface px-2 font-mono text-micro text-muted">
            {unit}
          </span>
        ) : null}
      </span>
    </Field>
  );
}

export function parseNumberInput(raw: string): number | null {
  if (raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
