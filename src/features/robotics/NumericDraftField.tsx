import {
  fieldLabelClass,
  inputClass,
} from "~/features/robotics/roboticsStyles";

/** Number input that keeps the raw draft string (settings store strings). */
export function NumericDraftField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={fieldLabelClass}>
      {label}
      <input
        type="number"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`${inputClass} font-mono`}
      />
    </label>
  );
}
