"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { fmtDateTime } from "@/lib/format";
import type { DebateOut, EvidenceEntry, Pole } from "@/lib/debates";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";
import HowToRead from "./HowToRead";

export interface DebatesFile {
  generatedAt: string;
  model: string;
  windowDays: number;
  candidates: number;
  debates: DebateOut[];
}

const BULL = "#22c55e", BEAR = "#ef4444", MUTE = "var(--text-4)";
const poleColor = (p: Pole) => (p === "bull" ? BULL : BEAR);
const TB = (on: boolean) =>
  `rounded-md px-2.5 py-1 text-[13px] font-medium transition ${on ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--text-3)] hover:text-[var(--text)]"}`;

/** Bare date for the ledger rail — the entries carry real instants, so this only trims, never invents. */
const dayOf = (iso: string) => (iso || "").slice(0, 10);

function BalanceStrip({ balance }: { balance: DebateOut["balance"] }) {
  if (!balance.length) return null;
  const peak = Math.max(...balance.map((b) => Math.max(b.bull, b.bear)), 1);
  return (
    <div className="flex items-end gap-1" aria-label="weekly bull vs bear evidence">
      {balance.map((b) => (
        <div key={b.from} className="flex w-6 flex-col items-center gap-0.5" title={`week of ${b.from}: bull ${b.bull}, bear ${b.bear}, net ${b.net}`}>
          <div className="w-full rounded-t-sm" style={{ height: `${(b.bull / peak) * 28}px`, background: BULL, opacity: 0.85 }} />
          <div className="w-full rounded-b-sm" style={{ height: `${(b.bear / peak) * 28}px`, background: BEAR, opacity: 0.85 }} />
          <span className="text-[9px] text-[var(--text-4)]">{b.from.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function LedgerRow({ e, universe }: { e: EvidenceEntry; universe: string }) {
  return (
    <li className="flex gap-3 border-b border-[var(--border)] py-2.5 last:border-0">
      <span className="w-[74px] shrink-0 pt-0.5 text-[12px] tabular-nums text-[var(--text-4)]">{dayOf(e.at)}</span>
      <span className="w-4 shrink-0 pt-0.5 text-[13px] font-bold" style={{ color: poleColor(e.pole) }} title={e.pole === "bull" ? "supports the bull pole" : "supports the bear pole"}>
        {e.pole === "bull" ? "↗" : "↘"}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link href={`/u/${universe}/stock/${e.ticker}`} className="text-[13px] font-semibold text-[var(--accent)] hover:underline">{e.ticker}</Link>
          <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[var(--text)] hover:underline">{e.headline}</a>
        </div>
        {e.detail && <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-3)]">{e.detail}</p>}
        {/* Every row states the gate that admitted it and at what score — the thing a competitor's
            editorially-curated feed cannot show you. */}
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-[var(--text-4)]">
          <span>{e.source}</span>
          <span>·</span>
          <span>admitted by {e.via === "roster" ? `similarity ${e.score.toFixed(2)}` : "an anchor phrase"}</span>
          <span>·</span>
          <span>weight {e.weight}</span>
        </div>
      </div>
    </li>
  );
}

export default function DebateLedgerView({ universe, data }: { universe: string; data: DebatesFile }) {
  const [id, setId] = useState(data.debates[0]?.debate.id ?? "");
  const [pole, setPole] = useState<"all" | Pole>("all");
  const sel = useMemo(() => data.debates.find((d) => d.debate.id === id) ?? data.debates[0], [data.debates, id]);

  const shown = useMemo(() => {
    if (!sel) return [];
    return pole === "all" ? sel.entries : sel.entries.filter((e) => e.pole === pole);
  }, [sel, pole]);

  if (!sel) return null;
  const d = sel.debate;
  const net = sel.counts.bull - sel.counts.bear;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Home</Link>
          <h1 className="mt-1 text-2xl font-bold">Key Debates</h1>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <HowToRead>
        <p><b>An investment argument, kept as a dated ledger.</b> Each debate is a question with two poles and a roster of companies. Every piece of dated evidence we already collect — SEC filings from the overnight scan, published short theses — is filed under the pole it supports, newest first.</p>
        <p><b>The roster is the load-bearing part.</b> Each name carries a role: <span style={{ color: BULL }}>+1</span> means it does well if the <b>bull pole</b> is right, <span style={{ color: BEAR }}>−1</span> means it does well if the <b>bear pole</b> is right. Evidence polarity is the filing&apos;s own direction <i>times</i> that role — so <b>good news at a name the thesis is short counts as bear evidence</b>. That matters more than it sounds: of 400 filings in a typical overnight window, only ~3% are bearish (companies file voluntary 8-Ks mostly to announce good things), so a ledger keyed on raw sentiment would be one-sided no matter how well it read the filings.</p>
        <p><b>What gets in.</b> Two gates, both required: the ticker must be <i>on the roster</i> (a company with no declared role has no defined relationship to either pole, so its news cannot be signed), and the filing must be about the <i>argument</i> rather than routine business — measured as similarity to the debate&apos;s anchor text, or an explicit anchor phrase. Every row shows which gate admitted it and at what score. Neutral filings are dropped rather than counted.</p>
        <p><b>Honest limits.</b> The debates are hand-declared — that is one person&apos;s judgement, versioned in a commit, not a consensus. Evidence accumulates forward from the day a debate opens, so a new one starts sparse and fills. An empty debate renders empty; it is never padded with older material.</p>
      </HowToRead>

      {/* debate picker */}
      <div className="mb-4 inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
        {data.debates.map((x) => (
          <button key={x.debate.id} onClick={() => { setId(x.debate.id); setPole("all"); }} className={TB(x.debate.id === sel.debate.id)}>
            {x.debate.question.split(/[,?]/)[0].slice(0, 34)}
            <span className="ml-1 text-[var(--text-4)]">{x.entries.length}</span>
          </button>
        ))}
      </div>

      <h2 className="text-[17px] font-semibold leading-snug">{d.question}</h2>

      {/* the two poles, pinned */}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {([["bull", d.bullPole], ["bear", d.bearPole]] as const).map(([p, text]) => (
          <div key={p} className="rounded-xl border p-3" style={{ borderColor: `${poleColor(p)}44`, background: `${poleColor(p)}0d` }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: poleColor(p) }}>
              {p === "bull" ? "Bull pole ↗" : "Bear pole ↘"}
              <span className="ml-1.5 font-normal text-[var(--text-4)]">{p === "bull" ? sel.counts.bull : sel.counts.bear} entries</span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-2)]">{text}</p>
          </div>
        ))}
      </div>

      {/* balance + roster */}
      <div className="mt-4 grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
            Evidence balance <InfoDot text="Weighted bull minus bear evidence, bucketed by week. Weight comes from the filing's own impact rating — a guidance change counts more than a routine disclosure." />
          </div>
          {sel.balance.length ? <BalanceStrip balance={sel.balance} /> : <p className="text-[12px] text-[var(--text-4)]">No dated evidence yet.</p>}
          <div className="mt-1.5 text-[12px]" style={{ color: net > 0 ? BULL : net < 0 ? BEAR : MUTE }}>
            net {net > 0 ? "+" : ""}{net} {net === 0 ? "— evenly balanced" : net > 0 ? "toward the bull pole" : "toward the bear pole"}
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-3)]">
            Roster <InfoDot text="+1 does well if the bull pole is right; −1 does well if the bear pole is right. This sign is what flips a company's own good news into evidence for the other side." />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.roster.map((m) => (
              <span key={m.ticker} title={m.why}
                className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px]"
                style={{ borderColor: `${poleColor(m.role === 1 ? "bull" : "bear")}55` }}>
                <Link href={`/u/${universe}/stock/${m.ticker}`} className="font-medium text-[var(--accent)] hover:underline">{m.ticker}</Link>
                <span style={{ color: poleColor(m.role === 1 ? "bull" : "bear") }}>{m.role === 1 ? "+1" : "−1"}</span>
              </span>
            ))}
          </div>
          {sel.standing && (sel.standing.bullNames.length > 0 || sel.standing.bearNames.length > 0) && (
            /* A DIFFERENT CLOCK from the ledger, and labelled as such. These come from the confluence /
               warnings boards, which are undated snapshots — mixing them into the dated stream would
               render state as news. */
            <p className="mt-2 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--text-3)]">
              <b>Standing today</b> (snapshot, {fmtDateTime(sel.standing.asOf)}):{" "}
              {sel.standing.bullNames.length ? <>favouring bull — <span style={{ color: BULL }}>{sel.standing.bullNames.join(", ")}</span>. </> : null}
              {sel.standing.bearNames.length ? <>favouring bear — <span style={{ color: BEAR }}>{sel.standing.bearNames.join(", ")}</span>.</> : null}
            </p>
          )}
        </div>
      </div>

      {/* ledger */}
      <div className="mt-5 mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setPole("all")} className={TB(pole === "all")}>All <span className="text-[var(--text-4)]">{sel.entries.length}</span></button>
          <button onClick={() => setPole("bull")} className={TB(pole === "bull")}>Bull ↗ <span className="text-[var(--text-4)]">{sel.counts.bull}</span></button>
          <button onClick={() => setPole("bear")} className={TB(pole === "bear")}>Bear ↘ <span className="text-[var(--text-4)]">{sel.counts.bear}</span></button>
        </div>
        <span className="text-[12px] text-[var(--text-4)]">
          opened {d.opened} · {data.windowDays}-day intake window · {data.candidates.toLocaleString()} candidates screened
        </span>
      </div>

      {shown.length ? (
        <ul className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3">
          {/* Keyed on the entry's natural identity (the same key the ledger dedups on). The old
              source|url|ticker key COLLIDED for every analyst target revision on one ticker (Yahoo gives a
              single URL per ticker), and colliding React keys reuse stale rows across a re-render — so
              switching debates or the bull/bear filter showed the previous list (the 2026-08-16 "same rows
              under every debate / filter does nothing" report). */}
          {shown.map((e) => <LedgerRow key={`${e.key || `${e.source}|${e.url}`}|${e.ticker}|${e.at}`} e={e} universe={universe} />)}
        </ul>
      ) : (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
          <p className="text-[13px] text-[var(--text-3)]">
            {sel.entries.length === 0
              ? "No evidence has cleared both gates for this debate yet — it accumulates forward from the day the debate opened."
              : "No entries on this side yet."}
          </p>
          <p className="mt-1 text-[12px] text-[var(--text-4)]">An empty ledger is the honest answer; it is never padded with older material.</p>
        </div>
      )}

      <p className="mt-4 text-[11px] text-[var(--text-4)]">
        Built {fmtDateTime(data.generatedAt)} · relevance scored with {data.model} · decision-support only, not advice.
      </p>
    </main>
  );
}
