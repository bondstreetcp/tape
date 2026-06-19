"use client";
import { useCallback, useEffect, useRef, useState } from "react";

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

export default function FilingsView({ symbol }: { symbol: string }) {
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

  if (loading) {
    return <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">Loading filings from SEC EDGAR…</div>;
  }
  if (!cik || filings.length === 0) {
    return (
      <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">
        No SEC filings found for {symbol}.{err && <div className="mt-1 text-[11px] text-[#5b6478]">{err}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#2a2e39] bg-[#0f1726] p-3 text-xs leading-relaxed text-[#8b93a7]">
        <span className="font-semibold text-[#aab2c5]">Earnings releases &amp; material filings</span> straight from SEC EDGAR —
        open an <span className="text-[#22c55e]">earnings release</span> to read management&apos;s results commentary inline.
        Full earnings-call, investor-day &amp; conference <em>transcripts</em> (with Q&amp;A) are a paid data product;
        wire a transcript API key and they&apos;ll appear here too.
      </div>

      <div className="overflow-hidden rounded-xl border border-[#2a2e39] bg-[#131722]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a2e39] text-[#8b93a7]">
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
        <div className="px-4 py-3 text-center text-xs text-[#8b93a7]">
          {nextOffset != null ? (
            <button onClick={loadMore} disabled={loadingMore} className="rounded-md border border-[#2a2e39] px-3 py-1.5 hover:border-[#3a4256] disabled:opacity-50">
              {loadingMore ? "Loading…" : "Load older filings"}
            </button>
          ) : (
            <span className="text-[#5b6478]">All recent filings loaded.</span>
          )}
        </div>
      </div>
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
      <tr className="border-b border-[#1f2430]">
        <td className="whitespace-nowrap px-4 py-2 tabular-nums text-[#aab2c5]">{f.date}</td>
        <td className="px-4 py-2">
          <span
            className="mr-2 rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{
              background: f.isEarnings ? "#0f2a1a" : "#1a1f2e",
              color: f.isEarnings ? "#22c55e" : "#8b93a7",
            }}
          >
            {f.form}
          </span>
          <span className={f.isEarnings ? "text-[#e6e9f0]" : "text-[#aab2c5]"}>{f.label}</span>
        </td>
        <td className="whitespace-nowrap px-4 py-2 text-right">
          {readable && (
            <button onClick={onToggle} className="mr-3 text-xs text-[#60a5fa] hover:underline">
              {open ? "Hide" : f.isEarnings ? "Read release" : "Read"}
            </button>
          )}
          <a href={f.url} target="_blank" rel="noreferrer" className="text-xs text-[#8b93a7] hover:text-[#e6e9f0]">
            EDGAR ↗
          </a>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-[#1f2430] bg-[#0d1117]">
          <td colSpan={3} className="px-4 py-3">
            {doc === "loading" || doc === undefined ? (
              <div className="text-xs text-[#8b93a7]">Loading document…</div>
            ) : doc === "error" ? (
              <div className="text-xs text-[#8b93a7]">
                Couldn&apos;t extract text.{" "}
                <a href={f.url} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">Open on EDGAR ↗</a>
              </div>
            ) : (
              <div className="max-h-[460px] overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-[#c2c8d4]">
                {doc.text}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
