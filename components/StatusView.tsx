"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FreshReport, FreshResult } from "@/lib/dataFreshness";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { ALL_NAV } from "@/lib/nav";
import UniverseSwitcher from "./UniverseSwitcher";

/**
 * System Status — the one page that answers "what's working right now?".
 *
 * Everything needed already existed (lib/dataFreshness watches 70+ feeds, /api/health/data serves it)
 * but only as JSON: for two days this week the site served 47h-old data while every dashboard looked
 * fine, and the only way to see it was to curl an endpoint. This renders the same registry for humans,
 * and answers the question a JSON blob can't: WHICH BOARDS are degraded right now.
 *
 * Three things it deliberately shows that a plain feed table would not:
 *  - IMPACT: failing feed → the features that read it, as links (the `affects` map in the registry).
 *  - THE SERVER'S CLOCK vs YOURS. A 3h-fast host clock broke this site's storage auth for two days
 *    while every status signal stayed green; the skew is now one glance.
 *  - Which BUILD is live, so "did my fix deploy?" is answerable without a shell.
 */

const GREEN = "#22c55e", AMBER = "#f59e0b", RED = "#ef4444";

const STATUS_STYLE: Record<string, { color: string; label: string }> = {
  ok: { color: GREEN, label: "OK" },
  stale: { color: AMBER, label: "STALE" },
  empty: { color: RED, label: "EMPTY" },
  missing: { color: RED, label: "MISSING" },
  unreadable: { color: RED, label: "UNREADABLE" },
};

const TIER_LABEL: Record<string, string> = {
  core: "Core — rebuilt every nightly run",
  snapshot: "Universe snapshots — prices & fundamentals",
  event: "Event feeds — filings, catalysts, calendars",
  synthesis: "AI syntheses — desk notes & boards",
};
const TIER_ORDER = ["core", "snapshot", "event", "synthesis"];

