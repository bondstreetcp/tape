"use client";
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { CallDigest, CallDigestsData, CallTone, Directness, GuidanceAction } from "@/lib/callDigests";
import { fmtDateTime } from "@/lib/format";
import InfoDot from "./InfoDot";

const toneChip: Record<CallTone, { cls: string; label: string }> = {
  upbeat: { cls: "bg-[#22c55e]/15 text-[#22c55e]", label: "Upbeat" },
  measured: { cls: "bg-[var(--surface-hover)] text-[var(--text-3)]", label: "Measured" },
  cautious: { cls: "bg-[#f59e0b]/15 text-[#fbbf24]", label: "Cautious" },
  defensive: { cls: "bg-[#ef4444]/15 text-[#ef4444]", label: "Defensive" },
};
const guideChip: Record<GuidanceAction, { cls: string; label: string }> = {
  raised: { cls: "bg-[#22c55e]/15 text-[#22c55e]", label: "Guide raised" },
  reaffirmed: { cls: "bg-[var(--surface-hover)] text-[var(--text-3)]", label: "Guide reaffirmed" },
  cut: { cls: "bg-[#ef4444]/15 text-[#ef4444]", label: "Guide cut" },
  initiated: { cls: "bg-[var(--accent-soft)] text-[var(--accent)]", label: "Guide initiated" },
  withdrawn: { cls: "bg-[#ef4444]/15 text-[#ef4444]", label: "Guide withdrawn" },
  mixed: { cls: "bg-[#f59e0b]/15 text-[#fbbf24]", label: "Guide mixed" },
  none: { cls: "", label: "" },
};
const dirChip: Record<Directness, { cls: string; label: string }> = {
  direct: { cls: "bg-[#22c55e]/15 text-[#22c55e]", label: "direct" },
  partial: { cls: "bg-[#f59e0b]/15 text-[#fbbf24]", label: "partial" },
  evasive: { cls: "bg-[#ef4444]/15 text-[#ef4444]", label: "evasive" },
};
const CHIP = "rounded px-1.5 py-0.5 text-[10px] font-semibold";
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-2.5">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{title}</div>
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-[var(--text-2)]">{items.map((k, i) => <li key={i}>{k}</li>)}</ul>;
}

