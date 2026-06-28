"use client";
import { useCallback, useEffect, useState } from "react";
import Button from "./Button";

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
  rewroteTo?: string;
}
interface Call { title: string; date: string | null; url: string; snippet: string; count: number; name?: string }

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
  const [submitted, setSubmitted] = useState<{ q: string; forms: string; all: boolean } | null>(null);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [visible, setVisible] = useState(12);
  const [calls, setCalls] = useState<Call[] | "loading" | null>(null);

  const run = useCallback(
    (query: string, f: string, from = 0, append = false, all = false) => {
      if (!query.trim()) return;
      setLoading(true);
      const u = new URLSearchParams({ q: query });
      if (f) u.set("forms", f);
      if (ticker && !all) u.set("ticker", ticker);
      if (from) u.set("from", String(from));
      fetch(`/api/docsearch?${u.toString().replace(/\+/g, "%20")}`)
        .then((r) => r.json())
        .then((d: Result) => {
          setData((prev) => {
            const hits = append && prev ? [...prev.hits, ...(d.hits || [])] : d.hits || [];
            hits.sort((a, b) => (b.date || "").localeCompare(a.date || "")); // reverse chronological — newest first
            return { ...d, hits };
          });
          // Global search: also search the transcripts of the top companies that
          // matched in the filing results (per-ticker search is handled in onSearch).
          if (!append && !ticker) {
            const seen = new Set<string>();
            const top: { t: string; n: string }[] = [];
            for (const h of d.hits || []) {
              if (h.ticker && !seen.has(h.ticker)) { seen.add(h.ticker); top.push({ t: h.ticker, n: h.name }); }
              if (top.length >= 3) break;
            }
            if (!top.length) { setCalls(null); return; }
            setCalls("loading");
            Promise.all(
              top.map(({ t, n }) => {
                const tu = new URLSearchParams({ q: query, name: n }).toString().replace(/\+/g, "%20");
                return fetch(`/api/transcript-search/${encodeURIComponent(t)}?${tu}`).then((r) => r.json()).then((d) => (d.matches || []).map((m: Call) => ({ ...m, name: n }))).catch(() => [] as Call[]);
              }),
            ).then((lists) => setCalls(lists.flat().sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8)));
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [ticker],
  );

  const onSearch = (e?: React.FormEvent, all = false) => {
    e?.preventDefault();
    if (!q.trim()) return;
    setSubmitted({ q, forms, all });
    setVisible(12);
    setData(null);
    run(q, forms, 0, false, all);
    // also search this company's recent earnings calls
    setCalls(null);
    if (ticker && !all) {
      setCalls("loading");
      const u = new URLSearchParams({ q, name: name || ticker });
      fetch(`/api/transcript-search/${encodeURIComponent(ticker)}?${u.toString().replace(/\+/g, "%20")}`)
        .then((r) => r.json())
        .then((d) => setCalls(d.matches || []))
        .catch(() => setCalls([]));
    }
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
          className="min-w-[240px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)]"
        />
        <select
          value={forms}
          onChange={(e) => setForms(e.target.value)}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-2 text-sm text-[var(--text-2)] outline-none focus:border-[var(--border-strong)]"
        >
          {FORM_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <Button type="submit" variant="primary">
          Search
        </Button>
      </form>
      <p className="text-[11px] text-[var(--text-4)]">
        Full-text search of SEC EDGAR filings since 2001{ticker ? " + this company's recent earnings calls" : ""}. Wrap a phrase in &quot;quotes&quot; for an exact match.
      </p>

      {submitted && calls && calls !== "loading" && calls.length > 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="mb-2 text-xs font-semibold text-[var(--text-2)]">{ticker ? "In recent earnings calls" : "In earnings calls — matching companies"}</div>
          <div className="space-y-2">
            {calls.map((c, i) => (
              <a key={i} href={c.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] px-3 py-2 hover:border-[#2a3346]">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium text-[var(--text)]">{c.name && !ticker ? <><span className="font-mono text-[var(--text-2)]">{c.name}</span> — {c.title}</> : c.title}</span>
                  <span className="shrink-0 whitespace-nowrap text-[var(--text-3)]">{c.count}× · {c.date} ↗</span>
                </div>
                <div className="mt-1 text-[13px] leading-relaxed text-[var(--text-body)]">{highlight(c.snippet, submitted.q)}</div>
              </a>
            ))}
          </div>
        </div>
      )}

      {submitted &&
        (loading && !data ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">
            Searching EDGAR…
          </div>
        ) : !data || data.total === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">
            <div>No filings {ticker && !submitted.all ? `from ${name || ticker} ` : ""}match &quot;{submitted.q}&quot;.</div>
            <div className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-[var(--text-4)]">
              This searches the text of SEC filings (10-K / 10-Q / 8-K / proxies), not news. Filings use formal wording — try the
              filing term (e.g. <span className="text-[var(--text-3)]">repurchase</span>, not buyback), remove the quotes, or widen the form filter.
            </div>
            {ticker && !submitted.all && (
              <button
                onClick={() => onSearch(undefined, true)}
                className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--accent)] hover:border-[var(--border-strong)]"
              >
                Search all companies for &quot;{submitted.q}&quot; →
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="text-xs text-[var(--text-3)]">
              <span className="font-semibold text-[var(--text-2)]">{data.total >= 10000 ? "10,000+" : data.total.toLocaleString()}</span>{" "}
              filings mention <span className="text-[var(--text)]">&quot;{data.rewroteTo || submitted.q}&quot;</span>
              {ticker && !submitted.all ? "" : " across all companies"}
            </div>
            {data.rewroteTo && (
              <div className="-mt-1 text-[11px] text-[var(--text-4)]">
                Few filings literally say &quot;{submitted.q}&quot; — showing the filing term{" "}
                <span className="text-[var(--text-3)]">&quot;{data.rewroteTo}&quot;</span>.
              </div>
            )}
            <div className="space-y-2">
              {data.hits.slice(0, visible).map((h, i) => (
                <ResultRow key={h.accession + h.filename + i} hit={h} q={data.rewroteTo || submitted.q} showCompany={!ticker || submitted.all} />
              ))}
            </div>
            {visible < data.hits.length ? (
              <button
                onClick={() => setVisible((v) => v + 12)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 text-sm text-[var(--text-2)] hover:border-[var(--border-strong)]"
              >
                Show more results
              </button>
            ) : data.nextFrom != null ? (
              <button
                onClick={() => { run(submitted.q, submitted.forms, data.nextFrom!, true, submitted.all); setVisible((v) => v + 12); }}
                disabled={loading}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] py-2 text-sm text-[var(--text-2)] hover:border-[var(--border-strong)] disabled:opacity-50"
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-medium text-[var(--text-2)]">{hit.form}</span>
        {showCompany && (
          <span className="font-semibold text-[var(--text)]">
            {hit.name}
            {hit.ticker ? <span className="text-[var(--text-3)]"> ({hit.ticker})</span> : null}
          </span>
        )}
        <span className="tabular-nums text-[var(--text-3)]">{hit.date}</span>
        <a href={hit.url} target="_blank" rel="noreferrer" className="ml-auto text-[var(--accent)] hover:underline">
          Open on EDGAR ↗
        </a>
      </div>
      <div className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-body)]">
        {snip === "loading" ? (
          <span className="text-[var(--text-4)]">Loading match…</span>
        ) : snip ? (
          highlight(snip, q)
        ) : (
          <span className="text-[var(--text-4)]">Match in filing — open on EDGAR to view.</span>
        )}
      </div>
    </div>
  );
}
