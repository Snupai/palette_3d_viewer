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
    <label className="ed-field">
      {label}
      <input
        type="number"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="ui-input"
      />
    </label>
  );
}
