"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import RedlineSection from "./Redline";
import TranscriptIntel from "./TranscriptIntel";
import CallAnalysis from "./CallAnalysis";
import EarningsCallAI from "./EarningsCallAI";
import FilingAI from "./FilingAI";
import { LoadingState } from "./Spinner";

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

interface ArchivedQuarter {
  period: string; // "2026-Q2"
  callDate: string; // "2026-05-01"
  title: string;
  source: string;
  hasDigest: boolean;
  tone: string | null;
  tldr: string | null;
  chars: number;
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

// Our OWN archived earnings calls (data/calls via /api/calls) — replaces the old list of publisher-site links.
// Each quarter opens the iMessage-style reader (full Q&A + AI digest). The reader lives at <stock page>/transcripts,
// so we build its href from the current pathname (query-less: /u/<universe>/stock/<symbol>) — no universe prop needed.
function EarningsCallTranscripts({ symbol }: { symbol: string }) {
  const pathname = usePathname();
  const [quarters, setQuarters] = useState<ArchivedQuarter[] | null>(null);

  useEffect(() => {
    let alive = true;
    setQuarters(null);
    fetch(`/api/calls/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => alive && setQuarters(d.quarters || []))
      .catch(() => alive && setQuarters([]));
    return () => {
      alive = false;
    };
  }, [symbol]);

  const readerBase = `${(pathname || "").replace(/\/$/, "")}/transcripts`;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <span className="text-sm font-semibold text-[var(--text-2)]">Earnings-call transcripts</span>
        {quarters && quarters.length > 0 && (
          <a href={readerBase} className="text-xs text-[var(--accent)] hover:underline">Open reader →</a>
        )}
      </div>

      {quarters == null ? (
        <div className="px-4 py-4 text-xs text-[var(--text-3)]">Loading archived calls…</div>
      ) : quarters.length === 0 ? (
        <div className="px-4 py-5 text-xs leading-relaxed text-[var(--text-3)]">
          No archived transcripts for {symbol} yet — the earnings-call archive fills in as the backfill + AI ingestion run.
        </div>
      ) : (
        <ul>
          {quarters.map((q) => (
            <li key={q.period} className="border-b border-[var(--divider)] last:border-0">
              <a href={`${readerBase}?q=${encodeURIComponent(q.period)}`} className="block px-4 py-2.5 hover:bg-[var(--surface-hover)]">
                <span className="flex items-center gap-2">
                  <span className="shrink-0 whitespace-nowrap rounded bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--text-3)]">
                    {q.period.replace("-", " ")}
                  </span>
                  <span className="text-sm tabular-nums text-[var(--text-2)]">{q.callDate}</span>
                  {q.tone && <span className="text-[11px] text-[var(--text-4)]">{TONE_DOT[q.tone] || ""} {q.tone}</span>}
                  <span className="ml-auto shrink-0 text-[11px] text-[var(--accent)]">Read →</span>
                </span>
                {q.tldr ? (
                  <span
                    className="mt-1 block text-[12px] leading-snug text-[var(--text-3)]"
                    style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                  >
                    {q.tldr}
                  </span>
                ) : (
                  <span className="mt-1 block text-[11px] italic text-[var(--text-4)]">Full transcript archived · AI digest pending</span>
                )}
              </a>
            </li>
          ))}
        </ul>
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
