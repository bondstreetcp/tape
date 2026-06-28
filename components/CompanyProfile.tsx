"use client";
import type { CompanyProfile, Holder } from "@/lib/companyProfile";
import { currencyPrefix } from "@/lib/format";
import InsiderActivity from "./InsiderActivity";

function big(v: number | null, currency?: string): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  const c = currencyPrefix(currency);
  if (a >= 1e12) return `${s}${c}${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}${c}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${c}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}${c}${(a / 1e3).toFixed(0)}K`;
  return `${s}${c}${a.toFixed(0)}`;
}
function shares(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return `${v}`;
}
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`);

function Card({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={"rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" + (wide ? " lg:col-span-2" : "")}>
      <h3 className="mb-3 text-sm font-semibold text-[var(--text-2)]">{title}</h3>
      {children}
    </div>
  );
}
function Empty() {
  return <div className="py-2 text-xs text-[var(--text-3)]">Not available.</div>;
}

function HolderTable({ holders, currency }: { holders: Holder[]; currency?: string }) {
  if (holders.length === 0) return <Empty />;
  return (
    <div className="max-h-[320px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[var(--surface)]">
          <tr className="text-[var(--text-3)]">
            <th className="py-1 text-left font-medium">Holder</th>
            <th className="py-1 text-right font-medium">% Held</th>
            <th className="py-1 text-right font-medium">Value</th>
            <th className="py-1 text-right font-medium">Δ</th>
          </tr>
        </thead>
        <tbody>
          {holders.map((h, i) => (
            <tr key={i} className="border-t border-[var(--divider)]">
              <td className="py-1 pr-2 text-left text-[var(--text-2)]">{h.name}</td>
              <td className="py-1 text-right tabular-nums">{pct(h.pct)}</td>
              <td className="py-1 text-right tabular-nums">{big(h.value, currency)}</td>
              <td
                className="py-1 text-right tabular-nums"
                style={{ color: h.change == null ? undefined : h.change >= 0 ? "#22c55e" : "#ef4444" }}
              >
                {h.change == null ? "—" : `${h.change >= 0 ? "+" : ""}${(h.change * 100).toFixed(1)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OwnershipActivity({ profile }: { profile: CompanyProfile }) {
  const all = [...profile.institutions, ...profile.funds].filter((h) => h.change != null && h.name);
  if (all.length < 3) return null;
  const adders = all.filter((h) => (h.change ?? 0) > 0.001);
  const trimmers = all.filter((h) => (h.change ?? 0) < -0.001);
  const topAdds = [...adders].sort((a, b) => (b.change ?? 0) - (a.change ?? 0)).slice(0, 4);
  const topTrims = [...trimmers].sort((a, b) => (a.change ?? 0) - (b.change ?? 0)).slice(0, 4);
  const tone =
    adders.length > trimmers.length * 1.3
      ? { t: "net accumulating", c: "#22c55e" }
      : trimmers.length > adders.length * 1.3
        ? { t: "net trimming", c: "#ef4444" }
        : { t: "mixed", c: "var(--text-3)" };
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Position changes — latest 13F quarter</h3>
        <span className="text-xs font-medium" style={{ color: tone.c }}>{tone.t}</span>
      </div>
      <div className="mb-3 text-xs">
        <span className="font-semibold text-[#22c55e]">{adders.length} added</span>
        <span className="text-[var(--text-4)]"> · </span>
        <span className="font-semibold text-[#ef4444]">{trimmers.length} trimmed</span>
        <span className="text-[var(--text-4)]"> of {all.length} top holders with disclosed changes</span>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ChangeList title="Biggest adds" holders={topAdds} />
        <ChangeList title="Biggest trims" holders={topTrims} />
      </div>
    </div>
  );
}

