"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

// A lightweight wheel tracker — the cycle is sell puts → get assigned → sell calls → get called → repeat.
// This logs your active wheels (which leg you're in, shares, cost basis, premium collected to date) and
// shows the adjusted basis (basis − premium/share) + the next action. Book stays in the browser
// (localStorage); nothing leaves the device. Decision-support, not advice.

type Leg = "idle" | "put" | "shares" | "call";
interface WheelPos { id: string; symbol: string; leg: Leg; shares: number; costBasis: number | null; premium: number; note: string }

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
                return (
                  <tr key={r.id} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                    <td className="px-3 py-2"><Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}?tab=wheel`} className="font-mono font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link></td>
                    <td className="px-2 py-2"><span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${leg.color}22`, color: leg.color }}>{leg.label}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums text-[var(--text-2)]">{r.shares || "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[var(--text-2)]">{money(r.costBasis)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-[#22c55e]">{money(r.premium, 0)}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-medium text-[var(--text)]" title="Cost basis minus premium collected per share">{money(ab)}</td>
                    <td className="max-w-[12rem] truncate px-2 py-2 text-[var(--text-3)]">{r.note}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right"><Link href={act.href} className="text-[11px] text-[var(--accent)] hover:underline">{act.label}</Link></td>
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
