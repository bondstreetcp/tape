"use client";
import { useCallback, useEffect, useState } from "react";

interface DocHit {
  name: string;
  ticker: string | null;
  cik: string;
  form: string;
  date: string;
  accession: string;
  filename: string;
  url: string;
}
interface Result {
  query: string;
  total: number;
  hits: DocHit[];
  from: number;
  nextFrom: number | null;
}

const FORM_FILTERS = [
  { label: "All filings", value: "" },
  { label: "10-K (annual)", value: "10-K" },
  { label: "10-Q (quarterly)", value: "10-Q" },
  { label: "8-K (events)", value: "8-K" },
  { label: "Proxy (DEF 14A)", value: "DEF 14A" },
];

function highlight(text: string, term: string) {
  const t = term.replace(/(^["']|["']$)/g, "").trim();
  if (!t) return text;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.split(new RegExp(`(${esc})`, "ig")).map((p, i) =>
    p.toLowerCase() === t.toLowerCase() ? (
      <mark key={i} className="rounded bg-[#3a3618] px-0.5 text-[#fde68a]">{p}</mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

export default function DocSearch({ ticker, name }: { ticker?: string; name?: string }) {
  const [q, setQ] = useState("");
  const [forms, setForms] = useState("");
  const [submitted, setSubmitted] = useState<{ q: string; forms: string } | null>(null);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(12);

  const run = useCallback(
    (query: string, f: string, from = 0, append = false) => {
      if (!query.trim()) return;
      setLoading(true);
      const u = new URLSearchParams({ q: query });
      if (f) u.set("forms", f);
      if (ticker) u.set("ticker", ticker);
      if (from) u.set("from", String(from));
      fetch(`/api/docsearch?${u.toString().replace(/\+/g, "%20")}`)
        .then((r) => r.json())
        .then((d: Result) => setData((prev) => (append && prev ? { ...d, hits: [...prev.hits, ...(d.hits || [])] } : d)))
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [ticker],
  );

  const onSearch = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSubmitted({ q, forms });
    setVisible(12);
    setData(null);
    run(q, forms);
  };

  return (
    <div className="space-y-3">
      <form onSubmit={onSearch} className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            ticker
              ? `Search ${name || ticker}'s filings — e.g. "data center", buyback, China`
              : 'Search every company\'s filings — e.g. "generative AI", tariff'
          }
          className="min-w-[240px] flex-1 rounded-lg border border-[#2a2e39] bg-[#0d1117] px-3 py-2 text-sm text-[#e6e9f0] outline-none placeholder:text-[#5b6478] focus:border-[#3a4256]"
        />
        <select
          value={forms}
          onChange={(e) => setForms(e.target.value)}
          className="rounded-lg border border-[#2a2e39] bg-[#0d1117] px-2 py-2 text-sm text-[#aab2c5] outline-none focus:border-[#3a4256]"
        >
          {FORM_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8]">
          Search
        </button>
      </form>
      <p className="text-[11px] text-[#5b6478]">
        Full-text search of SEC EDGAR filings since 2001. Wrap a phrase in &quot;quotes&quot; for an exact match.
      </p>

      {submitted &&
        (loading && !data ? (
          <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">
            Searching EDGAR…
          </div>
        ) : !data || data.total === 0 ? (
          <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">
            No filings found for &quot;{submitted.q}&quot;{ticker ? ` from ${name || ticker}` : ""}.
          </div>
        ) : (
          <>
            <div className="text-xs text-[#8b93a7]">
              <span className="font-semibold text-[#aab2c5]">{data.total >= 10000 ? "10,000+" : data.total.toLocaleString()}</span>{" "}
              filings mention <span className="text-[#e6e9f0]">&quot;{submitted.q}&quot;</span>
              {ticker ? "" : " across all companies"}
            </div>
            <div className="space-y-2">
              {data.hits.slice(0, visible).map((h, i) => (
                <ResultRow key={h.accession + h.filename + i} hit={h} q={submitted.q} showCompany={!ticker} />
              ))}
            </div>
            {visible < data.hits.length ? (
              <button
                onClick={() => setVisible((v) => v + 12)}
                className="w-full rounded-lg border border-[#2a2e39] bg-[#131722] py-2 text-sm text-[#aab2c5] hover:border-[#3a4256]"
              >
                Show more results
              </button>
            ) : data.nextFrom != null ? (
              <button
                onClick={() => { run(submitted.q, submitted.forms, data.nextFrom!, true); setVisible((v) => v + 12); }}
                disabled={loading}
                className="w-full rounded-lg border border-[#2a2e39] bg-[#131722] py-2 text-sm text-[#aab2c5] hover:border-[#3a4256] disabled:opacity-50"
              >
                {loading ? "Loading…" : "Load more from EDGAR"}
              </button>
            ) : null}
          </>
        ))}
    </div>
  );
}

function ResultRow({ hit, q, showCompany }: { hit: DocHit; q: string; showCompany: boolean }) {
  const [snip, setSnip] = useState<string | null | "loading">("loading");
  useEffect(() => {
    let alive = true;
    setSnip("loading");
    if (!hit.url) {
      setSnip(null);
      return;
    }
    fetch(`/api/docsearch/snippet?q=${encodeURIComponent(q)}&url=${encodeURIComponent(hit.url)}`)
      .then((r) => r.json())
      .then((d) => alive && setSnip(d.snippet || null))
      .catch(() => alive && setSnip(null));
    return () => {
      alive = false;
    };
  }, [hit.url, q]);

  return (
    <div className="rounded-xl border border-[#2a2e39] bg-[#131722] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="rounded bg-[#1a1f2e] px-1.5 py-0.5 font-medium text-[#aab2c5]">{hit.form}</span>
        {showCompany && (
          <span className="font-semibold text-[#e6e9f0]">
            {hit.name}
            {hit.ticker ? <span className="text-[#8b93a7]"> ({hit.ticker})</span> : null}
          </span>
        )}
        <span className="tabular-nums text-[#8b93a7]">{hit.date}</span>
        <a href={hit.url} target="_blank" rel="noreferrer" className="ml-auto text-[#60a5fa] hover:underline">
          Open on EDGAR ↗
        </a>
      </div>
      <div className="mt-1.5 text-[13px] leading-relaxed text-[#c2c8d4]">
        {snip === "loading" ? (
          <span className="text-[#5b6478]">Loading match…</span>
        ) : snip ? (
          highlight(snip, q)
        ) : (
          <span className="text-[#5b6478]">Match in filing — open on EDGAR to view.</span>
        )}
      </div>
    </div>
  );
}
