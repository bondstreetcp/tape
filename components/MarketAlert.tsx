"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface Pulse { level: "alert" | "warn" | null; head?: string; text?: string; asOf?: string }

/** Data-driven market banner: shows quantified stress (sharp index moves or a vol
 *  spike) and stays hidden when markets are calm — so when it appears it actually
 *  means something. */
export default function MarketAlert() {
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const pathname = usePathname();
  const marketHref = (() => {
    const m = pathname?.match(/^\/u\/([^/]+)/);
    return m ? `/u/${m[1]}/market` : "/u/sp500/market";
  })();

  useEffect(() => {
    let on = true;
    fetch("/api/market-pulse")
      .then((r) => r.json())
      .then((d: Pulse) => { if (on) setPulse(d); })
      .catch(() => {});
    return () => { on = false; };
  }, []);

  if (dismissed || !pulse || !pulse.level) return null;
  const alert = pulse.level === "alert";
  const c = alert ? "#ef4444" : "#f59e0b";
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: `${c}66`, backgroundColor: `${c}1a` }}>
      <span className="flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white" style={{ backgroundColor: c }}>
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" /> {alert ? "Alert" : "Watch"}
      </span>
      <div className="min-w-0 flex-1 truncate text-sm text-[var(--text)]">
        {pulse.head && <span className="font-semibold">{pulse.head}</span>}
        {pulse.head && pulse.text && <span className="text-[var(--text-3)]">{" — "}</span>}
        <span className="font-mono tabular-nums">{pulse.text}</span>
      </div>
      <a href={marketHref} className="shrink-0 text-[11px] font-medium hover:underline" style={{ color: c }}>Markets →</a>
      <button onClick={() => setDismissed(true)} className="shrink-0 px-1 text-[var(--text-3)] hover:text-[var(--text)]" title="Dismiss" aria-label="Dismiss alert">✕</button>
    </div>
  );
}