function ChangeList({ title, holders }: { title: string; holders: Holder[] }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium text-[var(--text-3)]">{title}</div>
      {holders.length === 0 ? (
        <div className="text-xs text-[var(--text-4)]">None.</div>
      ) : (
        <div className="space-y-0.5">
          {holders.map((h, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-[var(--text-2)]">{h.name}</span>
              <span className="shrink-0 font-medium tabular-nums" style={{ color: (h.change ?? 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                {(h.change ?? 0) >= 0 ? "+" : ""}
                {((h.change ?? 0) * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--text-3)]">{label}</div>
      <div className="text-base font-semibold tabular-nums text-[var(--text)]">{value}</div>
    </div>
  );
}

export function OwnershipPanel({ profile, symbol, currency }: { profile: CompanyProfile | null; symbol: string; currency?: string }) {
  return (
    <div className="space-y-4">
      {profile?.breakdown && (
        <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <Stat label="Held by institutions" value={pct(profile.breakdown.institutionsPct)} />
          <Stat label="Institutional (of float)" value={pct(profile.breakdown.institutionsFloatPct)} />
          <Stat label="Held by insiders" value={pct(profile.breakdown.insidersPct)} />
          <Stat
            label="# institutional holders"
            value={profile.breakdown.institutionsCount != null ? profile.breakdown.institutionsCount.toLocaleString() : "—"}
          />
        </div>
      )}

      {profile && <OwnershipActivity profile={profile} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Institutional Holders${profile?.institutions.length ? ` (top ${profile.institutions.length})` : ""}`}>
          <HolderTable holders={profile?.institutions ?? []} currency={currency} />
        </Card>
        <Card title={`Mutual Fund Holders${profile?.funds.length ? ` (top ${profile.funds.length})` : ""}`}>
          <HolderTable holders={profile?.funds ?? []} currency={currency} />
        </Card>
      </div>
      <p className="-mt-2 text-[11px] text-[var(--text-4)]">
        Top holders via Yahoo (13F-derived); the full institutional list isn&apos;t available from free sources.
      </p>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-2)]">Insider Transactions — SEC Form 4</h3>
        <InsiderActivity symbol={symbol} />
      </div>
    </div>
  );
}

export function ProfilePanel({ profile, currency }: { profile: CompanyProfile | null; currency?: string }) {
  if (!profile) return <Empty />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Business Summary" wide>
        <p className="text-sm leading-relaxed text-[var(--text-2)]">
          {profile.description || "No description available."}
        </p>
      </Card>

      <Card title="Company">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5">
          <Fact label="Sector" value={profile.sector} />
          <Fact label="Industry" value={profile.industry} />
          <Fact label="Employees" value={profile.employees ? profile.employees.toLocaleString() : null} />
          <Fact label="Headquarters" value={profile.location} />
          <Fact
            label="Website"
            value={
              profile.website ? (
                <a href={profile.website} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">
                  {profile.website.replace(/^https?:\/\//, "")}
                </a>
              ) : null
            }
          />
        </dl>
      </Card>

      <Card title="Upcoming Events & Dividends">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-0.5">
          <Fact label="Next Earnings" value={profile.nextEarnings} />
          <Fact label="Ex-Dividend" value={profile.exDividend} />
          <Fact label="Dividend Pay Date" value={profile.dividendDate} />
        </dl>
        {profile.dividends.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-[var(--text-3)]">Recent dividends / share</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {profile.dividends.slice().reverse().map((d, i) => (
                <span key={i} className="tabular-nums text-[var(--text-2)]">
                  {d.date}: <span className="font-medium text-[var(--text)]">${d.amount?.toFixed(2)}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="Key Executives" wide>
        <p className="mb-2 text-[11px] text-[var(--text-4)]">
          Dollar figures are each executive&apos;s most recently disclosed <span className="text-[var(--text-3)]">total annual compensation</span> (salary
          + bonus + stock/option awards), where reported.
        </p>
        {profile.officers.length === 0 ? (
          <Empty />
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {profile.officers.map((o, i) => (
              <div key={i} className="flex items-baseline justify-between border-b border-[var(--divider)] py-1">
                <span className="text-sm">
                  <span className="text-[var(--text)]">{o.name}</span>{" "}
                  <span className="text-xs text-[var(--text-3)]">· {o.title}</span>
                </span>
                <span className="shrink-0 pl-2 text-sm tabular-nums text-[var(--text-2)]">
                  {o.pay ? big(o.pay, currency) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-[var(--divider)] py-1.5">
      <dt className="text-xs text-[var(--text-3)]">{label}</dt>
      <dd className="text-right text-sm text-[var(--text)]">{value || "—"}</dd>
    </div>
  );
}
