"use client";

interface Props {
  value: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  label: string;
  className?: string;
  /** Colour of the filled part. */
  color?: string;
  title?: string;
}

/** Slider whose filled part is drawn with a gradient, so it matches the app instead of the browser. */
export default function RangeSlider({
  value, max, step, onChange, label, className = "", color = "#3b82f6", title,
}: Props) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <input
      type="range"
      min={0}
      max={max || 1}
      step={step}
      value={value}
      title={title}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`player-range ${className}`}
      style={{ background: `linear-gradient(to right, ${color} ${pct}%, #252735 ${pct}%)` }}
    />
  );
}
