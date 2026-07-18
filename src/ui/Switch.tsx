/**
 * The single on/off pill toggle used everywhere in the app. Keeps every
 * boolean setting looking and behaving identically (and accessibly) instead of
 * a mix of custom pills and raw checkboxes.
 */
export function Switch(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`switch ${props.checked ? "on" : ""}`}
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      title={props.title}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="knob" />
    </button>
  );
}
