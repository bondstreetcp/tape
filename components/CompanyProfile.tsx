"use client";
import type { CompanyProfile, Holder } from "@/lib/companyProfile";
import InsiderActivity from "./InsiderActivity";

function big(v: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  const s = v < 0 ? "−" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
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
    <div className={"rounded-xl border border-[#2a2e39] bg-[#131722] p-4" + (wide ? " lg:col-span-2" : "")}>
      <h3 className="mb-3 text-sm font-semibold text-[#aab2c5]">{title}</h3>
      {children}
    </div>
  );
}
function Empty() {
  return <div className="py-2 text-xs text-[#8b93a7]">Not available.</div>;
}

function HolderTable({ holders }: { holders: Holder[] }) {
  if (holders.length === 0) return <Empty />;
  return (
    <div className="max-h-[320px] overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-[#131722]">
          <tr className="text-[#8b93a7]">
            <th className="py-1 text-left font-medium">Holder</th>
            <th className="py-1 text-right font-medium">% Held</th>
            <th className="py-1 text-right font-medium">Value</th>
            <th className="py-1 text-right font-medium">Δ</th>
          </tr>
        </thead>
        <tbody>
          {holders.map((h, i) => (
            <tr key={i} className="border-t border-[#1f2430]">
              <td className="py-1 pr-2 text-left text-[#aab2c5]">{h.name}</td>
              <td className="py-1 text-right tabular-nums">{pct(h.pct)}</td>
              <td className="py-1 text-right tabular-nums">{big(h.value)}</td>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-[#8b93a7]">{label}</div>
      <div className="text-base font-semibold tabular-nums text-[#e6e9f0]">{value}</div>
    </div>
  );
}

export function OwnershipPanel({ profile, symbol }: { profile: CompanyProfile | null; symbol: string }) {
  return (
    <div className="space-y-4">
      {profile?.breakdown && (
        <div className="flex flex-wrap gap-x-8 gap-y-3 rounded-xl border border-[#2a2e39] bg-[#131722] px-4 py-3">
          <Stat label="Held by institutions" value={pct(profile.breakdown.institutionsPct)} />
          <Stat label="Institutional (of float)" value={pct(profile.breakdown.institutionsFloatPct)} />
          <Stat label="Held by insiders" value={pct(profile.breakdown.insidersPct)} />
          <Stat
            label="# institutional holders"
            value={profile.breakdown.institutionsCount != null ? profile.breakdown.institutionsCount.toLocaleString() : "—"}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Institutional Holders${profile?.institutions.length ? ` (top ${profile.institutions.length})` : ""}`}>
          <HolderTable holders={profile?.institutions ?? []} />
        </Card>
        <Card title={`Mutual Fund Holders${profile?.funds.length ? ` (top ${profile.funds.length})` : ""}`}>
          <HolderTable holders={profile?.funds ?? []} />
        </Card>
      </div>
      <p className="-mt-2 text-[11px] text-[#5b6478]">
        Top holders via Yahoo (13F-derived); the full institutional list isn&apos;t available from free sources.
      </p>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[#aab2c5]">Insider Transactions — SEC Form 4</h3>
        <InsiderActivity symbol={symbol} />
      </div>
    </div>
  );
}

export function ProfilePanel({ profile }: { profile: CompanyProfile | null }) {
  if (!profile) return <Empty />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card title="Business Summary" wide>
        <p className="text-sm leading-relaxed text-[#aab2c5]">
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
                <a href={profile.website} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">
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
            <div className="mb-1 text-xs text-[#8b93a7]">Recent dividends / share</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {profile.dividends.slice().reverse().map((d, i) => (
                <span key={i} className="tabular-nums text-[#aab2c5]">
                  {d.date}: <span className="font-medium text-[#e6e9f0]">${d.amount?.toFixed(2)}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <Card title="Key Executives" wide>
        {profile.officers.length === 0 ? (
          <Empty />
        ) : (
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {profile.officers.map((o, i) => (
              <div key={i} className="flex items-baseline justify-between border-b border-[#1f2430] py-1">
                <span className="text-sm">
                  <span className="text-[#e6e9f0]">{o.name}</span>{" "}
                  <span className="text-xs text-[#8b93a7]">· {o.title}</span>
                </span>
                <span className="shrink-0 pl-2 text-sm tabular-nums text-[#aab2c5]">
                  {o.pay ? big(o.pay) : ""}
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
    <div className="flex items-baseline justify-between gap-2 border-b border-[#1f2430] py-1.5">
      <dt className="text-xs text-[#8b93a7]">{label}</dt>
      <dd className="text-right text-sm text-[#e6e9f0]">{value || "—"}</dd>
    </div>
  );
}