function Card({ d, universe, open, toggle }: { d: CallDigest; universe: string; open: boolean; toggle: () => void }) {
  const g = guideChip[d.guidance.action];
  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link href={`/u/${universe}/stock/${encodeURIComponent(d.symbol)}`} className="font-mono text-sm font-bold text-[var(--accent)] hover:underline">{d.symbol}</Link>
        <span className="text-[13px] font-semibold text-[var(--text)]">{d.name}</span>
        {d.sector && <span className="text-[11px] text-[var(--text-4)]">{d.sector}</span>}
        <span className={`${CHIP} ${toneChip[d.tone].cls}`} title="Management's tone on the call, as read by the model">{toneChip[d.tone].label}</span>
        {g.label && <span className={`${CHIP} ${g.cls}`} title={d.guidance.detail || undefined}>{g.label}</span>}
        <button onClick={toggle} className="ml-auto text-[11px] text-[var(--text-3)] hover:text-[var(--text)]">{open ? "Collapse ▴" : "Details ▾"}</button>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]">{d.tldr}</p>
      {d.guidance.action !== "none" && d.guidance.detail && (
        <p className="mt-1 text-[12px] text-[var(--text-3)]"><b className="text-[var(--text-2)]">Guidance:</b> {d.guidance.detail}</p>
      )}
      {open && (
        <div className="mt-1 border-t border-[var(--border)] pt-1">
          {d.kpis.length > 0 && <Section title="Numbers stated on the call"><Bullets items={d.kpis} /></Section>}
          {d.drivers.length > 0 && <Section title="What drove the quarter"><Bullets items={d.drivers} /></Section>}
          {d.qa.length > 0 && (
            <Section title="Sharpest analyst exchanges">
              <ul className="space-y-1.5">
                {d.qa.map((q, i) => (
                  <li key={i} className="rounded-lg bg-[var(--bg)] px-2.5 py-1.5 text-[12px]">
                    <div className="text-[var(--text-2)]"><b>{q.analyst || "Analyst"}:</b> {q.question}</div>
                    <div className="mt-0.5 text-[var(--text-3)]">
                      <b className="text-[var(--text-2)]">Mgmt:</b> {q.answer}{" "}
                      <span className={`${CHIP} ml-1 ${dirChip[q.directness].cls}`} title="How squarely management answered">{dirChip[q.directness].label}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {d.readThrough.length > 0 && <Section title="Read-through"><Bullets items={d.readThrough} /></Section>}
          {d.watch.length > 0 && <Section title="Watch next quarter"><Bullets items={d.watch} /></Section>}
          {d.quotes.length > 0 && (
            <Section title="In their words (verbatim, code-checked against the transcript)">
              {d.quotes.map((q, i) => (
                <blockquote key={i} className="mt-1 border-l-2 border-[var(--border-strong)] pl-2.5 text-[12px] italic text-[var(--text-3)]">
                  “{q.text}”{q.speaker && <span className="not-italic text-[var(--text-4)]"> — {q.speaker}</span>}
                </blockquote>
              ))}
            </Section>
          )}
          <div className="mt-2.5 flex flex-wrap gap-x-3 text-[10px] text-[var(--text-4)]">
            <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline">{d.source}: {d.title} ↗</a>
            <span>{Math.round(d.chars / 1000)}k chars · {d.chunks} segment{d.chunks === 1 ? "" : "s"}</span>
            <span>{d.model}</span>
            <span>read {fmtDateTime(d.digestedAt)}</span>
          </div>
        </div>
      )}
    </li>
  );
}

// The Daily Desk "Earnings Calls" tab — every transcript from the last session, digested on the desk's local
// model, with the cross-call synthesis on top. Sessions are the transcripts' own dates (an after-close call
// can carry the next morning's date); the synthesis covers everything from the run's session day forward.
export default function CallDigestsView({ universe, data }: { universe: string; data: CallDigestsData }) {
  const sessions = useMemo(() => [...new Set(data.digests.map((d) => d.callDate))].sort((a, b) => b.localeCompare(a)), [data.digests]);
  const [session, setSession] = useState<string>(sessions[0] ?? "");
  const [q, setQ] = useState("");
  const [guideOnly, setGuideOnly] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return data.digests
      .filter((d) => d.callDate === session)
      .filter((d) => !guideOnly || (d.guidance.action !== "none" && d.guidance.action !== "reaffirmed"))
      .filter((d) => !needle || d.symbol.toLowerCase().includes(needle) || d.name.toLowerCase().includes(needle));
  }, [data.digests, session, q, guideOnly]);
  const synth = data.synthesis && session && session >= data.synthesis.sessionDay ? data.synthesis : null;
  const allOpen = rows.length > 0 && rows.every((d) => open[`${d.symbol}|${d.callDate}`]);
  const lr = data.lastRun;

  if (!data.digests.length) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-sm text-[var(--text-3)]">
        No calls digested yet.{" "}
        {lr?.sessionDay
          ? <>Last run covered session {fmtDay(lr.sessionDay)}: {lr.candidates} reporters, {lr.withTranscript} with a transcript posted{lr.deferred ? `, ${lr.deferred} deferred to the next tick` : ""}.</>
          : "The first run happens on the next desk tick."}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {sessions.slice(0, 8).map((s) => (
            <button key={s} onClick={() => setSession(s)} className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition ${s === session ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--text-3)] hover:text-[var(--text)]"}`}>
              {fmtDay(s)} <span className="text-[var(--text-4)]">{data.digests.filter((d) => d.callDate === s).length}</span>
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by ticker / name" className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--text-4)]" />
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text-3)]">
          <input type="checkbox" checked={guideOnly} onChange={(e) => setGuideOnly(e.target.checked)} /> guidance changed only
        </label>
        <button onClick={() => setOpen(Object.fromEntries(rows.map((d) => [`${d.symbol}|${d.callDate}`, !allOpen])))} className="ml-auto text-[12px] text-[var(--text-3)] hover:text-[var(--text)]">
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>

      {synth && (
        <section className="mb-4 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/40 p-3">
          <div className="mb-1 flex flex-wrap items-baseline gap-2">
            <h3 className="text-[13px] font-bold text-[var(--text)]">What the calls said, together</h3>
            <span className="text-[11px] text-[var(--text-4)]">{synth.n} calls · session {fmtDay(synth.sessionDay)}</span>
            <InfoDot text="A second model pass over every digest from the session — the themes that cut across companies (demand, pricing, AI spend, tariffs, guidance posture) and the divergences. Tickers are limited to the calls actually digested." />
          </div>
          <p className="text-[13px] leading-relaxed text-[var(--text-2)]">{synth.tldr}</p>
          <ul className="mt-2 space-y-1.5">
            {synth.themes.map((t, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-[var(--text-2)]">
                <b className="text-[var(--text)]">{t.heading}.</b> {t.detail}
                {t.tickers.map((tk) => (
                  <Link key={tk} href={`/u/${universe}/stock/${encodeURIComponent(tk)}`} className="ml-1.5 font-mono text-[11px] font-semibold text-[var(--accent)] hover:underline">{tk}</Link>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((d) => {
            const k = `${d.symbol}|${d.callDate}`;
            return <Card key={k} d={d} universe={universe} open={!!open[k]} toggle={() => setOpen((o) => ({ ...o, [k]: !o[k] }))} />;
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-[13px] text-[var(--text-3)]">No digested calls match.</p>
      )}

      <p className="mt-3 text-[11px] text-[var(--text-4)]">
        Every transcript is read in full ({lr.local ? "on the desk's local model" : "on the cloud flash tier, the same model the overnight SEC-filings digests use"}), in ≤34k-character segments, then reduced to one digest; quotes are verbatim and every stated number is checked against the transcript. Last run: session {lr.sessionDay ? fmtDay(lr.sessionDay) : "—"} · {lr.candidates} reporters · {lr.withTranscript} transcripts posted · {lr.digested} read this run{lr.sources && Object.keys(lr.sources).length ? ` (${Object.entries(lr.sources).map(([k, v]) => `${k === "investing" ? "Investing.com" : k === "fool" ? "The Motley Fool" : k} ${v}`).join(", ")})` : ""}{lr.notPosted ? ` · ${lr.notPosted} with no transcript posted yet` : ""}{lr.deferred ? ` · ${lr.deferred} deferred to the next tick` : ""}{lr.llmFails ? ` · ${lr.llmFails} failed` : ""}{lr.blocked?.length ? ` · ${lr.blocked.join(", ")} refuses this runner's IP, so a clean-IP box fills the gap and publishes to R2` : ""} · built {fmtDateTime(data.generatedAt)}. Transcripts: Investing.com (same day) and The Motley Fool. Decision-support, not advice.
      </p>
    </div>
  );
}
