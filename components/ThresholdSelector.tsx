"use client";

const OPTIONS = [1, 2, 5, 10];

export default function ThresholdSelector({
  value,
  onChange,
  label = "Within",
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  return (
    <div className="inline-flex items-center gap-2 text-sm text-[var(--text-3)]">
      <span>{label}</span>
      <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
        {OPTIONS.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              onClick={() => onChange(o)}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "bg-[var(--accent-strong)] text-white"
                  : "text-[var(--text-3)] hover:text-[var(--text)]")
              }
            >
              {o}%
            </button>
          );
        })}
      </div>
      <span>of 52-wk high/low</span>
    </div>
  );
}
