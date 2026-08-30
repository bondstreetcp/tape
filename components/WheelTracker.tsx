"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { wheelAlert, shortLegOf, SEVERITY_META, type Leg, type WheelPos, type WheelAlert } from "@/lib/wheelManage";

// A lightweight wheel tracker — the cycle is sell puts → get assigned → sell calls → get called → repeat.
// This logs your active wheels (which leg you're in, shares, cost basis, premium collected to date) and
// shows the adjusted basis (basis − premium/share) + the next action. Book stays in the browser
// (localStorage); nothing leaves the device. Decision-support, not advice.

const DAY = 86_400_000;
const dteOf = (expiry?: string) => (expiry ? Math.round((Date.parse(expiry + "T00:00:00Z") - Date.now()) / DAY) : null);
const fmtDay = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" });

const KEY = "tape.wheels";
const LEGS: { id: Leg; label: string; color: string }[] = [
  { id: "put", label: "Short put (waiting)", color: "#60a5fa" },
  { id: "shares", label: "Holding shares", color: "#f59e0b" },
  { id: "call", label: "Short call", color: "#22c55e" },
  { id: "idle", label: "Idle / cash", color: "var(--text-4)" },
];
const legOf = (l: Leg) => LEGS.find((x) => x.id === l) ?? LEGS[3];
const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
const money = (v: number | null, d = 2) => (v == null || !Number.isFinite(v) ? "—" : `$${v.toFixed(d)}`);

