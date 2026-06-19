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
    <div className="inline-flex rounded-lg border border-[#2a2e39] bg-[#131722] p-1">
      {TIMEFRAMES.map((t) => {
        const active = t.key === value;
        return (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (active
                ? "bg-[#2563eb] text-white"
                : "text-[#8b93a7] hover:text-[#e6e9f0]")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
