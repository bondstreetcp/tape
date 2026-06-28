"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import type { StockRow } from "@/lib/types";
import { applyScreen, fieldDef, type ScreenSpec, type ScreenField } from "@/lib/nlScreen";
import { useSavedScreens, type SavedScreen } from "@/lib/savedScreens";
import { currencyPrefix } from "@/lib/format";

const EXAMPLES = [
  "Profitable companies under 15× P/E growing revenue over 20%",
  "High-margin software with low debt",
  "Beaten-down quality — down >25% from highs, ROE over 15%",
  "Cheap dividend payers yielding more than 3%",
  "Mega-cap value: P/E under 18 and net cash",
];

const OP_LABEL: Record<string, string> = { lt: "<", lte: "≤", gt: ">", gte: "≥" };

function fmtField(f: ScreenField, v: number | null, currency: string): string {
  if (v == null) return "—";
  switch (f.unit) {
    case "pct": return `${v.toFixed(1)}%`;
    case "ratio": return v.toFixed(1);
    case "moneyB": return v >= 1000 ? `${currencyPrefix(currency)}${(v / 1000).toFixed(2)}T` : `${currencyPrefix(currency)}${v.toFixed(0)}B`;
    case "price": return `${currencyPrefix(currency)}${v.toFixed(2)}`;
    default: return v.toFixed(1);
  }
}

