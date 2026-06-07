import type { Intensity } from "./useChat";

const OPTIONS: { value: Intensity; label: string }[] = [
  { value: "chill", label: "Chill" },
  { value: "sharp", label: "Sharp" },
];

export default function IntensityToggle({
  value,
  onChange,
}: {
  value: Intensity;
  onChange: (next: Intensity) => void;
}) {
  return (
    <div
      role="group"
      aria-label="ナッジーの熱度"
      className="inline-flex rounded-full border border-[var(--chip-line)] bg-[var(--chip-bg)] p-1"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
            value === option.value
              ? "bg-[var(--lagoon)] text-white shadow-[0_4px_12px_rgba(30,90,72,0.18)]"
              : "text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
