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
    <div className="inline-flex items-center gap-2 text-sm text-[#8b93a7]">
      <span>{label}</span>
      <div className="inline-flex rounded-lg border border-[#2a2e39] bg-[#131722] p-1">
        {OPTIONS.map((o) => {
          const active = o === value;
          return (
            <button
              key={o}
              onClick={() => onChange(o)}
              className={
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "bg-[#2563eb] text-white"
                  : "text-[#8b93a7] hover:text-[#e6e9f0]")
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