const fmtAge = (h: number | null) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)}m` : h < 48 ? `${h.toFixed(1)}h` : `${(h / 24).toFixed(1)}d`);

export default function StatusView({
  universe, report: initial, build,
}: {
  universe: string;
  report: FreshReport;
  build: { version: string; sha: string; builtAt: string };
}) {
  const [report, setReport] = useState<FreshReport>(initial);
  const [busy, setBusy] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  // Server-vs-browser clock. Computed after mount only: Date.now() differs between the server render
  // and the client, so doing this inline would be a hydration mismatch.
  const [skewMin, setSkewMin] = useState<number | null>(null);
  useEffect(() => {
    setSkewMin(Math.round((Date.parse(report.checkedAt) - Date.now()) / 60000));
  }, [report.checkedAt]);

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/health/data", { cache: "no-store" });
      const j = (await res.json()) as FreshReport;
      if (Array.isArray(j?.results)) setReport(j);
    } catch { /* keep showing the last good report — a failed refresh isn't a status change */ }
    setBusy(false);
  };

  const failing = useMemo(() => report.results.filter((r) => r.status !== "ok"), [report.results]);

  // Failing feeds → the boards that read them. Labels come from the nav registry so a renamed feature
  // can never drift out of sync with what this page tells you is broken.
  const navByPath = useMemo(() => new Map(ALL_NAV.map((n) => [n.path, n])), []);
  const affected = useMemo(() => {
    const out = new Map<string, { label: string; because: string[] }>();
    for (const r of failing) {
      for (const p of (r as FreshResult & { affects?: string[] }).affects ?? []) {
        const nav = navByPath.get(p);
        if (!nav) continue; // unknown path — never invent a feature name
        const cur = out.get(p) ?? { label: nav.label, because: [] };
        cur.because.push(r.label);
        out.set(p, cur);
      }
    }
    return [...out.entries()].map(([path, v]) => ({ path, ...v })).sort((a, b) => b.because.length - a.because.length);
  }, [failing, navByPath]);

  const groups = useMemo(() => {
    const rows = onlyProblems ? failing : report.results;
    const by = new Map<string, FreshResult[]>();
    for (const r of rows) (by.get(r.tier) ?? by.set(r.tier, []).get(r.tier)!).push(r);
    // problems first inside each tier, then oldest first — the eye should land on what's wrong
    for (const list of by.values()) {
      list.sort((a, b) => (a.status === "ok" ? 1 : 0) - (b.status === "ok" ? 1 : 0) || (b.ageHours ?? 0) - (a.ageHours ?? 0));
    }
    return TIER_ORDER.filter((t) => by.has(t)).map((t) => ({ tier: t, rows: by.get(t)! }));
  }, [report.results, failing, onlyProblems]);

  const oldest = useMemo(() => {
    const ages = report.results.map((r) => r.ageHours).filter((a): a is number => a != null);
    return ages.length ? Math.max(...ages) : null;
  }, [report.results]);

  const ok = report.ok;
  const Tile = ({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) => (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="truncate text-[11px] text-[var(--text-4)]" title={sub}>{sub}</div>}
    </div>
  );

  return (
    <main className="mx-auto max-w-[92rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">System Status</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Every data feed the site renders, with how old it is and what breaks when it goes down. This is the same registry the nightly pipeline gate and the external uptime monitor check — one definition of &quot;healthy&quot;, not a second opinion.
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* verdict */}
      <div
        className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border px-5 py-3"
        style={{ borderColor: ok ? `color-mix(in oklab, ${GREEN} 40%, transparent)` : `color-mix(in oklab, ${RED} 40%, transparent)`, background: ok ? `color-mix(in oklab, ${GREEN} 8%, transparent)` : `color-mix(in oklab, ${RED} 8%, transparent)` }}
      >
        <span className="text-xl" aria-hidden>{ok ? "✅" : "⚠️"}</span>
        <span className="text-[15px] font-semibold" style={{ color: ok ? GREEN : RED }}>
          {ok ? "All systems normal" : `${report.failing} of ${report.results.length} feeds degraded`}
        </span>
        <span className="text-[13px] text-[var(--text-3)]">
          checked {new Date(report.checkedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET
        </span>
        <button onClick={refresh} disabled={busy} className="ml-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-2)] hover:text-[var(--text)] disabled:opacity-50">
          {busy ? "Checking…" : "Re-check now"}
        </button>
      </div>

      {/* tiles */}
      <div className="mb-4 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Feeds healthy" value={`${report.results.length - report.failing}/${report.results.length}`} color={ok ? GREEN : AMBER} sub={report.failing ? `${report.failing} need attention` : "nothing stale"} />
        <Tile label="Oldest feed" value={fmtAge(oldest)} sub="time since that feed was last rebuilt" />
        <Tile
          label="Server clock"
          value={skewMin == null ? "…" : Math.abs(skewMin) <= 2 ? "in sync" : `${skewMin > 0 ? "+" : ""}${skewMin}m`}
          color={skewMin == null ? undefined : Math.abs(skewMin) <= 2 ? GREEN : Math.abs(skewMin) <= 15 ? AMBER : RED}
          sub={skewMin != null && Math.abs(skewMin) > 15 ? "drift breaks signed API calls (R2, S3)" : "vs your browser"}
        />
        <Tile label="Live build" value={build.sha} sub={build.builtAt ? `v${build.version} · built ${build.builtAt.slice(0, 16).replace("T", " ")} UTC` : `v${build.version}`} />
        <Tile label="Upstream (SEC)" value={report.secProbe ? (report.secProbe.reachable ? "reachable" : "down") : "not probed"} color={report.secProbe ? (report.secProbe.reachable ? GREEN : RED) : undefined} sub={report.secProbe?.detail ?? "only probed when an SEC feed fails"} />
      </div>

      {/* what's actually affected — the reason this page exists */}
      {affected.length > 0 && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-4">
          <div className="mb-2 text-[13px] font-semibold text-[var(--text)]">Boards affected right now</div>
          <div className="flex flex-wrap gap-2">
            {affected.map((a) => (
              <Link
                key={a.path}
                href={`/u/${universe}${a.path}`}
                className="rounded-lg border px-2.5 py-1.5 text-[12.5px] hover:brightness-125"
                style={{ borderColor: `color-mix(in oklab, ${AMBER} 35%, transparent)`, background: `color-mix(in oklab, ${AMBER} 10%, transparent)` }}
                title={`degraded because: ${a.because.join(", ")}`}
              >
                <span className="font-medium text-[var(--text)]">{a.label}</span>
                <span className="text-[var(--text-4)]"> — {a.because.join(", ")}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      {!ok && affected.length === 0 && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-5 py-3 text-[13px] text-[var(--text-3)]">
          The degraded feeds below aren&apos;t mapped to a specific board — they feed shared inputs or nightly jobs rather than one page.
        </div>
      )}

      {report.secDiagnosis && (
        <div className="mb-4 rounded-xl border px-5 py-3 text-[13px]" style={{ borderColor: `color-mix(in oklab, ${AMBER} 35%, transparent)`, background: `color-mix(in oklab, ${AMBER} 8%, transparent)` }}>
          <b className="text-[var(--text-2)]">SEC diagnosis:</b> <span className="text-[var(--text-3)]">{report.secDiagnosis}</span>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setOnlyProblems(false)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (!onlyProblems ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>All feeds</button>
          <button onClick={() => setOnlyProblems(true)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (onlyProblems ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>Problems only{failing.length ? ` (${failing.length})` : ""}</button>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">
          <div className="text-[var(--text-2)]">No problems.</div>
          <div className="mt-1 text-[13px]">Every registered feed is within its freshness window.</div>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.tier} className="mb-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="border-b border-[var(--border)] px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{TIER_LABEL[g.tier] ?? g.tier}</div>
            <table className="w-full min-w-[760px] text-left text-[13px]">
              <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Feed</th>
                  <th className="px-3 py-2 text-center font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium" title="time since this feed was last rebuilt">Age</th>
                  <th className="px-3 py-2 text-right font-medium" title="max age before this feed counts as stale">Limit</th>
                  <th className="px-3 py-2 text-right font-medium">Rows</th>
                  <th className="px-3 py-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => {
                  const st = STATUS_STYLE[r.status] ?? { color: "var(--text-3)", label: r.status.toUpperCase() };
                  return (
                    <tr key={r.file} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                      <td className="px-3 py-2">
                        <span className="text-[var(--text)]">{r.label}</span>
                        <div className="font-mono text-[11px] text-[var(--text-4)]">{r.file}</div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: st.color, background: `color-mix(in oklab, ${st.color} 15%, transparent)` }}>{st.label}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums" style={{ color: r.status === "ok" ? "var(--text-2)" : st.color }}>{fmtAge(r.ageHours)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{fmtAge(r.maxAgeHours)}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{r.count ?? "—"}</td>
                      <td className="px-3 py-2 text-[12.5px] text-[var(--text-4)]">{r.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </main>
  );
}
