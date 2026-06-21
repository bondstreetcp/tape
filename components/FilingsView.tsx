"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import RedlineSection from "./Redline";
import TranscriptIntel from "./TranscriptIntel";
import EarningsCallAI from "./EarningsCallAI";
import FilingAI from "./FilingAI";

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

interface TranscriptLink {
  title: string;
  publisher: string;
  link: string;
  time: string | null;
}

interface FullTranscript {
  title: string;
  date: string | null;
  source: string;
  url: string;
  text: string;
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
      <TranscriptLinks symbol={symbol} name={name} />
      <TranscriptIntel symbol={symbol} name={name} />
      <RedlineSection symbol={symbol} name={name} />
      {loading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">Loading filings from SEC EDGAR…</div>
      ) : !cik || filings.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">
          No SEC filings found for {symbol}.{err && <div className="mt-1 text-[11px] text-[var(--text-4)]">{err}</div>}
        </div>
      ) : (
      <>
      <div className="rounded-xl border border-[var(--border)] bg-[#0f1726] p-3 text-xs leading-relaxed text-[var(--text-3)]">
        <span className="font-semibold text-[var(--text-2)]">Earnings releases &amp; material filings</span> straight from SEC EDGAR —
        open an <span className="text-[#22c55e]">earnings release</span> to read management&apos;s results commentary inline.
        The earnings-call <em>transcripts</em> above link to the full call (with Q&amp;A) on the publisher&apos;s site.
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

function TranscriptBody({ text }: { text: string }) {
  const SPK = /^([A-Z][\w.'’-]*(?: [A-Z][\w.'’&-]*){0,4}):\s+([\s\S]+)$/;
  return (
    <>
      {text.split(/\n\n+/).map((p, i) => {
        const t = p.trim();
        if (!t) return null;
        if (t.length < 50 && (t === t.toUpperCase() || /^(prepared remarks|questions?(\s*(and|&)\s*)?answers?|q&a|call participants|operator instructions)\b/i.test(t))) {
          return <p key={i} className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-3)]">{t}</p>;
        }
        const m = t.match(SPK);
        if (m && m[1].length <= 34) {
          return (
            <p key={i} className="mb-2">
              <span className="font-semibold text-[var(--text)]">{m[1]}</span>: {m[2]}
            </p>
          );
        }
        return <p key={i} className="mb-2">{t}</p>;
      })}
    </>
  );
}

function TranscriptLinks({ symbol, name }: { symbol: string; name?: string }) {
  const [links, setLinks] = useState<TranscriptLink[] | null>(null);
  const [full, setFull] = useState<FullTranscript | "loading" | "error" | null>(null);

  useEffect(() => {
    let alive = true;
    setLinks(null);
    setFull(null);
    fetch(`/api/transcripts/${encodeURIComponent(symbol)}?name=${encodeURIComponent(name || symbol)}`)
      .then((r) => r.json())
      .then((d) => alive && setLinks(d.links || []))
      .catch(() => alive && setLinks([]));
    return () => {
      alive = false;
    };
  }, [symbol, name]);

  const loadFull = () => {
    if (full && full !== "error") return; // already loading or loaded
    setFull("loading");
    fetch(`/api/transcript-text/${encodeURIComponent(symbol)}?name=${encodeURIComponent(name || symbol)}`)
      .then((r) => r.json())
      .then((d) => setFull(d.transcript || "error"))
      .catch(() => setFull("error"));
  };

  const loaded = full && full !== "loading" && full !== "error" ? full : null;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <span className="text-sm font-semibold text-[var(--text-2)]">Earnings-call transcripts</span>
        <button onClick={loadFull} disabled={full === "loading"} className="text-xs text-[#60a5fa] hover:underline disabled:opacity-60">
          {full === "loading" ? "Loading…" : loaded ? "↻ Reload full call" : "📄 Read latest call in full"}
        </button>
      </div>

      {loaded && (
        <div className="border-b border-[var(--divider)] bg-[var(--surface-2)] px-4 py-3">
          <div className="text-sm font-semibold text-[var(--text)]">{loaded.title}</div>
          <div className="mb-2 text-[11px] text-[var(--text-4)]">
            {loaded.source}
            {loaded.date ? ` · ${loaded.date}` : ""} ·{" "}
            <a href={loaded.url} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">source ↗</a>
          </div>
          <div className="max-h-[480px] overflow-y-auto pr-1 text-[13px] leading-relaxed text-[var(--text-body)]">
            <TranscriptBody text={loaded.text} />
          </div>
        </div>
      )}
      {full === "error" && (
        <div className="border-b border-[var(--divider)] px-4 py-2 text-xs text-[var(--text-3)]">
          Couldn&apos;t load the full transcript automatically — open one of the links below.
        </div>
      )}

      {links == null ? (
        <div className="px-4 py-4 text-xs text-[var(--text-3)]">Finding recent transcripts…</div>
      ) : links.length === 0 ? (
        <div className="px-4 py-4 text-xs text-[var(--text-3)]">
          No transcripts found yet. Try a{" "}
          <a
            className="text-[#60a5fa] hover:underline"
            target="_blank"
            rel="noreferrer"
            href={`https://news.google.com/search?q=${encodeURIComponent((name || symbol) + " earnings call transcript")}`}
          >
            Google News search ↗
          </a>
          .
        </div>
      ) : (
        <ul>
          {links.map((l, i) => (
            <li key={i} className="border-b border-[var(--divider)] last:border-0">
              <a
                href={l.link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#161b29]"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm text-[var(--text)]">
                  {l.time && (
                    <span className="shrink-0 whitespace-nowrap rounded bg-[var(--bg)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-3)]">
                      {new Date(l.time).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                  )}
                  <span className="truncate">{l.title}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-3)]">{l.publisher} ↗</span>
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
            <button onClick={onToggle} className="mr-3 text-xs text-[#60a5fa] hover:underline">
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
                <a href={f.url} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">Open on EDGAR ↗</a>
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
