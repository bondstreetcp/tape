"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Action {
  symbol: string;
  name: string;
  firm: string;
  action: string;
  fromGrade: string;
  toGrade: string;
  targetFrom: number | null;
  targetTo: number | null;
  date: string;
}

const ACTION: Record<string, { label: string; color: string }> = {
  up: { label: "Upgrade", color: "#22c55e" },
  down: { label: "Downgrade", color: "#ef4444" },
  init: { label: "Initiate", color: "#60a5fa" },
  main: { label: "Maintain", color: "#8b93a7" },
  reit: { label: "Reiterate", color: "#8b93a7" },
};

export default function AnalystFeed({ universe }: { universe: string }) {
  const router = useRouter();
  const [actions, setActions] = useState<Action[] | null>(null);

  useEffect(() => {
    let alive = true;
    setActions(null);
    fetch(`/api/analyst-actions?universe=${encodeURIComponent(universe)}`)
      .then((r) => r.json())
      .then((d) => alive && setActions(d.actions || []))
      .catch(() => alive && setActions([]));
    return () => {
      alive = false;
    };
  }, [universe]);

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-[#aab2c5]">Recent analyst actions <span className="font-normal text-[#8b93a7]">· largest names</span></h2>
      <div className="overflow-hidden rounded-xl border border-[#2a2e39] bg-[#131722]">
        {actions === null ? (
          <div className="p-6 text-center text-sm text-[#8b93a7]">Loading analyst actions…</div>
        ) : actions.length === 0 ? (
          <div className="p-6 text-center text-sm text-[#8b93a7]">No recent rating changes.</div>
        ) : (
          <div className="max-h-[420px] divide-y divide-[#1f2430] overflow-y-auto">
            {actions.map((a, i) => {
              const meta = ACTION[a.action] || { label: a.action || "—", color: "#8b93a7" };
              return (
                <div
                  key={i}
                  onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(a.symbol)}/financials?tab=stats`)}
                  className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2 text-sm transition-colors hover:bg-[#1a1f2e]"
                >
                  <span className="w-14 font-mono font-semibold">{a.symbol}</span>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{ background: meta.color + "22", color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <span className="text-[#aab2c5]">{a.firm}</span>
                  {(a.fromGrade || a.toGrade) && (
                    <span className="text-xs text-[#8b93a7]">
                      {a.fromGrade ? `${a.fromGrade} → ` : ""}{a.toGrade}
                    </span>
                  )}
                  {a.targetTo != null && (
                    <span className="text-xs text-[#8b93a7]">
                      PT {a.targetFrom != null ? `$${a.targetFrom.toFixed(0)} → ` : ""}<span className="text-[#aab2c5]">${a.targetTo.toFixed(0)}</span>
                    </span>
                  )}
                  <span className="ml-auto text-[11px] tabular-nums text-[#5b6478]">{a.date}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
