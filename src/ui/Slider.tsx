/**
 * Styled range slider with a filled track. Fill percentage drives a CSS
 * custom property consumed by App.css.
 */
export function Slider(props: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  const pct = ((props.value - props.min) / (props.max - props.min)) * 100;
  return (
    <input
      type="range"
      className={`slider ${props.className ?? ""}`}
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      disabled={props.disabled}
      title={props.title}
      style={{ "--pct": `${Math.max(0, Math.min(100, pct))}%` } as React.CSSProperties}
      onChange={(e) => props.onChange(Number(e.target.value))}
    />
  );
}
