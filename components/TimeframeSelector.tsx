"use client";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/timeframes";

export default function TimeframeSelector({
  value,
  onChange,
}: {
  value: TimeframeKey;
  onChange: (tf: TimeframeKey) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1">
      {TIMEFRAMES.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (active
                ? "bg-[var(--accent-strong)] text-white"
                : "text-[var(--text-3)] hover:text-[var(--text)]")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
