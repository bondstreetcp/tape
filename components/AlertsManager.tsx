"use client";
/** The /alerts hub: create alert rules (price / filing-event / earnings / signal) and manage existing
 *  ones. RLS-scoped to the signed-in user. Prefills the symbol from ?symbol= (the stock-page button). */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAlertRules } from "@/lib/supabase/useAlertRules";
import { useUser } from "@/lib/supabase/useUser";
import type { AlertKind, AlertRule } from "@/lib/alerts";
import { KIND_COLOR, KIND_LABEL } from "@/lib/alerts";

const EVENT_TYPES = [
  { key: "filing", label: "Material 8-K" },
  { key: "campaign", label: "Activist campaign" },
  { key: "insider", label: "Insider cluster buy" },
];
const SIGNALS = [
  { key: "cheap10y", label: "Cheap vs its 10yr history" },
  { key: "rs_breakout", label: "Relative-strength breakout" },
  { key: "short_squeeze", label: "Short-squeeze risk" },
];

function describeRule(r: AlertRule): string {
  const who = r.symbol || "any watched name";
  const p = r.params as Record<string, unknown>;
  if (r.kind === "price") {
    if (typeof p.above === "number") return `${who} crosses above $${p.above}`;
    if (typeof p.below === "number") return `${who} crosses below $${p.below}`;
    if (typeof p.pct === "number") return `${who} moves ±${p.pct}% in a day`;
    return `${who} — price`;
  }
  if (r.kind === "earnings") return `${who} — ${(p.daysBefore as number) ?? 3} days before earnings`;
  if (r.kind === "signal") return `${who} — ${SIGNALS.find((s) => s.key === p.signal)?.label ?? "signal"}`;
  const types = Array.isArray(p.types) ? (p.types as string[]) : EVENT_TYPES.map((t) => t.key);
  return `${who} — ${types.map((t) => EVENT_TYPES.find((e) => e.key === t)?.label ?? t).join(", ")}`;
}

export default function AlertsManager({ universe }: { universe: string }) {
  const { user, enabled, loading: userLoading } = useUser();
  const { rules, loading, create, remove, setActive } = useAlertRules();
  const sp = useSearchParams();

  const [symbol, setSymbol] = useState((sp.get("symbol") || "").toUpperCase());
  const [kind, setKind] = useState<AlertKind>("price");
  const [priceMode, setPriceMode] = useState<"above" | "below" | "pct">("above");
  const [priceVal, setPriceVal] = useState("");
  const [daysBefore, setDaysBefore] = useState("3");
  const [eventTypes, setEventTypes] = useState<string[]>(EVENT_TYPES.map((e) => e.key));
  const [signal, setSignal] = useState("cheap10y");
  const [busy, setBusy] = useState(false);

  const canSubmit = useMemo(() => {
    if (kind === "price") return !!symbol && !!priceVal && !Number.isNaN(Number(priceVal));
    if (kind === "event") return eventTypes.length > 0; // symbol optional (blank = whole watchlist)
    if (kind === "earnings") return true;
    if (kind === "signal") return true;
    return false;
  }, [kind, symbol, priceVal, eventTypes]);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    const params: Record<string, unknown> =
      kind === "price"
        ? { [priceMode]: Number(priceVal) }
        : kind === "earnings"
          ? { daysBefore: Math.max(0, Number(daysBefore) || 0) }
          : kind === "signal"
            ? { signal }
            : { types: eventTypes };
    await create({ symbol: symbol.trim() ? symbol.trim().toUpperCase() : null, kind, params });
    setPriceVal("");
    setBusy(false);
  };

  const wrap = (child: React.ReactNode) => (
    <main className="mx-auto max-w-[52rem] px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Home</Link>
      <h1 className="mt-1 text-2xl font-bold">Alerts</h1>
      {child}
    </main>
  );

  if (!enabled) return wrap(<p className="mt-4 text-sm text-[var(--text-3)]">Accounts aren&apos;t configured on this deployment yet.</p>);
  if (userLoading) return wrap(<p className="mt-4 text-sm text-[var(--text-4)]">Loading…</p>);
  if (!user)
    return wrap(
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <p className="text-sm text-[var(--text-2)]">Sign in (top-right) to create alerts.</p>
        <p className="mt-1 text-xs text-[var(--text-4)]">Alerts are evaluated on the nightly/intraday runs and land in the header bell.</p>
      </div>,
    );

  const inputCls = "rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]";

  return wrap(
    <>
      <p className="mt-1 text-[13px] text-[var(--text-3)]">Create a rule, and matches land in the header bell. Evaluated against the data Tape already collects — no extra setup.</p>

      {/* Create form */}
      <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">Symbol {kind === "price" ? "" : "(blank = watchlist)"}</span>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} placeholder="AN" className={inputCls + " w-28 font-mono"} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">Trigger</span>
            <select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)} className={inputCls}>
              {(["price", "event", "earnings", "signal"] as AlertKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>

          {kind === "price" && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">Condition</span>
                <select value={priceMode} onChange={(e) => setPriceMode(e.target.value as typeof priceMode)} className={inputCls}>
                  <option value="above">crosses above</option>
                  <option value="below">crosses below</option>
                  <option value="pct">daily move ≥ ±</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">{priceMode === "pct" ? "%" : "$"}</span>
                <input value={priceVal} onChange={(e) => setPriceVal(e.target.value)} inputMode="decimal" placeholder={priceMode === "pct" ? "5" : "200"} className={inputCls + " w-24"} />
              </label>
            </>
          )}
          {kind === "earnings" && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">Days before</span>
              <input value={daysBefore} onChange={(e) => setDaysBefore(e.target.value)} inputMode="numeric" className={inputCls + " w-20"} />
            </label>
          )}
          {kind === "signal" && (
            <label className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-[var(--text-4)]">Signal</span>
              <select value={signal} onChange={(e) => setSignal(e.target.value)} className={inputCls}>
                {SIGNALS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          )}

          <button onClick={submit} disabled={!canSubmit || busy} className="rounded-lg bg-[var(--accent-strong)] px-3.5 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40">
            {busy ? "Adding…" : "Add alert"}
          </button>
        </div>

        {kind === "event" && (
          <div className="mt-3 flex flex-wrap gap-3 border-t border-[var(--divider)] pt-3">
            {EVENT_TYPES.map((t) => (
              <label key={t.key} className="flex items-center gap-1.5 text-[13px] text-[var(--text-2)]">
                <input
                  type="checkbox"
                  checked={eventTypes.includes(t.key)}
                  onChange={(e) => setEventTypes((prev) => (e.target.checked ? [...prev, t.key] : prev.filter((k) => k !== t.key)))}
                />
                {t.label}
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Existing rules */}
      <section className="mt-5">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Your rules {rules.length ? `(${rules.length})` : ""}</h2>
        {loading ? (
          <p className="text-sm text-[var(--text-4)]">Loading…</p>
        ) : rules.length === 0 ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">No rules yet — add one above.</p>
        ) : (
          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[r.kind] || "var(--text-4)" }} />
                <span className={"text-[13px] " + (r.active ? "text-[var(--text)]" : "text-[var(--text-4)] line-through")}>{describeRule(r)}</span>
                <span className="ml-auto flex items-center gap-2">
                  <button onClick={() => setActive(r.id, !r.active)} className="text-[11px] text-[var(--text-4)] hover:text-[var(--text-2)]">{r.active ? "Pause" : "Resume"}</button>
                  <button onClick={() => remove(r.id)} title="Delete" className="text-[var(--text-4)] hover:text-[#ef4444]">✕</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>,
  );
}
