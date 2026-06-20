"use client";
import { useEffect, useRef, useState } from "react";
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

const PAGE = 30;

export default function AnalystFeed({ universe }: { universe: string }) {
  const router = useRouter();
  const [actions, setActions] = useState<Action[] | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    setActions(null);
    setVisible(PAGE);
    fetch(`/api/analyst-actions?universe=${encodeURIComponent(universe)}`)
      .then((r) => r.json())
      .then((d) => alive && setActions(d.actions || []))
      .catch(() => alive && setActions([]));
    return () => {
      alive = false;
    };
  }, [universe]);

  // Infinite scroll: reveal another page when the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setVisible((v) => v + PAGE), {
      root: el.parentElement,
      rootMargin: "150px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [actions]);

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-[#aab2c5]">
        Recent analyst actions <span className="font-normal text-[#8b93a7]">· largest names</span>
      </h2>
      <div className="overflow-hidden rounded-xl border border-[#2a2e39] bg-[#131722]">
        {actions === null ? (
          <div className="p-6 text-center text-sm text-[#8b93a7]">Loading analyst actions…</div>
        ) : actions.length === 0 ? (
          <div className="p-6 text-center text-sm text-[#8b93a7]">No recent rating changes.</div>
        ) : (
          <div className="max-h-[460px] divide-y divide-[#1f2430] overflow-y-auto">
            {actions.slice(0, visible).map((a, i) => {
              const meta = ACTION[a.action] || { label: a.action || "—", color: "#8b93a7" };
              return (
                <div
                  key={i}
                  onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(a.symbol)}/financials?tab=stats`)}
                  className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2 text-sm transition-colors hover:bg-[#1a1f2e]"
                >
                  <span className="w-14 font-mono font-semibold">{a.symbol}</span>
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: meta.color + "22", color: meta.color }}>
                    {meta.label}
                  </span>
                  <span className="text-[#aab2c5]">{a.firm}</span>
                  {(a.fromGrade || a.toGrade) && (
                    <span className="text-xs text-[#8b93a7]">
                      {a.fromGrade ? `${a.fromGrade} → ` : ""}
                      {a.toGrade}
                    </span>
                  )}
                  {a.targetTo != null && (
                    <span className="text-xs text-[#8b93a7]">
                      PT {a.targetFrom != null ? `$${a.targetFrom.toFixed(0)} → ` : ""}
                      <span className="text-[#aab2c5]">${a.targetTo.toFixed(0)}</span>
                    </span>
                  )}
                  <span className="ml-auto text-[11px] tabular-nums text-[#5b6478]">{a.date}</span>
                </div>
              );
            })}
            <div ref={sentinel} />
            <div className="px-4 py-2 text-center text-[11px] text-[#5b6478]">
              {visible < actions.length ? `Scroll for more — showing ${visible} of ${actions.length}` : `All ${actions.length} recent actions shown`}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