export default function WheelTracker({ universe }: { universe: string }) {
  const [rows, setRows] = useState<WheelPos[]>([]);
  const [draft, setDraft] = useState<WheelPos | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { try { const r = JSON.parse(localStorage.getItem(KEY) || "[]"); if (Array.isArray(r)) setRows(r); } catch { /* ignore */ } setLoaded(true); }, []);
  const persist = (r: WheelPos[]) => { setRows(r); try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* ignore */ } };

  // Live prices for the "Manage now" queue — one batch /api/quote call for every tracked symbol.
  const [prices, setPrices] = useState<Record<string, number>>({});
  const symKey = useMemo(() => [...new Set(rows.map((r) => r.symbol).filter(Boolean))].sort().join(","), [rows]);
  useEffect(() => {
    if (!symKey) { setPrices({}); return; }
    let alive = true;
    fetch(`/api/quote?symbols=${encodeURIComponent(symKey)}`)
      .then((r) => r.json())
      .then((d) => { if (!alive) return; const m: Record<string, number> = {}; for (const q of d.quotes || []) if (q?.symbol && typeof q.price === "number") m[String(q.symbol).toUpperCase()] = q.price; setPrices(m); })
      .catch(() => { /* prices stay empty — the queue degrades to expiry-based flags */ });
    return () => { alive = false; };
  }, [symKey]);

  // The prioritized management queue: every open short leg that needs attention, worst first.
  const alerts = useMemo(() => {
    const now = Date.now();
    return rows
      .map((r) => ({ r, a: wheelAlert(r, prices[r.symbol] ?? null, now) }))
      .filter((x): x is { r: WheelPos; a: WheelAlert } => x.a != null && x.a.severity >= 1)
      .sort((x, y) => y.a.severity - x.a.severity || x.a.dte - y.a.dte);
  }, [rows, prices]);

  const blank = (): WheelPos => ({ id: uid(), symbol: "", leg: "shares", shares: 100, costBasis: null, premium: 0, note: "" });
  const save = () => {
    if (!draft || !draft.symbol.trim()) return;
    const d = { ...draft, symbol: draft.symbol.trim().toUpperCase() };
    persist(rows.some((r) => r.id === d.id) ? rows.map((r) => (r.id === d.id ? d : r)) : [...rows, d]);
    setDraft(null);
  };
  const remove = (id: string) => persist(rows.filter((r) => r.id !== id));

  const adjBasis = (r: WheelPos) => (r.costBasis != null && r.shares > 0 ? r.costBasis - r.premium / r.shares : null);
  const totalPrem = rows.reduce((s, r) => s + (r.premium || 0), 0);
  const capital = rows.reduce((s, r) => s + ((r.leg === "shares" || r.leg === "call") && r.costBasis ? r.costBasis * r.shares : 0), 0);
  const nextAction = (r: WheelPos): { label: string; href: string } =>
    r.leg === "shares" ? { label: "Sell a call →", href: `/u/${universe}/stock/${encodeURIComponent(r.symbol)}?tab=wheel` }
      : r.leg === "call" ? { label: "Roll / manage →", href: `/u/${universe}/stock/${encodeURIComponent(r.symbol)}?tab=wheel` }
        : { label: "Sell a put →", href: `/u/${universe}/put-writing` };

  const inp = "rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Home</Link>
          <h1 className="mt-1 text-2xl font-bold">Wheel Tracker</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">Track your active wheels — which leg you&apos;re in, shares held, cost basis and premium collected to date — with your adjusted basis and the next move. Everything stays in your browser. <Link href={`/u/${universe}/put-writing`} className="text-[var(--accent)] hover:underline">Put-Writing</Link> ranks names to start on; each stock&apos;s <b>Covered Calls</b> tab picks the strike.</p>
        </div>
        {!draft && <button onClick={() => setDraft(blank())} className="rounded-lg bg-[var(--accent-strong)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90">+ Add wheel</button>}
      </div>

      {rows.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[12px]">
          <span className="text-[var(--text-3)]">Active wheels <b className="text-[var(--text)]">{rows.length}</b></span>
          <span className="text-[var(--text-3)]">Premium collected <b className="text-[#22c55e]">{money(totalPrem, 0)}</b></span>
          <span className="text-[var(--text-3)]">Capital in shares <b className="text-[var(--text)]">{money(capital, 0)}</b></span>
          {alerts.length > 0 && <span className="font-semibold text-[#f59e0b]">⚠ {alerts.length} to manage</span>}
        </div>
      )}

      {/* Manage-now queue — every open short leg needing attention, worst first, from the live price. */}
      {alerts.length > 0 && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">
            Manage now <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text-3)]">{alerts.length}</span>
            {symKey && Object.keys(prices).length === 0 && <span className="font-normal normal-case text-[var(--text-4)]">· live prices unavailable — showing expiry-based flags only</span>}
          </div>
          <ul className="space-y-1.5">
            {alerts.map(({ r, a }) => {
              const m = SEVERITY_META[a.severity];
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[13px]">
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${m.color}22`, color: m.color }}>{m.label}</span>
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}?tab=wheel`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                  <span className="text-[var(--text-3)]">short {a.side} ${a.strike} · {fmtDay(a.expiry)}</span>
                  <span className="font-medium" style={{ color: m.color }}>{a.flag}</span>
                  <span className="text-[var(--text-4)]">{a.detail}</span>
                  <span className="ml-auto text-[12px] text-[var(--text-2)]">{a.action}</span>
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}?tab=wheel`} className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:border-[var(--border-strong)]">manage →</Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {draft && (
        <div className="mb-4 rounded-xl border border-[var(--accent)]/40 bg-[var(--surface)] p-3">
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Ticker<input className={inp + " uppercase"} value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value })} placeholder="AAPL" /></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Leg<select className={inp} value={draft.leg} onChange={(e) => setDraft({ ...draft, leg: e.target.value as Leg })}>{LEGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Shares<input type="number" step={100} className={inp + " tabular-nums"} value={draft.shares} onChange={(e) => setDraft({ ...draft, shares: Math.max(0, Number(e.target.value) || 0) })} /></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Cost basis<input type="number" step={0.01} className={inp + " tabular-nums"} value={draft.costBasis ?? ""} onChange={(e) => setDraft({ ...draft, costBasis: e.target.value ? Number(e.target.value) : null })} placeholder="/sh" /></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Premium collected $<input type="number" step={1} className={inp + " tabular-nums"} value={draft.premium} onChange={(e) => setDraft({ ...draft, premium: Math.max(0, Number(e.target.value) || 0) })} placeholder="total $" /></label>
            <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Note<input className={inp} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} placeholder="optional" /></label>
          </div>
          {draft.leg === "call" && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Open call strike<input type="number" step={0.5} className={inp + " tabular-nums"} value={draft.callStrike ?? ""} onChange={(e) => setDraft({ ...draft, callStrike: e.target.value ? Number(e.target.value) : null })} placeholder="strike you sold" /></label>
              <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Call expiry<input type="date" className={inp} value={draft.callExpiry ?? ""} onChange={(e) => setDraft({ ...draft, callExpiry: e.target.value })} /></label>
              <div className="flex items-end text-[11px] text-[var(--text-4)]">so the tracker can remind you to roll near expiry</div>
            </div>
          )}
          {draft.leg === "put" && (
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Short put strike<input type="number" step={0.5} className={inp + " tabular-nums"} value={draft.putStrike ?? ""} onChange={(e) => setDraft({ ...draft, putStrike: e.target.value ? Number(e.target.value) : null })} placeholder="strike you sold" /></label>
              <label className="flex flex-col gap-0.5 text-[11px] text-[var(--text-4)]">Put expiry<input type="date" className={inp} value={draft.putExpiry ?? ""} onChange={(e) => setDraft({ ...draft, putExpiry: e.target.value })} /></label>
              <div className="flex items-end text-[11px] text-[var(--text-4)]">so the queue can flag assignment / roll as it nears your strike</div>
            </div>
          )}
          <div className="mt-2 flex gap-2">
            <button onClick={save} className="rounded-lg bg-[var(--accent-strong)] px-3 py-1 text-sm font-medium text-white hover:opacity-90">Save</button>
            <button onClick={() => setDraft(null)} className="rounded-lg border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-3)] hover:text-[var(--text)]">Cancel</button>
          </div>
        </div>
      )}

      {loaded && rows.length === 0 && !draft ? (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">
          No wheels yet. <button onClick={() => setDraft(blank())} className="text-[var(--accent)] hover:underline">Add your first</button>, or start from <Link href={`/u/${universe}/put-writing`} className="text-[var(--accent)] hover:underline">Put-Writing</Link>.
        </div>
      ) : rows.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-3)]">
              <th className="px-3 py-2 font-medium">Ticker</th><th className="px-2 py-2 font-medium">Leg</th>
              <th className="px-2 py-2 text-right font-medium">Shares</th><th className="px-2 py-2 text-right font-medium">Cost basis</th>
              <th className="px-2 py-2 text-right font-medium">Premium</th><th className="px-2 py-2 text-right font-medium">Adj. basis</th>
              <th className="px-2 py-2 font-medium">Note</th><th className="px-2 py-2 text-right font-medium">Next</th><th className="w-8 px-2 py-2"></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const leg = legOf(r.leg); const ab = adjBasis(r); const act = nextAction(r);
                const cdte = r.leg === "call" ? dteOf(r.callExpiry) : null;
                const pdte = r.leg === "put" ? dteOf(r.putExpiry) : null;
                const rollSoon = cdte != null && cdte <= 7;
                return (
                  <tr key={r.id} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                    <td className="px-3 py-2"><Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}?tab=wheel`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link></td>
                    <td className="px-2 py-2">
                      <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${leg.color}22`, color: leg.color }}>{leg.label}</span>
                      {r.leg === "call" && r.callExpiry && (
                        <div className="mt-0.5 text-[10px] text-[var(--text-4)]">
                          {r.callStrike ? `$${r.callStrike} ` : ""}{fmtDay(r.callExpiry)}{cdte != null && (cdte < 0 ? <span className="ml-1 font-semibold text-[#ef4444]">expired</span> : rollSoon ? <span className="ml-1 font-semibold text-[#f59e0b]">⏰ {cdte}d — roll soon</span> : <span className="ml-1">{cdte}d</span>)}
                        </div>
                      )}
                      {r.leg === "put" && r.putExpiry && (
                        <div className="mt-0.5 text-[10px] text-[var(--text-4)]">
                          {r.putStrike ? `$${r.putStrike} ` : ""}{fmtDay(r.putExpiry)}{pdte != null && (pdte < 0 ? <span className="ml-1 font-semibold text-[#ef4444]">expired</span> : pdte <= 7 ? <span className="ml-1 font-semibold text-[#f59e0b]">⏰ {pdte}d</span> : <span className="ml-1">{pdte}d</span>)}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums text-[var(--text-2)]">{r.shares || "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[var(--text-2)]">{money(r.costBasis)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#22c55e]">{money(r.premium, 0)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium text-[var(--text)]" title="Cost basis minus premium collected per share">{money(ab)}</td>
                    <td className="max-w-[12rem] truncate px-2 py-2 text-[var(--text-3)]">{r.note}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right"><Link href={act.href} className={"text-[11px] hover:underline " + (rollSoon ? "font-semibold text-[#f59e0b]" : "text-[var(--accent)]")}>{rollSoon ? "⏰ Roll now →" : act.label}</Link></td>
                    <td className="px-2 py-2 text-right"><button onClick={() => setDraft(r)} title="Edit" className="text-[var(--text-4)] hover:text-[var(--text)]">✎</button> <button onClick={() => remove(r.id)} title="Delete" className="text-[var(--text-4)] hover:text-[#ef4444]">✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-[var(--text-4)]">Adjusted basis = your cost basis minus premium collected per share — the wheel&apos;s whole point is grinding it down. Enter the cumulative premium as you collect it. Positions are stored only in this browser (localStorage) — they never leave your device. Decision-support, not advice.</p>
    </main>
  );
}