export default function NlScreener({ universe, stocks, currency = "USD" }: { universe: string; stocks: StockRow[]; currency?: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [spec, setSpec] = useState<ScreenSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ranQuery, setRanQuery] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const { list: saved, save, remove } = useSavedScreens();

  // Results derive from the spec + the CURRENT universe's stocks, so the active screen
  // re-applies automatically when you switch universe (the `stocks` prop changes).
  const results = useMemo(() => (spec ? applyScreen(stocks, spec) : null), [spec, stocks]);

  // Persist the active screen so it carries across navigation + universe switches even
  // when the component remounts (restore once on mount; save on every change after).
  const skipPersist = useRef(true);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("tape.activeScreen");
      if (raw) { const v = JSON.parse(raw); if (v?.spec) { setQ(v.query || ""); setRanQuery(v.query || ""); setSpec(v.spec); } }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (skipPersist.current) { skipPersist.current = false; return; }
    try {
      if (spec) localStorage.setItem("tape.activeScreen", JSON.stringify({ query: ranQuery, spec }));
      else localStorage.removeItem("tape.activeScreen");
    } catch { /* ignore */ }
  }, [spec, ranQuery]);

  // Re-run a saved screen instantly — the spec is stored, so no AI call needed.
  const runSaved = (s: SavedScreen) => {
    setQ(s.query); setRanQuery(s.query); setError(null);
    setSpec(s.spec);
  };

  const run = async (query: string) => {
    const text = query.trim();
    if (!text || loading) return;
    setLoading(true); setError(null); setRanQuery(text);
    try {
      const d = await fetch("/api/nl-screen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
      }).then((r) => r.json());
      if (d.configured === false) { setError("AI screening needs GEMINI_API_KEY configured."); setSpec(null); }
      else if (d.error || !d.spec) { setError(d.error || "Couldn't parse that — try rephrasing."); setSpec(null); }
      else { setSpec(d.spec); }
    } catch {
      setError("Something went wrong reaching the AI.");
    }
    setLoading(false);
  };

  const cols: ScreenField[] = spec
    ? ([...new Set([...(spec.filters || []).map((f) => f.field), spec.sortBy].filter(Boolean))] as string[])
        .map((k) => fieldDef(k))
        .filter((f): f is ScreenField => !!f)
    : [];

  return (
    <section className="mb-5 rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/[0.06] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text)]">✨ Screen in plain English</span>
        <span className="text-[11px] text-[var(--text-4)]">— describe what you want; AI builds the filters</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(q); }}
          placeholder="e.g. profitable companies under 15× P/E growing over 20%…"
          className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--text-4)] focus:border-[#a855f7]/60"
        />
        <button
          onClick={() => run(q)}
          disabled={loading || !q.trim()}
          className="rounded-lg bg-[#a855f7] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#9333ea] disabled:opacity-50"
        >
          {loading ? "Screening…" : "Screen"}
        </button>
      </div>

      {!spec && !error && (
        <div className="mt-2 space-y-2">
          {saved.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-4)]">Saved:</span>
              {saved.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-[#a855f7]/40 bg-[#a855f7]/10 px-2.5 py-1 text-[11px] text-[#c4b5fd]">
                  <button onClick={() => runSaved(s)} title={s.query} className="max-w-[170px] truncate hover:text-[var(--text)]">{s.name}</button>
                  <button onClick={() => remove(s.id)} className="text-[var(--text-4)] hover:text-[#ef4444]" title="Remove saved screen">×</button>
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => { setQ(ex); run(ex); }}
                className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 text-[11px] text-[var(--text-3)] transition-colors hover:border-[#a855f7]/50 hover:text-[var(--text)]"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-[#ef4444]">{error}</p>}

      {spec && (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[var(--text-3)]">{spec.interpretation}</span>
            {ranQuery && (
              <button
                onClick={() => { save(ranQuery, ranQuery, spec); setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1600); }}
                className="ml-auto shrink-0 rounded border border-[#a855f7]/40 px-2 py-0.5 text-[11px] text-[#c4b5fd] transition-colors hover:bg-[#a855f7]/15"
              >
                {savedFlash ? "✓ Saved" : "💾 Save screen"}
              </button>
            )}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(spec.filters || []).map((f, i) => {
              const def = fieldDef(f.field);
              if (!def) return null;
              return (
                <span key={i} className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-2)]">
                  {def.label} {OP_LABEL[f.op]} {fmtField(def, f.value, currency)}
                </span>
              );
            })}
            {(spec.sectors || []).map((s) => (
              <span key={s} className="rounded-md border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-2 py-0.5 text-[11px] text-[#93c5fd]">{s}</span>
            ))}
          </div>

          {results && results.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="w-full text-sm">
                <thead className="bg-[var(--surface)] text-[var(--text-3)]">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Symbol</th>
                    <th className="px-3 py-1.5 text-left font-medium">Name</th>
                    <th className="hidden px-3 py-1.5 text-left font-medium sm:table-cell">Sector</th>
                    <th className="px-3 py-1.5 text-right font-medium">Mkt Cap</th>
                    {cols.map((c) => <th key={c.key} className="px-3 py-1.5 text-right font-medium">{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {results.map((s) => (
                    <tr
                      key={s.symbol}
                      onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(s.symbol)}`)}
                      className="cursor-pointer border-t border-[var(--divider)] hover:bg-[var(--surface-hover)]"
                    >
                      <td className="px-3 py-1.5 font-mono font-semibold">{s.symbol}</td>
                      <td className="max-w-[200px] truncate px-3 py-1.5 text-[var(--text-2)]">{s.name}</td>
                      <td className="hidden px-3 py-1.5 text-xs text-[var(--text-3)] sm:table-cell">{s.sector}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{currencyPrefix(currency)}{s.marketCap >= 1e12 ? `${(s.marketCap / 1e12).toFixed(2)}T` : `${(s.marketCap / 1e9).toFixed(0)}B`}</td>
                      {cols.map((c) => <td key={c.key} className="px-3 py-1.5 text-right tabular-nums">{fmtField(c, c.get(s), currency)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[var(--text-3)]">No names in {universe.toUpperCase()} match — try loosening the criteria or a broader universe.</p>
          )}
          {results && results.length > 0 && (
            <p className="mt-1.5 text-[11px] text-[var(--text-4)]">
              {results.length} match{results.length === 1 ? "" : "es"} for &ldquo;{ranQuery}&rdquo; · click a row to open · <button onClick={() => { setSpec(null); setQ(""); setRanQuery(""); }} className="underline hover:text-[var(--text-2)]">clear</button>
            </p>
          )}
        </div>
      )}
    </section>
  );
}
