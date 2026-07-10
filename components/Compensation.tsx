"use client";
import { useState, useRef } from "react";
import { type CompensationResponse, type CompMetric, compHasDetail } from "@/lib/execComp";
import InfoDot from "./InfoDot";

// "Compensation" card on the stock profile — WHO gets paid what (Summary Compensation Table, up to
// 3 fiscal years of history) and, more importantly, HOW pay is earned (the bonus + LTI metrics from
// the CD&A), plus perquisites and director pay. Lazy: nothing is fetched until the user asks —
// extraction reads the company's own proxy / S-1 / Form 10 on demand via /api/compensation.

const usd = (n: number | null): string => {
  if (n == null) return "—";
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

function MetricRows({ items }: { items: CompMetric[] }) {
  return (
    <ul className="space-y-1">
      {items.map((m, i) => (
        <li key={i} className="text-[12px] leading-snug">
          <span className="text-[var(--text)]">{m.metric}</span>
          {m.weightPct != null && (
            <span className="ml-1.5 rounded border border-[var(--border)] px-1 py-px text-[10px] tabular-nums text-[var(--text-2)]">{m.weightPct}%</span>
          )}
          {m.detail && <span className="ml-1.5 text-[11px] text-[var(--text-4)]">{m.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

function Sub({ title, term, children }: { title: string; term?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-3)]">
        {title}
        {term && <InfoDot term={term} />}
      </div>
      {children}
    </div>
  );
}

export default function Compensation({ symbol }: { symbol: string }) {
  const [data, setData] = useState<CompensationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false); // synchronous guard — two fast clicks both read stale `loading` state

  const load = async () => {
    if (data || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const r = await fetch(`/api/compensation/${encodeURIComponent(symbol)}`).then((x) => x.json());
      setData(r && typeof r === "object" ? r : null);
    } catch {
      setData({ symbol, source: null, execs: [], bonusMetrics: [], ltiMetrics: [], payMix: null, perks: [], directors: null, sayOnPay: null, note: "Couldn't load compensation." });
    }
    setLoading(false);
  };

  if (!data) {
    return (
      <div className="py-1">
        <p className="mb-2 text-[12px] leading-relaxed text-[var(--text-3)]">
          What the named executives earn (3-year history), the performance metrics their bonus and equity actually pay on, perquisites, and board pay — read from the company&apos;s latest proxy statement.
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-60"
        >
          {loading ? "Reading the proxy statement…" : "Show pay & incentives"}
        </button>
      </div>
    );
  }

  if (!compHasDetail(data)) {
    return <div className="py-3 text-[12px] text-[var(--text-4)]">{data.note ?? "No compensation disclosure found in the latest proxy / S-1 / Form 10."}</div>;
  }

  const hasHow = data.bonusMetrics.length > 0 || data.ltiMetrics.length > 0 || data.payMix;
  return (
    <div className="space-y-4 text-[12px]">
      {/* 1 — HOW pay is earned (the part that matters) */}
      {hasHow && (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.bonusMetrics.length > 0 && (
            <Sub title="Annual bonus pays on" term="Bonus metrics">
              <MetricRows items={data.bonusMetrics} />
            </Sub>
          )}
          {data.ltiMetrics.length > 0 && (
            <Sub title="Long-term equity pays on" term="PSU">
              <MetricRows items={data.ltiMetrics} />
            </Sub>
          )}
          {data.payMix && <p className="text-[11px] leading-relaxed text-[var(--text-3)] sm:col-span-2">{data.payMix}</p>}
        </div>
      )}

      {/* 2 — WHO gets paid WHAT, historically */}
      {data.execs.length > 0 && (
        <Sub title="Pay history (Summary Compensation Table)" term="NEO">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[11px]">
              <thead>
                <tr className="border-b border-[var(--divider)] text-[10px] uppercase tracking-wide text-[var(--text-4)]">
                  <th className="py-1 pr-2 font-medium">Executive</th>
                  <th className="py-1 pr-2 font-medium">Year</th>
                  <th className="py-1 pr-2 text-right font-medium">Salary</th>
                  <th className="py-1 pr-2 text-right font-medium">Bonus</th>
                  <th className="py-1 pr-2 text-right font-medium">Stock</th>
                  <th className="py-1 pr-2 text-right font-medium">Options</th>
                  <th className="py-1 pr-2 text-right font-medium">
                    <span className="inline-flex items-center gap-0.5">Incentive<InfoDot term="Non-equity incentive" /></span>
                  </th>
                  <th className="py-1 pr-2 text-right font-medium">Other</th>
                  <th className="py-1 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.execs.map((e, ei) =>
                  e.years.map((y, yi) => (
                    <tr key={`${ei}-${yi}`} className={"border-b border-[var(--divider)]" + (yi === 0 && ei > 0 ? " border-t border-t-[var(--border)]" : "")}>
                      <td className="max-w-[180px] py-1 pr-2">
                        {yi === 0 && (
                          <>
                            <span className="text-[var(--text)]">{e.name}</span>
                            {e.title && <span className="block truncate text-[10px] text-[var(--text-4)]" title={e.title}>{e.title}</span>}
                          </>
                        )}
                      </td>
                      <td className="py-1 pr-2 tabular-nums text-[var(--text-3)]">{y.year}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-2)]">{usd(y.salary)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-2)]">{usd(y.bonus)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-2)]">{usd(y.stock)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-2)]">{usd(y.options)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-2)]">{usd(y.nonEquity)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-[var(--text-2)]">{usd(y.other)}</td>
                      <td className="py-1 text-right font-medium tabular-nums text-[var(--text)]">{usd(y.total)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </Sub>
      )}

      {/* 3 — perks + board pay */}
      <div className="grid gap-3 sm:grid-cols-2">
        {data.perks.length > 0 && (
          <Sub title="Perquisites" term="Perquisites">
            <ul className="list-disc space-y-0.5 pl-4 text-[var(--text-2)]">
              {data.perks.map((p, i) => (
                <li key={i}>
                  {p.item}
                  {p.who && <span className="text-[var(--text-4)]"> — {p.who}</span>}
                </li>
              ))}
            </ul>
          </Sub>
        )}
        {(data.directors || data.sayOnPay) && (
          <Sub title="Board of directors" term="Say-on-pay">
            <div className="space-y-0.5 text-[var(--text-2)]">
              {data.directors?.cashRetainer != null && <div>Cash retainer: <span className="tabular-nums text-[var(--text)]">{usd(data.directors.cashRetainer)}</span>/yr</div>}
              {data.directors?.equityAnnual != null && <div>Annual equity: <span className="tabular-nums text-[var(--text)]">{usd(data.directors.equityAnnual)}</span></div>}
              {data.directors?.note && <div className="text-[11px] text-[var(--text-4)]">{data.directors.note}</div>}
              {data.sayOnPay && <div className="text-[11px] text-[var(--text-3)]">Say-on-pay: {data.sayOnPay}</div>}
            </div>
          </Sub>
        )}
      </div>

      <p className="text-[10px] leading-relaxed text-[var(--text-4)]">
        Extracted from{" "}
        {data.source ? (
          <a href={data.source.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
            the {data.source.date} {data.source.form}
          </a>
        ) : (
          "the latest filing"
        )}
        . Every figure appears verbatim in the filing; anything the company doesn&apos;t disclose is left blank (nothing is estimated). Amounts are as reported — stock/option values are grant-date fair value, not realized pay.
      </p>
    </div>
  );
}
