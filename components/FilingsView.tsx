"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import RedlineSection from "./Redline";
import TranscriptIntel from "./TranscriptIntel";
import CallAnalysis from "./CallAnalysis";
import EarningsCallAI from "./EarningsCallAI";
import FilingAI from "./FilingAI";
import TranscriptThread from "./TranscriptThread";
import { LoadingState } from "./Spinner";
import type { TranscriptTurn } from "@/lib/transcriptTurns";
import type { CallDigest } from "@/lib/callDigests";

interface Filing {
  form: string;
  date: string;
  acc: string;
  doc: string;
  items: string;
  label: string;
  isEarnings: boolean;
  url: string;
}

interface QuarterMeta {
  period: string; // "2026-Q2"
  callDate: string; // "2026-05-01"
  hasDigest: boolean;
  tone: string | null;
  tldr: string | null;
}
interface SelectedCall {
  period: string;
  callDate: string;
  title: string;
  source: string;
  url: string;
  digest: CallDigest | null;
  turns: TranscriptTurn[];
}

export default function FilingsView({ symbol, name }: { symbol: string; name?: string }) {
  const [filings, setFilings] = useState<Filing[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [cik, setCik] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [openAcc, setOpenAcc] = useState<string | null>(null);
  const [docs, setDocs] = useState<Record<string, { title: string; text: string; url: string } | "loading" | "error">>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFilings([]);
    setErr(null);
    fetch(`/api/filings/${encodeURIComponent(symbol)}?offset=0&limit=30`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setFilings(d.filings || []);
        setNextOffset(d.nextOffset ?? null);
        setCik(d.cik ?? null);
        if (d.error) setErr(d.error);
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const loadMore = useCallback(() => {
    if (nextOffset == null || loadingMore) return;
    setLoadingMore(true);
    fetch(`/api/filings/${encodeURIComponent(symbol)}?offset=${nextOffset}&limit=30`)
      .then((r) => r.json())
      .then((d) => {
        setFilings((prev) => [...prev, ...(d.filings || [])]);
        setNextOffset(d.nextOffset ?? null);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  }, [nextOffset, loadingMore, symbol]);

  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && loadMore(), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const toggleRead = (f: Filing) => {
    if (openAcc === f.acc) {
      setOpenAcc(null);
      return;
    }
    setOpenAcc(f.acc);
    if (!docs[f.acc]) {
      setDocs((p) => ({ ...p, [f.acc]: "loading" }));
      fetch(`/api/filings/${encodeURIComponent(symbol)}?acc=${encodeURIComponent(f.acc)}`)
        .then((r) => r.json())
        .then((d) => setDocs((p) => ({ ...p, [f.acc]: d?.text ? d : "error" })))
        .catch(() => setDocs((p) => ({ ...p, [f.acc]: "error" })));
    }
  };

  return (
    <div className="space-y-4">
      <FilingAI symbol={symbol} name={name} />
      <EarningsCallAI symbol={symbol} name={name} />
      <CallAnalysis symbol={symbol} name={name} />
      <EarningsCallTranscripts symbol={symbol} />
      <TranscriptIntel symbol={symbol} name={name} />
      <RedlineSection symbol={symbol} name={name} />
      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]"><LoadingState label="Loading filings from SEC EDGAR…" className="py-12" /></div>
      ) : !cik || filings.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">
          No SEC filings found for {symbol}.{err && <div className="mt-1 text-[11px] text-[var(--text-4)]">{err}</div>}
        </div>
      ) : (
      <>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs leading-relaxed text-[var(--text-3)]">
        <span className="font-semibold text-[var(--text-2)]">Earnings releases &amp; material filings</span> straight from SEC EDGAR —
        open an <span className="text-[#22c55e]">earnings release</span> to read management&apos;s results commentary inline.
        The earnings-call <em>transcripts</em> above open our own archived call — full Q&amp;A + the AI digest — in the reader.
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
              <th className="px-4 py-2 text-left font-medium">Date</th>
              <th className="px-4 py-2 text-left font-medium">Filing</th>
              <th className="px-4 py-2 text-right font-medium">Read</th>
            </tr>
          </thead>
          <tbody>
            {filings.map((f) => {
              const readable = f.form === "8-K" || f.form === "DEF 14A" || f.form === "6-K";
              const doc = docs[f.acc];
              const open = openAcc === f.acc;
              return (
                <FilingRow
                  key={f.acc + f.form}
                  f={f}
                  readable={readable}
                  open={open}
                  doc={doc}
                  onToggle={() => toggleRead(f)}
                />
              );
            })}
          </tbody>
        </table>
        <div ref={sentinel} />
        <div className="px-4 py-3 text-center text-xs text-[var(--text-3)]">
          {nextOffset != null ? (
            <button onClick={loadMore} disabled={loadingMore} className="rounded-md border border-[var(--border)] px-3 py-1.5 hover:border-[var(--border-strong)] disabled:opacity-50">
              {loadingMore ? "Loading…" : "Load older filings"}
            </button>
          ) : (
            <span className="text-[var(--text-4)]">All recent filings loaded.</span>
          )}
        </div>
      </div>
      </>
      )}
    </div>
  );
}

const TONE_DOT: Record<string, string> = { upbeat: "🟢", measured: "🟡", cautious: "🟠", defensive: "🔴" };

// Our OWN archived earnings calls (data/calls via /api/calls), read INLINE right here — no page hop. Quarter pills
// pick a call; the selected quarter's iMessage thread (with the AI digest when ingested) renders below in a
// scroll-contained box. Only the selected quarter's turns are fetched, so switching quarters is a light request.
function EarningsCallTranscripts({ symbol }: { symbol: string }) {
  const [quarters, setQuarters] = useState<QuarterMeta[] | null>(null);
  const [selected, setSelected] = useState<SelectedCall | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let alive = true;
    setQuarters(null);
    setSelected(null);
    fetch(`/api/calls/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setQuarters(d.quarters || []);
        setSelected(d.selected || null);
      })
      .catch(() => {
        if (!alive) return;
        setQuarters([]);
        setSelected(null);
      });
    return () => {
      alive = false;
    };
  }, [symbol]);

  const pick = (period: string) => {
    if (selected?.period === period || switching) return;
    setSwitching(true);
    fetch(`/api/calls/${encodeURIComponent(symbol)}?q=${encodeURIComponent(period)}`)
      .then((r) => r.json())
      .then((d) => setSelected(d.selected || null))
      .catch(() => {})
      .finally(() => setSwitching(false));
  };

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-2.5">
        <span className="text-sm font-semibold text-[var(--text-2)]">Earnings-call transcripts</span>
        <span className="ml-2 text-[11px] text-[var(--text-4)]">prepared remarks + Q&amp;A, speaker by speaker</span>
      </div>

      {quarters == null ? (
        <div className="px-4 py-4 text-xs text-[var(--text-3)]">Loading archived calls…</div>
      ) : quarters.length === 0 ? (
        <div className="px-4 py-5 text-xs leading-relaxed text-[var(--text-3)]">
          No archived transcripts for {symbol} yet — the earnings-call archive fills in as the backfill + AI ingestion run.
        </div>
      ) : (
        <>
          {/* Quarter picker — newest first */}
          <div className="flex gap-1.5 overflow-x-auto border-b border-[var(--divider)] px-4 py-2.5" style={{ scrollbarWidth: "thin" }}>
            {quarters.map((q) => {
              const active = selected?.period === q.period;
              return (
                <button
                  key={q.period}
                  onClick={() => pick(q.period)}
                  className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold tabular-nums ${
                    active
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-2)] hover:border-[var(--border-strong)]"
                  }`}
                >
                  {q.period.replace("-", " ")}
                </button>
              );
            })}
          </div>

          {selected && (
            <div className="px-4 py-3">
              <div className="mb-2 text-[11px] text-[var(--text-4)]">
                {selected.period.replace("-", " ")} · {selected.callDate}
                {selected.digest ? ` · ${TONE_DOT[selected.digest.tone] || ""} tone ${selected.digest.tone}` : " · AI digest pending ingestion"}
              </div>
              {selected.digest?.tldr && (
                <p className="mb-3 rounded-lg bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-relaxed text-[var(--text)]">{selected.digest.tldr}</p>
              )}
              <div className="max-h-[560px] overflow-y-auto pr-1" style={{ opacity: switching ? 0.45 : 1, transition: "opacity 120ms" }}>
                <TranscriptThread turns={selected.turns} />
              </div>
              <div className="mt-3 text-[11px] text-[var(--text-4)]">
                Transcript via{" "}
                <a href={selected.url} target="_blank" rel="noreferrer" className="hover:underline">{selected.source}</a>. Research, not advice.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FilingRow({
  f,
  readable,
  open,
  doc,
  onToggle,
}: {
  f: Filing;
  readable: boolean;
  open: boolean;
  doc: { title: string; text: string; url: string } | "loading" | "error" | undefined;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-[var(--divider)]">
        <td className="whitespace-nowrap px-4 py-2 tabular-nums text-[var(--text-2)]">{f.date}</td>
        <td className="px-4 py-2">
          <span
            className="mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              background: f.isEarnings ? "#0f2a1a" : "var(--surface-hover)",
              color: f.isEarnings ? "#22c55e" : "var(--text-3)",
            }}
          >
            {f.form}
          </span>
          <span className={f.isEarnings ? "text-[var(--text)]" : "text-[var(--text-2)]"}>{f.label}</span>
        </td>
        <td className="whitespace-nowrap px-4 py-2 text-right">
          {readable && (
            <button onClick={onToggle} className="mr-3 text-xs text-[var(--accent)] hover:underline">
              {open ? "Hide" : f.isEarnings ? "Read release" : "Read"}
            </button>
          )}
          <a href={f.url} target="_blank" rel="noreferrer" className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">
            EDGAR ↗
          </a>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[var(--divider)] bg-[var(--surface-2)]">
          <td colSpan={3} className="px-4 py-3">
            {doc === "loading" || doc === undefined ? (
              <div className="text-xs text-[var(--text-3)]">Loading document…</div>
            ) : doc === "error" ? (
              <div className="text-xs text-[var(--text-3)]">
                Couldn&apos;t extract text.{" "}
                <a href={f.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">Open on EDGAR ↗</a>
              </div>
            ) : (
              <div className="max-h-[460px] overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-body)]">
                {doc.text}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
